import { useMemo, useState } from "react";
import { formatDistance } from "@/components/checkin/logic";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { Flag } from "@/components/ui/Flag";
import { useToast } from "@/components/ui/Toast";
import { nearest } from "@/lib/geo";
import { searchCandidates, type Candidate } from "@solo/domain/candidates";
import { currentPosition } from "@solo/services/position";

const BROWSE_LIMIT = 12;
const SEARCH_LIMIT = 30;

type Pinned = Candidate & { lat: number; lon: number };
const hasPin = (c: Candidate): c is Pinned => c.lat !== null && c.lon !== null;

/**
 * Where did you eat? My places and the London suggestions, found by search or by "Near me". The
 * position is read once per tap and dropped as soon as the closest place is known; only that place
 * and its distance are kept.
 */
export function RestaurantPicker({
  candidates,
  country,
  onShowAll,
  onPick,
  onAdd,
}: {
  candidates: readonly Candidate[];
  /** Limits the list to one country (the link came from a country page). */
  country: { iso2: string; name: string } | null;
  onShowAll: () => void;
  onPick: (candidate: Candidate) => void;
  /** Add a place that isn't listed; gets what was typed in the search box. */
  onAdd: (typedName: string) => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [locating, setLocating] = useState(false);
  const [near, setNear] = useState<{ key: string; metres: number } | null>(null);

  const searching = query.trim() !== "";
  const onlyIso2 = country?.iso2;
  const pool = useMemo(
    () => searchCandidates(candidates, query, { countryIso2: onlyIso2 }),
    [candidates, query, onlyIso2],
  );
  const limit = searching || country ? SEARCH_LIMIT : BROWSE_LIMIT;
  const list = useMemo(() => {
    const closest = near ? pool.find((c) => c.key === near.key) : undefined;
    const rest = closest ? pool.filter((c) => c !== closest) : pool;
    return (closest ? [closest, ...rest] : rest).slice(0, limit);
  }, [pool, near, limit]);

  async function nearMe() {
    setLocating(true);
    try {
      const here = await currentPosition();
      const found = nearest(here, pool.filter(hasPin));
      if (found) setNear({ key: found.item.key, metres: found.distanceM });
      else toast("None of these places has a position yet. Search for it instead.", "info");
    } catch {
      toast("Couldn't get your location. Search for the place instead.", "info");
    } finally {
      setLocating(false);
    }
  }

  return (
    <div>
      {country && (
        <p className="mb-3 flex items-center gap-2 text-sm text-ink-soft">
          <Flag iso2={country.iso2} size="xs" /> Showing places in {country.name}.
          <button type="button" onClick={onShowAll} className="min-h-11 font-semibold text-ink underline underline-offset-4">
            Show all
          </button>
        </p>
      )}

      <label htmlFor="place-search" className="sr-only">
        Search places
      </label>
      <input
        id="place-search"
        type="search"
        className="input"
        placeholder="Search by name, country or postcode"
        autoComplete="off"
        enterKeyHint="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" loading={locating} onClick={nearMe}>
          <span aria-hidden>📍</span> Near me
        </Button>
        <Button variant="secondary" onClick={() => onAdd(query.trim())}>
          <span aria-hidden>＋</span> Add a place
        </Button>
      </div>

      {list.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2.5" aria-label={searching ? "Search results" : "Places"}>
          {list.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => onPick(c)}
                className={cn(
                  "flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 bg-paper-raised px-3.5 py-2.5 text-left active:scale-[0.99]",
                  near?.key === c.key ? "border-stamp-red" : "border-line",
                )}
              >
                <Flag iso2={c.countryIso2} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{c.name}</span>
                  <span className="block truncate text-sm text-ink-soft">
                    {c.countryName}
                    {c.address ? ` · ${c.address}` : ""}
                  </span>
                </span>
                {near?.key === c.key && <Badge tone="red">{formatDistance(near.metres)} away</Badge>}
                {c.visits > 0 && <Badge tone="neutral">Been here</Badge>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-center text-[0.95rem] text-ink-soft">
          {searching ? <>Nothing matches “{query.trim()}”.</> : "Nothing here yet."} Use Add a place and it&apos;s yours.
        </p>
      )}

      {pool.length > list.length && (
        <p className="mt-3 text-center text-sm text-muted">
          Showing {list.length} of {pool.length}. Search to find the rest.
        </p>
      )}
    </div>
  );
}
