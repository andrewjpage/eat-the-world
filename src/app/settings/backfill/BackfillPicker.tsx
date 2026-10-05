"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { createClient } from "@/lib/supabase/browser";
import { groupByRegion, POPULAR_ISO2 } from "@/lib/countries";
import { ButtonLink } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { Flag } from "@/components/ui/Flag";
import { stampStyle } from "@/components/ui/Stamp";
import { useToast } from "@/components/ui/Toast";

export interface BackfillCountry {
  iso2: string;
  name: string;
  m49_group: string;
}

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Every country, grouped by region (popular ones first), with search. Tapping toggles a backfilled
 * stamp (backfill_countries / remove_backfilled_stamp). Visit stamps are locked.
 */
export function BackfillPicker({
  countries,
  initialBackfilled,
  visitStamped,
  onboarding,
}: {
  countries: BackfillCountry[];
  initialBackfilled: string[];
  visitStamped: string[];
  onboarding: boolean;
}) {
  const { toast } = useToast();
  const [picked, setPicked] = useState(() => new Set(initialBackfilled));
  const [busy, setBusy] = useState(() => new Set<string>());
  const [query, setQuery] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const locked = useMemo(() => new Set(visitStamped), [visitStamped]);

  const regions = useMemo(() => {
    const q = fold(query.trim());
    const list = q
      ? countries.filter((c) => fold(c.name).includes(q) || c.iso2.toLowerCase() === q)
      : countries;
    return groupByRegion(list);
  }, [countries, query]);

  // With no search, the cuisines most people have eaten come first.
  const popular = useMemo(() => {
    if (query.trim()) return [];
    const byIso = new Map(countries.map((c) => [c.iso2, c]));
    return POPULAR_ISO2.map((iso) => byIso.get(iso)).filter((c): c is BackfillCountry => !!c);
  }, [countries, query]);

  async function toggle(c: BackfillCountry) {
    if (locked.has(c.iso2) || busy.has(c.iso2)) return;
    const adding = !picked.has(c.iso2);
    const flip = (s: Set<string>, add: boolean) => {
      const next = new Set(s);
      if (add) next.add(c.iso2);
      else next.delete(c.iso2);
      return next;
    };
    setPicked((s) => flip(s, adding));
    setFresh(adding ? c.iso2 : null);
    setBusy((s) => flip(s, true));
    if (adding && "vibrate" in navigator) {
      try {
        navigator.vibrate(12);
      } catch {
        // Haptics are a nice-to-have.
      }
    }

    const supabase = createClient();
    const { error } = adding
      ? await supabase.rpc("backfill_countries", { p_iso2s: [c.iso2] })
      : await supabase.rpc("remove_backfilled_stamp", { p_iso2: c.iso2 });

    setBusy((s) => flip(s, false));
    if (error) {
      setPicked((s) => flip(s, !adding));
      toast((error.code === "P0001" && error.message) || `Couldn't update ${c.name}. Try again.`, "error");
    }
  }

  const count = picked.size;

  function renderCountry(c: BackfillCountry) {
    const isLocked = locked.has(c.iso2);
    const on = picked.has(c.iso2) || isLocked;
    const s = stampStyle(c.iso2);
    return (
      <li key={c.iso2}>
        <button
          type="button"
          onClick={() => toggle(c)}
          aria-pressed={on}
          disabled={isLocked}
          aria-label={`${c.name}${isLocked ? ", stamped from a visit" : on ? ", before the app" : ""}`}
          style={{ "--stamp-rotate": on ? s.rotate : "0deg" } as CSSProperties}
          className={cn(
            "relative flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-2xl px-1.5 text-center transition",
            "active:scale-95",
            on
              ? cn("stamp-ink bg-paper-raised", isLocked ? "text-verified-teal" : s.ink)
              : "border border-line bg-paper-raised text-ink-soft hover:border-ink/40",
            fresh === c.iso2 && on && "animate-stamp-in",
            busy.has(c.iso2) && "opacity-70",
          )}
        >
          <Flag iso2={c.iso2} size="md" className={cn(!on && "opacity-80")} />
          <span
            className={cn(
              "line-clamp-2 text-[0.72rem] leading-tight font-semibold",
              on && "uppercase tracking-wide",
            )}
          >
            {c.name}
          </span>
          {isLocked && (
            <span className="absolute top-1 right-1.5 text-[0.6rem] font-bold uppercase">
              Visit
            </span>
          )}
        </button>
      </li>
    );
  }

  return (
    <div>
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 -mx-4 bg-paper/95 px-4 pt-2 pb-3 backdrop-blur-md">
        <label htmlFor="country-search" className="sr-only">
          Search countries
        </label>
        <input
          id="country-search"
          type="search"
          placeholder="Search 249 countries"
          autoComplete="off"
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {regions.length === 0 && (
        <p className="py-10 text-center text-ink-soft">No country matches “{query}”.</p>
      )}

      {popular.length > 0 && (
        <section className="mb-6" aria-label="Popular">
          <h2 className="mb-2 font-display text-lg text-ink">Popular</h2>
          <ul className="grid grid-cols-3 gap-2">{popular.map(renderCountry)}</ul>
        </section>
      )}

      {regions.map((r) => (
        <section key={r.group} className="mb-6" aria-label={r.group}>
          <h2 className="mb-2 font-display text-lg text-ink">{r.group}</h2>
          <ul className="grid grid-cols-3 gap-2">{r.countries.map(renderCountry)}</ul>
        </section>
      ))}

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 -mx-4 mt-2 bg-gradient-to-t from-paper via-paper/95 to-transparent px-4 pt-6 pb-2">
        <div className="flex items-center gap-3">
          <p className="flex-1 text-sm text-ink-soft" aria-live="polite">
            <strong className="font-display text-lg text-ink">{count}</strong>{" "}
            {count === 1 ? "memory" : "memories"} · 0 points
          </p>
          <ButtonLink href={onboarding ? "/" : "/settings"} size="lg">
            {onboarding ? "See my passport" : "Done"}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
