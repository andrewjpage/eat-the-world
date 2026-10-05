"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { haversineMetres } from "@/lib/geo";
import { Badge, Button, Card, Flag } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { formatDistance, matchesQuery } from "./logic";

export interface Candidate {
  id: string;
  name: string;
  address: string | null;
  postcode: string;
  lat: number;
  lon: number;
  countryIso2: string;
  countryName: string;
}

type Locating = "idle" | "asking" | "done" | "denied" | "failed";

const NEAR_LIMIT = 8;
const SEARCH_LIMIT = 30;

/**
 * Pick a restaurant to check in at. Location is asked for once, on tap, and the sort is
 * done entirely in the browser: only distances (metres) are kept in state, the position
 * itself is dropped as soon as they are computed and nothing is sent anywhere here.
 */
export function NearbyPicker({ restaurants }: { restaurants: Candidate[] }) {
  const [state, setState] = useState<Locating>("idle");
  const [distances, setDistances] = useState<Map<string, number> | null>(null);
  const [query, setQuery] = useState("");

  function locate() {
    if (!("geolocation" in navigator)) {
      setState("failed");
      return;
    }
    setState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const d = new Map<string, number>();
        for (const r of restaurants) d.set(r.id, haversineMetres(here, r));
        setDistances(d);
        setState("done");
      },
      (err) => setState(err.code === 1 ? "denied" : "failed"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 120_000 },
    );
  }

  const list = useMemo(() => {
    const searching = query.trim().length > 0;
    let rows = restaurants
      .map((r) => ({ r, d: distances?.get(r.id) ?? null }))
      .filter(({ r }) => matchesQuery({ ...r, country: r.countryName }, query));
    if (distances) rows.sort((a, b) => (a.d ?? 0) - (b.d ?? 0));
    else rows.sort((a, b) => a.r.name.localeCompare(b.r.name));
    rows = rows.slice(0, searching ? SEARCH_LIMIT : distances ? NEAR_LIMIT : 0);
    return rows;
  }, [restaurants, distances, query]);

  const searching = query.trim().length > 0;

  return (
    <div>
      {state !== "done" && (
        <Card perforated className="mb-4">
          <p className="text-[0.95rem] text-ink-soft">
            Tap to find restaurants near you. Your location stays on this phone, and is only used to
            sort this list.
          </p>
          <Button className="mt-3" size="lg" block loading={state === "asking"} onClick={locate}>
            {state === "denied" || state === "failed" ? "Try again" : "Find restaurants near me"}
          </Button>
          {state === "denied" && (
            <p role="status" className="mt-3 text-sm text-ink-soft">
              Location is off for this site, so search instead. You can still check in.
            </p>
          )}
          {state === "failed" && (
            <p role="status" className="mt-3 text-sm text-ink-soft">
              We couldn&apos;t get a location signal. Search for the restaurant instead.
            </p>
          )}
        </Card>
      )}

      <label htmlFor="restaurant-search" className="sr-only">
        Search restaurants
      </label>
      <input
        id="restaurant-search"
        type="search"
        className="input"
        placeholder="Search by restaurant, country or postcode"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        enterKeyHint="search"
      />

      {!distances && !searching && (
        <p className="mt-4 text-center text-sm text-muted">
          Or type a name above. {restaurants.length} restaurants are on the list.
        </p>
      )}

      {list.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2.5" aria-label={searching ? "Search results" : "Nearest restaurants"}>
          {list.map(({ r, d }, i) => (
            <li key={r.id}>
              <Link
                href={`/check-in/${r.id}`}
                prefetch={false}
                className={cn(
                  "flex min-h-16 items-center gap-3 rounded-2xl border-2 bg-paper-raised px-3.5 py-2.5 active:scale-[0.99]",
                  d !== null && i === 0 && !searching ? "border-stamp-red" : "border-line",
                )}
              >
                <Flag iso2={r.countryIso2} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{r.name}</span>
                  <span className="block truncate text-sm text-ink-soft">
                    {r.countryName}
                    {r.address ? ` · ${r.address}` : ""}
                  </span>
                </span>
                {d !== null && (
                  <Badge tone={i === 0 && !searching ? "red" : "muted"}>{formatDistance(d)}</Badge>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {searching && list.length === 0 && (
        <p className="mt-6 text-center text-[0.95rem] text-ink-soft">
          Nothing matches &ldquo;{query.trim()}&rdquo;. Try the country or a postcode.
        </p>
      )}
    </div>
  );
}
