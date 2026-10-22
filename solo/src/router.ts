export type RouteName =
  | "passport"
  | "map"
  | "world"
  | "country"
  | "restaurant"
  | "check-in"
  | "visit"
  | "backfill"
  | "settings"
  | "not-found";

export type RouteParams = Record<string, string>;

export interface Route {
  name: RouteName;
  params: RouteParams;
}

/** What the shell hands every screen: the parameters its route captured. */
export interface ScreenProps {
  params: RouteParams;
}

const STATIC_ROUTES = new Map<string, RouteName>([
  ["/", "passport"],
  ["/map", "map"],
  ["/world", "world"],
  ["/check-in", "check-in"],
  ["/backfill", "backfill"],
  ["/settings", "settings"],
]);

/** Routes of the form `/<prefix>/<value>`, and the parameter the value is captured as. */
const PARAM_ROUTES = new Map<string, { name: RouteName; param: string }>([
  ["country", { name: "country", param: "iso2" }],
  ["restaurant", { name: "restaurant", param: "id" }],
  ["visit", { name: "visit", param: "id" }],
]);

const NOT_FOUND: Route = { name: "not-found", params: {} };

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The screen for a route path such as `/country/FR` (the hash without `#` and without its query). */
export function matchRoute(path: string): Route {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;

  const fixed = STATIC_ROUTES.get(trimmed);
  if (fixed) return { name: fixed, params: {} };

  const segments = trimmed.split("/");
  if (segments.length !== 3 || segments[0] !== "") return NOT_FOUND;

  const route = PARAM_ROUTES.get(segments[1]);
  const value = decode(segments[2]);
  if (!route || !value) return NOT_FOUND;

  // Stamps are keyed by upper-case ISO codes, so /country/fr must mean FR.
  if (route.name === "country") {
    return /^[A-Za-z]{2}$/.test(value)
      ? { name: "country", params: { iso2: value.toUpperCase() } }
      : NOT_FOUND;
  }
  return { name: route.name, params: { [route.param]: value } };
}
