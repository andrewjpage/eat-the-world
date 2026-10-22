import { useId, useMemo, useState } from "react";
import { cn } from "@/components/ui/cn";
import { Flag } from "@/components/ui/Flag";
import { POPULAR_ISO2 } from "@/lib/countries";
import { fold } from "@solo/domain/candidates";

export interface CountryOption {
  iso2: string;
  name: string;
}

const SHOWN = 12;

/**
 * Choose one country: the popular ones to tap, or search all of them. Once chosen it shows as a
 * single row with Change.
 */
export function CountrySelect({
  countries,
  value,
  onChange,
}: {
  countries: readonly CountryOption[];
  value: string;
  onChange: (iso2: string) => void;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [changing, setChanging] = useState(false);
  const chosen = countries.find((c) => c.iso2 === value);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    if (q) return countries.filter((c) => fold(c.name).includes(q) || c.iso2.toLowerCase() === q).slice(0, SHOWN);
    const byIso = new Map(countries.map((c) => [c.iso2, c]));
    return POPULAR_ISO2.flatMap((iso2) => byIso.get(iso2) ?? []);
  }, [countries, query]);

  if (chosen && !changing) {
    return (
      <div className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-stamp-red bg-stamp-red-soft px-3.5">
        <Flag iso2={chosen.iso2} size="md" />
        <span className="min-w-0 flex-1 truncate font-semibold text-ink">{chosen.name}</span>
        <button
          type="button"
          onClick={() => setChanging(true)}
          className="min-h-11 rounded-full px-3 text-sm font-semibold text-ink-soft active:bg-ink/5"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={searchId} className="sr-only">
        Search countries
      </label>
      <input
        id={searchId}
        type="search"
        className="input"
        placeholder={`Search ${countries.length} countries`}
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div role="radiogroup" aria-label="Country" className="mt-3 flex flex-wrap gap-2">
        {shown.map((c) => (
          <button
            key={c.iso2}
            type="button"
            role="radio"
            aria-checked={c.iso2 === value}
            onClick={() => {
              onChange(c.iso2);
              setQuery("");
              setChanging(false);
            }}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-3.5 text-[0.95rem] font-semibold transition active:scale-[0.97]",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ink/20",
              c.iso2 === value
                ? "border-stamp-red bg-stamp-red-soft text-stamp-red"
                : "border-line bg-paper-raised text-ink hover:border-ink/40",
            )}
          >
            <Flag iso2={c.iso2} size="sm" />
            {c.name}
          </button>
        ))}
      </div>
      {query.trim() && shown.length === 0 && (
        <p className="mt-3 text-sm text-ink-soft">No country matches “{query.trim()}”.</p>
      )}
      {!query.trim() && <p className="mt-3 text-sm text-muted">Not here? Search for any of the {countries.length}.</p>}
    </div>
  );
}
