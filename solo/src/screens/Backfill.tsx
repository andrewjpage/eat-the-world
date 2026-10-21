import { useMemo, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { Flag } from "@/components/ui/Flag";
import { Page, PageHeader } from "@/components/ui/Page";
import { stampStyle } from "@/components/ui/Stamp";
import { useToast } from "@/components/ui/Toast";
import { displayName, groupByRegion, POPULAR_ISO2 } from "@/lib/countries";
import { requestPersistence } from "@solo/db/persist";
import { useRouter } from "@solo/shims/navigation";
import { useSolo } from "@solo/state/SoloContext";

interface PickerCountry {
  iso2: string;
  name: string;
  m49_group: string;
}

/** Accent- and case-insensitive, so "turk" finds Türkiye. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Flips one code in or out of a set without touching the original. */
function flip(set: ReadonlySet<string>, iso2: string, present: boolean): Set<string> {
  const next = new Set(set);
  if (present) next.add(iso2);
  else next.delete(iso2);
  return next;
}

/**
 * Every country, grouped by region (the popular ones first), with search. Tapping a country marks it
 * as eaten before the app; Save writes the changes. Countries with a visit stamp are locked.
 *
 * The picker holds only what was changed since it opened, on top of what is stored, so a country
 * that another window saved meanwhile is kept rather than undone.
 */
export default function Backfill() {
  const { data, stamps, seed, store, reload } = useSolo();
  const router = useRouter();
  const { toast } = useToast();

  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const countries = useMemo<PickerCountry[]>(
    () =>
      seed.countries.map((c) => ({ iso2: c.iso2, name: displayName(c), m49_group: c.m49_group || "Elsewhere" })),
    [seed],
  );
  const stored = useMemo(() => new Set(data.backfills.map((b) => b.countryIso2)), [data.backfills]);
  const locked = useMemo(
    () => new Set(stamps.filter((s) => s.kind === "visit").map((s) => s.countryIso2)),
    [stamps],
  );

  const isOn = (iso2: string) => added.has(iso2) || (stored.has(iso2) && !removed.has(iso2));

  const regions = useMemo(() => {
    const q = fold(query.trim());
    const matching = q
      ? countries.filter((c) => fold(c.name).includes(q) || c.iso2.toLowerCase() === q)
      : countries;
    return groupByRegion(matching);
  }, [countries, query]);

  // With no search, the cuisines most people have eaten come first.
  const popular = useMemo(() => {
    if (query.trim()) return [];
    const byIso = new Map(countries.map((c) => [c.iso2, c]));
    return POPULAR_ISO2.map((iso2) => byIso.get(iso2)).filter((c): c is PickerCountry => !!c);
  }, [countries, query]);

  // What Save will do. A country another window already stored needs no write; one it removed, no delete.
  const toAdd = [...added].filter((iso2) => !stored.has(iso2) && !locked.has(iso2));
  const toRemove = [...removed].filter((iso2) => stored.has(iso2));
  const memories = countries.filter((c) => !locked.has(c.iso2) && isOn(c.iso2)).length;

  function toggle(iso2: string) {
    if (locked.has(iso2) || saving) return;
    const turningOn = !isOn(iso2);
    if (turningOn) {
      if (removed.has(iso2)) setRemoved((s) => flip(s, iso2, false));
      else setAdded((s) => flip(s, iso2, true));
    } else if (added.has(iso2)) {
      setAdded((s) => flip(s, iso2, false));
    } else {
      setRemoved((s) => flip(s, iso2, true));
    }
    setFresh(turningOn ? iso2 : null);
    if (turningOn) navigator.vibrate?.(12);
  }

  async function save() {
    if (!store) return;
    setSaving(true);
    try {
      if (toAdd.length > 0) {
        const createdAt = new Date().toISOString();
        await store.putBackfills(toAdd.map((countryIso2) => ({ countryIso2, createdAt })));
      }
      for (const iso2 of toRemove) await store.deleteBackfill(iso2);
      await reload();
      if (toAdd.length > 0) void requestPersistence();
      router.push("/");
    } catch {
      toast("Couldn't save. Try again.", "error");
      // Show what really got stored, so a retry starts from the truth.
      reload().catch(() => {});
    } finally {
      setSaving(false);
    }
  }

  function renderCountry(c: PickerCountry) {
    const isLocked = locked.has(c.iso2);
    const on = isLocked || isOn(c.iso2);
    const style = stampStyle(c.iso2);
    return (
      <li key={c.iso2}>
        <button
          type="button"
          onClick={() => toggle(c.iso2)}
          aria-pressed={on}
          disabled={isLocked}
          aria-label={`${c.name}${isLocked ? ", stamped from a visit" : on ? ", before the app" : ""}`}
          style={{ "--stamp-rotate": on ? style.rotate : "0deg" } as CSSProperties}
          className={cn(
            "relative flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-2xl px-1.5 text-center transition",
            "active:scale-95",
            on
              ? cn("stamp-ink bg-paper-raised", isLocked ? "text-verified-teal" : style.ink)
              : "border border-line bg-paper-raised text-ink-soft hover:border-ink/40",
            fresh === c.iso2 && on && "animate-stamp-in",
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
            <span className="absolute top-1 right-1.5 text-[0.6rem] font-bold uppercase">Visit</span>
          )}
        </button>
      </li>
    );
  }

  return (
    <Page>
      <PageHeader kicker="Passport" title="Countries before the app">
        <p>
          Tap the countries whose food you&apos;ve already eaten. They go in your passport as faded{" "}
          <strong className="text-ink">memories</strong>.
        </p>
        <p className="mt-2">Eat there again from now on and the memory becomes a full stamp.</p>
      </PageHeader>

      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 -mx-4 bg-paper/95 px-4 pt-2 pb-3 backdrop-blur-md">
        <label htmlFor="country-search" className="sr-only">
          Search countries
        </label>
        <input
          id="country-search"
          type="search"
          placeholder={`Search ${countries.length} countries`}
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
            <strong className="font-display text-lg text-ink">{memories}</strong>{" "}
            {memories === 1 ? "memory" : "memories"}
          </p>
          <Button size="lg" loading={saving} disabled={toAdd.length + toRemove.length === 0} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </Page>
  );
}
