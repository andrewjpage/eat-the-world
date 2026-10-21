import { displayName } from "@/lib/countries";
import type { SeedData, SoloRestaurant, SoloVisit } from "./types";

/** A place the check-in can be for: one of my restaurants, or a London suggestion I have not copied yet. */
export interface Candidate {
  /** My restaurant's id, or the suggestion's `seed:` id. */
  key: string;
  ref: { existingId: string } | { seedId: string };
  name: string;
  address: string | null;
  postcode: string | null;
  countryIso2: string;
  countryName: string;
  /** Null for a place without a known position. */
  lat: number | null;
  lon: number | null;
  visits: number;
  /** YYYY-MM-DD of my latest visit, or null. */
  lastVisitedOn: string | null;
}

/** Lower case with accents removed, so "turkiye" finds Türkiye. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Everywhere I could check in. A suggestion I have copied shows once, as my copy. Order: places I
 * have eaten at (latest visit first), my other places, then the suggestions, each by name.
 */
export function buildCandidates(
  seed: SeedData,
  restaurants: readonly SoloRestaurant[],
  visits: readonly SoloVisit[],
): Candidate[] {
  const countryNames = new Map(seed.countries.map((c) => [c.iso2, displayName(c)]));
  const nameOf = (iso2: string) => countryNames.get(iso2) ?? iso2;

  const stats = new Map<string, { visits: number; last: string }>();
  for (const v of visits) {
    const have = stats.get(v.restaurantId);
    stats.set(v.restaurantId, {
      visits: (have?.visits ?? 0) + 1,
      last: have && have.last > v.visitedOn ? have.last : v.visitedOn,
    });
  }

  const mine: Candidate[] = restaurants.map((r) => ({
    key: r.id,
    ref: { existingId: r.id },
    name: r.name,
    address: r.address,
    postcode: seed.restaurants.find((s) => s.id === r.seedId)?.postcode ?? null,
    countryIso2: r.countryIso2,
    countryName: nameOf(r.countryIso2),
    lat: r.lat,
    lon: r.lon,
    visits: stats.get(r.id)?.visits ?? 0,
    lastVisitedOn: stats.get(r.id)?.last ?? null,
  }));

  const copied = new Set(restaurants.flatMap((r) => (r.seedId ? [r.seedId] : [])));
  const suggestions: Candidate[] = seed.restaurants
    .filter((s) => !copied.has(s.id))
    .map((s) => ({
      key: s.id,
      ref: { seedId: s.id },
      name: s.name,
      address: s.address,
      postcode: s.postcode,
      countryIso2: s.countryIso2,
      countryName: nameOf(s.countryIso2),
      lat: s.lat,
      lon: s.lon,
      visits: 0,
      lastVisitedOn: null,
    }));

  const byName = (a: Candidate, b: Candidate) => a.name.localeCompare(b.name, "en-GB");
  const eaten = mine
    .filter((c) => c.visits > 0)
    .sort((a, b) => (b.lastVisitedOn ?? "").localeCompare(a.lastVisitedOn ?? "") || byName(a, b));
  const others = mine.filter((c) => c.visits === 0).sort(byName);
  return [...eaten, ...others, ...suggestions.sort(byName)];
}

/** The candidates matching every word of `query` (name, country, address or postcode), in their given order. */
export function searchCandidates(
  candidates: readonly Candidate[],
  query: string,
  options: { countryIso2?: string | null; limit?: number } = {},
): Candidate[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const matches = candidates.filter((c) => {
    if (options.countryIso2 && c.countryIso2 !== options.countryIso2) return false;
    const haystack = fold([c.name, c.countryName, c.address, c.postcode].filter(Boolean).join(" "));
    return terms.every((t) => haystack.includes(t));
  });
  return options.limit === undefined ? matches : matches.slice(0, options.limit);
}
