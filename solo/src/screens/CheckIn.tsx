import { useMemo, useRef, useState } from "react";
import { EMPTY_DISH_RATING } from "@/components/checkin/DishRatingFields";
import { Button } from "@/components/ui/Button";
import { Flag } from "@/components/ui/Flag";
import { useToast } from "@/components/ui/Toast";
import { displayName } from "@/lib/countries";
import type { CountryOption } from "@solo/components/CountrySelect";
import { FlowFrame } from "@solo/components/FlowFrame";
import { isPlaceReady, NewPlaceForm, type NewPlaceDraft } from "@solo/components/NewPlaceForm";
import { PhotoField } from "@solo/components/PhotoField";
import { RestaurantPicker } from "@solo/components/RestaurantPicker";
import { SoloStampMoment } from "@solo/components/SoloStampMoment";
import { VisitFields } from "@solo/components/VisitFields";
import { dishesFor } from "@solo/data/seed";
import { requestPersistence } from "@solo/db/persist";
import { buildCandidates, type Candidate } from "@solo/domain/candidates";
import { visitFieldsOf } from "@solo/domain/draft";
import { resolvePlace } from "@solo/domain/lookup";
import { deriveStamps, localToday } from "@solo/domain/stamps";
import { logVisit, VisitError, type LogResult, type NewVisitInput } from "@solo/services/visits";
import { useRouter, useSearchParams } from "@solo/shims/navigation";
import { useSolo } from "@solo/state/SoloContext";

type Stage = "where" | "new-place" | "details";

/** The place the visit is for, as it was picked (or typed). */
interface Chosen {
  ref: NewVisitInput["restaurant"];
  name: string;
  countryIso2: string;
}

const isNewPlace = (chosen: Chosen | null) => !!chosen && "name" in chosen.ref;

/**
 * Check in: Where (my places and the London suggestions, or add one), then Details (date, dish,
 * rating, note, photo), then the stamp moment. Reached as `#/check-in`, `?restaurant=<id>` (a
 * suggestion, my copy of one, or a place of mine: the details step comes first) or `?country=<iso2>`.
 */
export default function CheckIn() {
  const search = useSearchParams();
  return (
    <CheckInFlow
      key={search.toString()}
      restaurantId={search.get("restaurant")}
      countryIso2={search.get("country")?.toUpperCase() ?? null}
    />
  );
}

function CheckInFlow({ restaurantId, countryIso2 }: { restaurantId: string | null; countryIso2: string | null }) {
  const { data, seed, store, reload } = useSolo();
  const router = useRouter();
  const { toast } = useToast();

  const countries = useMemo<CountryOption[]>(
    () => seed.countries.map((c) => ({ iso2: c.iso2, name: displayName(c) })),
    [seed],
  );
  const candidates = useMemo(() => buildCandidates(seed, data.restaurants, data.visits), [seed, data]);
  const nameOfCountry = (iso2: string) => countries.find((c) => c.iso2 === iso2)?.name ?? iso2;

  // A link can carry the id of a suggestion, of my copy of one, or of a place of mine; all three resolve
  // to the same restaurant, so logging at a suggestion I already copied reuses the copy.
  const [chosen, setChosen] = useState<Chosen | null>(() => {
    const place = restaurantId ? resolvePlace(restaurantId, seed, data.restaurants) : null;
    if (!place) return null;
    const ref = place.own ? { existingId: place.own.id } : place.suggestion ? { seedId: place.suggestion.id } : null;
    return ref && { ref, name: place.name, countryIso2: place.countryIso2 };
  });
  const [stage, setStage] = useState<Stage>(chosen ? "details" : "where");
  // Where "Back" goes from the details: out of the flow if the link already named the place.
  const [enteredAt, setEnteredAt] = useState<Stage>(stage);
  const [onlyCountry, setOnlyCountry] = useState(countryIso2 && countries.some((c) => c.iso2 === countryIso2) ? countryIso2 : null);
  const [place, setPlace] = useState<NewPlaceDraft>({ name: "", countryIso2: onlyCountry ?? "", address: "", coords: null });

  const [visitedOn, setVisitedOn] = useState(() => localToday(new Date()));
  const [dish, setDish] = useState(EMPTY_DISH_RATING);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const saveStarted = useRef(false);
  const [saved, setSaved] = useState<{ result: LogResult; earnedOn: string } | null>(null);

  function leave() {
    if (window.history.length > 1) router.back();
    else router.replace("/");
  }

  function back() {
    if (stage === "details") {
      if (enteredAt === "details") leave();
      else setStage(isNewPlace(chosen) ? "new-place" : "where");
    } else if (stage === "new-place") setStage("where");
    else leave();
  }

  /** Moves to the details for `next`. A dish belongs to its country's list, so a different country drops it. */
  function choose(next: Chosen) {
    if (chosen && chosen.countryIso2 !== next.countryIso2) {
      setDish((d) => ({ ...d, dishId: null, useOther: false, otherText: "" }));
    }
    setChosen(next);
    setStage("details");
  }

  function pick(c: Candidate) {
    choose({ ref: c.ref, name: c.name, countryIso2: c.countryIso2 });
  }

  function confirmPlace() {
    const name = place.name.trim();
    choose({
      ref: { name, countryIso2: place.countryIso2, address: place.address.trim() || null, coords: place.coords },
      name,
      countryIso2: place.countryIso2,
    });
  }

  async function save() {
    if (!store || !chosen || saveStarted.current) return;
    saveStarted.current = true;
    setSaving(true);
    try {
      // Read the device again just before saving, so a second window's work is not overlooked.
      const before = await store.load();
      const result = await logVisit(store, before, seed, { restaurant: chosen.ref, visitedOn, photo, ...visitFieldsOf(dish) });
      if (before.visits.length === 0) void requestPersistence();
      if (photo && !result.photoSaved) {
        toast("Visit saved, but the photo wouldn't fit on this phone. Add it again from the visit.", "error");
      }
      const known = before.restaurants.some((r) => r.id === result.restaurant.id);
      const restaurants = known ? before.restaurants : [...before.restaurants, result.restaurant];
      const stamp = deriveStamps(restaurants, [...before.visits, result.visit], before.backfills).find(
        (s) => s.countryIso2 === result.restaurant.countryIso2,
      );
      setSaved({ result, earnedOn: stamp?.earnedOn ?? result.visit.visitedOn });
      await reload().catch(() => {}); // the window also reads again whenever it regains focus
    } catch (error) {
      toast(error instanceof VisitError ? error.message : "Couldn't save the visit. Try again.", "error");
      saveStarted.current = false;
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    const { result, earnedOn } = saved;
    return (
      <SoloStampMoment
        outcome={result.outcome}
        iso2={result.restaurant.countryIso2}
        countryName={nameOfCountry(result.restaurant.countryIso2)}
        restaurantName={result.restaurant.name}
        earnedOn={earnedOn}
        // Both ways out replace the check-in's history entry, so Back never returns to a blank form.
        onDone={() => router.replace("/")}
        onView={() => router.replace(`/visit/${result.visit.id}`)}
      />
    );
  }

  if (stage === "where") {
    return (
      <FlowFrame step={0} steps={2} title="Where did you eat?" onBack={back}>
        <RestaurantPicker
          candidates={candidates}
          country={onlyCountry ? { iso2: onlyCountry, name: nameOfCountry(onlyCountry) } : null}
          onShowAll={() => setOnlyCountry(null)}
          onPick={pick}
          onAdd={(typed) => {
            setPlace((p) => ({ ...p, name: typed || p.name }));
            setStage("new-place");
          }}
        />
      </FlowFrame>
    );
  }

  if (stage === "new-place" || !chosen) {
    return (
      <FlowFrame
        step={0}
        steps={2}
        title="Add a place"
        onBack={back}
        footer={
          <Button size="lg" block disabled={!isPlaceReady(place)} onClick={confirmPlace}>
            Next
          </Button>
        }
      >
        <NewPlaceForm countries={countries} value={place} onChange={(patch) => setPlace((p) => ({ ...p, ...patch }))} />
      </FlowFrame>
    );
  }

  return (
    <FlowFrame
      step={1}
      steps={2}
      title="How was it?"
      onBack={back}
      summary={
        <>
          <Flag iso2={chosen.countryIso2} size="xs" />
          <span className="min-w-0 flex-1 truncate font-semibold">{chosen.name}</span>
          <button
            type="button"
            onClick={() => {
              setEnteredAt("where");
              setStage(isNewPlace(chosen) ? "new-place" : "where");
            }}
            className="min-h-11 shrink-0 px-2 font-semibold text-ink underline underline-offset-4"
          >
            Change
          </button>
        </>
      }
      footer={
        <Button size="lg" block loading={saving} disabled={!visitedOn} onClick={save}>
          Save visit
        </Button>
      }
    >
      <VisitFields
        visitedOn={visitedOn}
        onDateChange={setVisitedOn}
        today={localToday(new Date())}
        dish={dish}
        onDishChange={setDish}
        dishes={dishesFor(seed, chosen.countryIso2).map((d) => ({ id: d.id, name: d.name }))}
        countryName={nameOfCountry(chosen.countryIso2)}
      />
      <PhotoField className="mt-6" value={photo} onChange={setPhoto} />
    </FlowFrame>
  );
}
