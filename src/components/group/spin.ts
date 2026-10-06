/** Pure helpers for "Spin the globe" (brief section 6.7). No I/O, easy to test. */

export interface GapRestaurant {
  id: string;
  name: string;
}

/** A listed country nobody in the group has eaten, with the restaurants Spin may suggest. */
export interface GapCountry {
  iso2: string;
  name: string;
  /** Already filtered to the best tier: curated and not flagged first. */
  restaurants: GapRestaurant[];
}

/** Random integer in [0, n) from a [0, 1) source. */
export function pickIndex(n: number, random: () => number = Math.random): number {
  if (n <= 0) return -1;
  return Math.min(n - 1, Math.floor(random() * n));
}

/**
 * The final pick: a random gap (not the one just shown, when there is a choice) and one of
 * its suggested restaurants.
 */
export function spinPick(
  gaps: GapCountry[],
  previousIso2: string | null,
  random: () => number = Math.random,
): { country: GapCountry; restaurant: GapRestaurant | null } | null {
  if (gaps.length === 0) return null;
  const pool = gaps.length > 1 && previousIso2 ? gaps.filter((g) => g.iso2 !== previousIso2) : gaps;
  const country = pool[pickIndex(pool.length, random)];
  const restaurant = country.restaurants.length
    ? country.restaurants[pickIndex(country.restaurants.length, random)]
    : null;
  return { country, restaurant };
}

/** Delays (ms) between flag changes: quick at first, slowing to a stop on the winner. */
export function spinDelays(steps = 16, startMs = 60, endMs = 340): number[] {
  return Array.from({ length: steps }, (_, i) => {
    const t = steps === 1 ? 1 : i / (steps - 1);
    return Math.round(startMs + (endMs - startMs) * t * t);
  });
}

/** Link to the plan page another agent builds; the restaurant id is a uuid, but encode anyway. */
export function proposeDinnerHref(groupId: string, restaurantId: string): string {
  return `/group/${groupId}/plan/new?restaurant=${encodeURIComponent(restaurantId)}`;
}
