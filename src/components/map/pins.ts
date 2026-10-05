import { nearest, type LatLon } from "@/lib/geo";

/** Pure map logic (brief section 6.2): pin states, the nearest-unstamped search and copy. */

export interface MapRestaurant {
  id: string;
  name: string;
  country_iso2: string;
  address: string | null;
  postcode: string | null;
  lat: number;
  lon: number;
  status: "active" | "reported_closed";
  confidence: "curated" | "community" | "flagged";
  curator_note: string | null;
}

/** `new`: I have no visit stamp for this country (bright). `stamped`: I do (muted). */
export type PinState = "new" | "stamped";

export interface Pin extends MapRestaurant, LatLon {
  countryName: string;
  state: PinState;
  /** A friend (someone I share a group with) has eaten here. */
  friendVisited: boolean;
}

/**
 * Visit stamps only: a backfilled stamp is a memory, so its country stays bright
 * (the caller passes only `backfilled = false` stamps).
 */
export function buildPins(
  restaurants: MapRestaurant[],
  visitStamped: ReadonlySet<string>,
  friendRestaurantIds: ReadonlySet<string>,
  countryNames: ReadonlyMap<string, string>,
): Pin[] {
  return restaurants
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))
    .map((r) => ({
      ...r,
      countryName: countryNames.get(r.country_iso2) ?? r.country_iso2,
      state: visitStamped.has(r.country_iso2) ? ("stamped" as const) : ("new" as const),
      friendVisited: friendRestaurantIds.has(r.id),
    }));
}

/** The closest restaurant in a country I have not stamped. Runs in the browser only. */
export function nearestUnstamped(from: LatLon, pins: Pin[]): { pin: Pin; distanceM: number } | null {
  const hit = nearest(
    from,
    pins.filter((p) => p.state === "new"),
  );
  return hit ? { pin: hit.item, distanceM: hit.distanceM } : null;
}

/** "340 m", "1.4 km", "27 km". */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return "";
  if (metres < 950) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  const km = metres / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString("en-GB")} km`;
}

/** The pin's cache key and CSS classes depend only on these four flags. */
export function pinKey(p: Pick<Pin, "state" | "friendVisited">, selected: boolean): string {
  return `${p.state}${p.friendVisited ? "-ring" : ""}${selected ? "-sel" : ""}`;
}

/**
 * Pin artwork: a teardrop with an optional ring around the head (a friend has been). Colours come
 * from CSS variables in map.css, so both colour schemes work. Static markup only.
 */
export function pinSvg(state: PinState, ring: boolean): string {
  const ringEl = ring
    ? '<circle class="etw-ring-halo" cx="16" cy="15.5" r="14.5"/><circle class="etw-ring" cx="16" cy="15.5" r="14.5"/>'
    : "";
  return (
    `<svg class="etw-pin-svg etw-pin-${state}" viewBox="0 0 32 42" width="32" height="42" aria-hidden="true">` +
    ringEl +
    '<path class="etw-head" d="M16 40C16 40 5 26 5 15.5a11 11 0 1 1 22 0C27 26 16 40 16 40Z"/>' +
    '<circle class="etw-dot" cx="16" cy="15.5" r="4"/></svg>'
  );
}
