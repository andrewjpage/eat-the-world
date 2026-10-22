import type { SeedData, SeedDish, SeedRestaurant, SoloRestaurant, SoloVisit } from "./types";

/** A restaurant as the Restaurant page shows it: what I have on this device, plus what the seed says about it. */
export interface Place {
  name: string;
  address: string | null;
  postcode: string | null;
  countryIso2: string;
  confidence: SeedRestaurant["confidence"];
  curatorNote: string | null;
  googlePlaceId: string | null;
  /** The London suggestion this is, or was copied from. Null for a place I added by hand. */
  suggestion: SeedRestaurant | null;
  /** My copy on this device; null for a suggestion I have never logged a visit at. */
  own: SoloRestaurant | null;
}

/**
 * Finds a restaurant by the id a link carries: my own id, or a suggestion's `seed:` id. A
 * suggestion I have copied resolves to my copy, so its page shows my visits whichever id was
 * opened. A copy keeps what the curator said about its suggestion; a place added by hand is
 * community, with no note. Null when nothing matches.
 */
export function resolvePlace(id: string, seed: SeedData, restaurants: readonly SoloRestaurant[]): Place | null {
  const own = restaurants.find((r) => r.id === id) ?? restaurants.find((r) => r.seedId === id) ?? null;
  const suggestion = seed.restaurants.find((s) => s.id === (own?.seedId ?? id)) ?? null;
  const base = own ?? suggestion;
  if (!base) return null;

  return {
    name: base.name,
    address: base.address,
    postcode: suggestion?.postcode ?? null,
    countryIso2: base.countryIso2,
    confidence: suggestion?.confidence ?? "community",
    curatorNote: suggestion?.curatorNote ?? null,
    googlePlaceId: suggestion?.googlePlaceId ?? null,
    suggestion,
    own,
  };
}

/** Newest first; two visits on one day go latest-logged first. */
function newestFirst(a: SoloVisit, b: SoloVisit): number {
  return b.visitedOn.localeCompare(a.visitedOn) || b.createdAt.localeCompare(a.createdAt);
}

export function visitsAt(restaurantId: string, visits: readonly SoloVisit[]): SoloVisit[] {
  return visits.filter((v) => v.restaurantId === restaurantId).sort(newestFirst);
}

/** My visits to restaurants in a country, newest first, each with its restaurant. A visit whose restaurant is gone is left out. */
export function visitsIn(
  countryIso2: string,
  restaurants: readonly SoloRestaurant[],
  visits: readonly SoloVisit[],
): { visit: SoloVisit; restaurant: SoloRestaurant }[] {
  const inCountry = new Map(restaurants.filter((r) => r.countryIso2 === countryIso2).map((r) => [r.id, r]));
  return visits
    .filter((v) => inCountry.has(v.restaurantId))
    .sort(newestFirst)
    .map((visit) => ({ visit, restaurant: inCountry.get(visit.restaurantId)! }));
}

/** What I ate: the approved dish if I picked one, else what I typed, else nothing. */
export function dishLabel(visit: SoloVisit, dishes: readonly SeedDish[]): string | null {
  return dishes.find((d) => d.id === visit.dishId)?.name ?? visit.dishOther;
}
