import type { Backfill, LogOutcome, SoloRestaurant, SoloStamp, SoloVisit } from "./types";

/** ISO dates and timestamps sort correctly as plain strings. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const byEarliestVisit = (a: SoloVisit, b: SoloVisit) =>
  cmp(a.visitedOn, b.visitedOn) || cmp(a.createdAt, b.createdAt);

/** A backfill has no visit date; the day it was recorded stands in (it is never shown). */
const dayOf = (createdAt: string) => createdAt.slice(0, 10);

/**
 * One stamp per country. A visit stamp comes from the country's earliest visit (ties go to the one
 * logged first) and replaces any backfill for that country; a country with only a backfill keeps
 * it. A visit whose restaurant no longer exists earns nothing. Oldest stamps first.
 */
export function deriveStamps(
  restaurants: readonly SoloRestaurant[],
  visits: readonly SoloVisit[],
  backfills: readonly Backfill[],
): SoloStamp[] {
  const countryOf = new Map(restaurants.map((r) => [r.id, r.countryIso2]));

  const earliest = new Map<string, SoloVisit>();
  for (const v of visits) {
    const iso2 = countryOf.get(v.restaurantId);
    if (!iso2) continue;
    const best = earliest.get(iso2);
    if (!best || byEarliestVisit(v, best) < 0) earliest.set(iso2, v);
  }

  const stamps = new Map<string, SoloStamp>();
  for (const b of backfills) {
    const earnedOn = dayOf(b.createdAt);
    const have = stamps.get(b.countryIso2);
    if (have && have.earnedOn <= earnedOn) continue;
    stamps.set(b.countryIso2, { countryIso2: b.countryIso2, kind: "backfilled", visitId: null, earnedOn });
  }
  for (const [iso2, v] of earliest) {
    stamps.set(iso2, { countryIso2: iso2, kind: "visit", visitId: v.id, earnedOn: v.visitedOn });
  }

  return [...stamps.values()].sort(
    (a, b) => cmp(a.earnedOn, b.earnedOn) || cmp(a.countryIso2, b.countryIso2),
  );
}

/** What logging a visit in this country does to its stamp, judged against the stamps before the visit. */
export function logOutcome(stamps: readonly SoloStamp[], countryIso2: string): LogOutcome {
  const have = stamps.find((s) => s.countryIso2 === countryIso2);
  if (!have) return "stamped";
  return have.kind === "backfilled" ? "upgraded" : "repeat";
}

/** The device's calendar date (YYYY-MM-DD), not the UTC one. */
export function localToday(now: Date): string {
  const y = String(now.getFullYear()).padStart(4, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Both dates are YYYY-MM-DD, so string order is date order. */
export function isFutureDate(visitedOn: string, today: string): boolean {
  return visitedOn > today;
}
