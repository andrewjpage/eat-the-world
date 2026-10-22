// A copy of src/components/checkin/DishRatingFields.tsx. KEEP IN STEP with it; delete this once
// DishRatingFields takes an optional prop for the hint and placeholder. Why it is a copy, and the other
// copies: docs/solo.md, "Known copies of shared components".
// Intentional differences from DishRatingFields:
//  - the hint beside "What did you have?" is always "Optional", never "A signature dish earns +2" (solo has no points);
//  - the typed-dish placeholder is "What was it called?", not the group app's "e.g. Sticky rice with jeow bong".
import { useId, type KeyboardEvent } from "react";
import { cn } from "@/components/ui/cn";
import type { DishRatingValue } from "@/components/checkin/DishRatingFields";
import { MAX_DISH_OTHER, MAX_NOTE } from "@/components/checkin/logic";

export interface Dish {
  id: string;
  name: string;
}

/**
 * The group app's dish, rating and note fields, in the same shape and look, minus its "+2 points"
 * line (solo has no points). Every field is optional.
 */
export function DishRating({
  dishes,
  value,
  onChange,
  countryName,
}: {
  dishes: Dish[];
  value: DishRatingValue;
  onChange: (next: DishRatingValue) => void;
  countryName?: string;
}) {
  const uid = useId();
  const set = (patch: Partial<DishRatingValue>) => onChange({ ...value, ...patch });
  // The dish radios are the dishes, then "Something else" at index `dishes.length`.
  const dishIndex = value.useOther ? dishes.length : dishes.findIndex((d) => d.id === value.dishId);
  const selectDish = (i: number) =>
    set(i === dishes.length ? { useOther: true, dishId: null } : { useOther: false, dishId: dishes[i].id });
  const dishTab = (i: number) => (i === (dishIndex >= 0 ? dishIndex : 0) ? 0 : -1);
  const ratingTab = (n: number) => (n === (value.rating ?? 1) ? 0 : -1);

  const chip =
    "inline-flex min-h-11 items-center rounded-full border-2 px-4 text-[0.95rem] font-semibold transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ink/20";
  const chosen = "border-stamp-red bg-stamp-red-soft text-stamp-red";

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-bold text-ink">
          What did you have? <span className="font-normal text-muted">Optional</span>
        </legend>
        <div role="radiogroup" aria-label="Dish" className="flex flex-wrap gap-2">
          {dishes.map((d, i) => {
            const on = !value.useOther && value.dishId === d.id;
            return (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={dishTab(i)}
                onKeyDown={(e) => arrowKeys(e, i, dishes.length + 1, selectDish)}
                onClick={() => set({ dishId: on ? null : d.id, useOther: false })}
                className={cn(chip, on ? chosen : "border-line bg-paper-raised text-ink hover:border-ink/40")}
              >
                {d.name}
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={value.useOther}
            tabIndex={dishTab(dishes.length)}
            onKeyDown={(e) => arrowKeys(e, dishes.length, dishes.length + 1, selectDish)}
            onClick={() => set({ useOther: !value.useOther, dishId: null })}
            className={cn(
              chip,
              value.useOther ? chosen : "border-dashed border-line bg-paper-raised text-ink-soft hover:border-ink/40",
            )}
          >
            Something else
          </button>
        </div>
        {dishes.length === 0 && countryName && (
          <p className="mt-2 text-sm text-muted">No signature dishes listed for {countryName} yet.</p>
        )}
        {value.useOther && (
          <>
            <label htmlFor={`${uid}-other`} className="sr-only">
              Dish name
            </label>
            <input
              id={`${uid}-other`}
              className="input mt-3"
              maxLength={MAX_DISH_OTHER}
              value={value.otherText}
              onChange={(e) => set({ otherText: e.target.value })}
              placeholder="What was it called?"
              autoComplete="off"
              enterKeyHint="done"
            />
          </>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-bold text-ink">
          How was it? <span className="font-normal text-muted">Optional</span>
        </legend>
        <div role="radiogroup" aria-label="Rating" className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => {
            const on = (value.rating ?? 0) >= n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={value.rating === n}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                tabIndex={ratingTab(n)}
                onKeyDown={(e) => arrowKeys(e, n - 1, 5, (i) => set({ rating: i + 1 }))}
                onClick={() => set({ rating: value.rating === n ? null : n })}
                className={cn(
                  "flex size-12 items-center justify-center rounded-2xl text-3xl leading-none transition active:scale-90",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ink/20",
                  on ? "text-gold" : "text-muted",
                )}
              >
                <span aria-hidden>{on ? "★" : "☆"}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${uid}-note`} className="mb-1.5 block text-sm font-bold text-ink">
          A note <span className="font-normal text-muted">Optional</span>
        </label>
        <textarea
          id={`${uid}-note`}
          className="input min-h-20"
          maxLength={MAX_NOTE}
          value={value.note}
          onChange={(e) => set({ note: e.target.value })}
          placeholder="Order again? Skip the queue?"
        />
      </div>
    </div>
  );
}

/** Arrow keys in a radio group: move to the previous or next radio, select it and focus it. */
function arrowKeys(e: KeyboardEvent<HTMLButtonElement>, index: number, count: number, select: (i: number) => void) {
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const next = (index + step + count) % count;
  select(next);
  const sibling = e.currentTarget.parentElement?.children[next];
  if (sibling instanceof HTMLElement) sibling.focus();
}
