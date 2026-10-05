import { londonDate } from "./time";

export const MAX_NEW_STAMPS_PER_DAY = 3;
export const CONFIRM_WINDOW_DAYS = 7;
export const GROUP_MAX_MEMBERS = 20;
export const TABLE_BONUS_MIN = 3;

export const BASE_POINTS = 10;
export const TABLE_BONUS_POINTS = 5;
export const DISH_BONUS_POINTS = 2;
export const SET_BONUS_POINTS = 25;

export const GEO_MAX_ACCURACY_M = 500;
export const GEO_MAX_SLACK_M = 250;

export type Verification = "geo_verified" | "photo" | "self_reported";

/** Rarity bonus from the number of restaurants (active or reported_closed, plus the visited one; min 1). */
export function rarityBonus(count: number): number {
  if (!Number.isFinite(count) || count < 1) count = 1;
  if (count === 1) return 15;
  if (count <= 3) return 10;
  if (count <= 9) return 5;
  return 0;
}

/** Table bonus applies once >= 3 group members have confirmed the visit. */
export function tableBonusApplies(confirmedMembers: number): boolean {
  return confirmedMembers >= TABLE_BONUS_MIN;
}

/** Confirmations still needed for the table bonus; 0 once it applies. */
export function tablePending(confirmedMembers: number): number {
  return Math.max(0, TABLE_BONUS_MIN - confirmedMembers);
}

export interface PointsBreakdown {
  base: number;
  rarity: number;
  table: number;
  dish: number;
  total: number;
}

export interface StampPointsInput {
  rarityBonus: number;
  confirmedMembers?: number;
  tableBonus?: boolean;
  signatureDishMatches?: boolean;
  backfilled?: boolean;
}

/** Points for a stamp. Backfilled stamps score 0. Mirrors stamp_totals. */
export function stampPoints(i: StampPointsInput): PointsBreakdown {
  if (i.backfilled) return { base: 0, rarity: 0, table: 0, dish: 0, total: 0 };
  const base = BASE_POINTS;
  const rarity = i.rarityBonus;
  const table = (i.tableBonus ?? tableBonusApplies(i.confirmedMembers ?? 0)) ? TABLE_BONUS_POINTS : 0;
  const dish = i.signatureDishMatches ? DISH_BONUS_POINTS : 0;
  return { base, rarity, table, dish, total: base + rarity + table + dish };
}

/**
 * Whether another new stamp is allowed today (Europe/London day of `now`).
 * Counts stamps whose stamped_at falls on today's London date. Backfilled
 * stamps (null stamped_at) are ignored.
 */
export function capAllows(
  stampedAtList: Array<Date | string | null | undefined>,
  now: Date,
): boolean {
  const today = londonDate(now);
  const n = stampedAtList.filter((t) => t != null && londonDate(t) === today).length;
  return n < MAX_NEW_STAMPS_PER_DAY;
}

/** A set is active in a city when >= 2 of its countries are listed there. */
export function setActive(setCountries: string[], listed: Iterable<string>): boolean {
  const l = new Set(listed);
  return [...new Set(setCountries)].filter((c) => l.has(c)).length >= 2;
}

/** Complete: active, and a visit stamp for every listed country in the set. */
export function setComplete(
  setCountries: string[],
  listed: Iterable<string>,
  visitStamped: Iterable<string>,
): boolean {
  const l = new Set(listed);
  if (!setActive(setCountries, l)) return false;
  const s = new Set(visitStamped);
  return [...new Set(setCountries)].filter((c) => l.has(c)).every((c) => s.has(c));
}

/**
 * Season membership: inclusive London dates. Null bounds are open.
 * `ts` is a visit's visited_at (or a set award's awarded_at).
 */
export function seasonIncludes(
  ts: Date | string,
  seasonStart: string | null | undefined,
  seasonEnd: string | null | undefined,
): boolean {
  const d = londonDate(ts);
  if (seasonStart && d < seasonStart) return false;
  if (seasonEnd && d > seasonEnd) return false;
  return true;
}

/** geo_verified = accuracy <= 500 AND (distance - accuracy) <= 250. */
export function geoVerified(distanceM: number, accuracyM: number): boolean {
  if (!Number.isFinite(distanceM) || !Number.isFinite(accuracyM)) return false;
  return accuracyM <= GEO_MAX_ACCURACY_M && distanceM - accuracyM <= GEO_MAX_SLACK_M;
}

/** distance_m is stored rounded to 10 m. */
export function roundDistance(distanceM: number): number {
  return Math.round(distanceM / 10) * 10;
}

/** Visit verification: an owner downgrade wins; else geo; else photo; else self-reported. */
export function visitVerification(i: {
  geoVerified: boolean;
  hasPhoto: boolean;
  downgraded?: boolean;
}): Verification {
  if (i.downgraded) return "self_reported";
  if (i.geoVerified) return "geo_verified";
  if (i.hasPhoto) return "photo";
  return "self_reported";
}

/** Leaderboard filter for groups.verified_only. */
export function countsForVerifiedOnly(v: Verification): boolean {
  return v === "geo_verified" || v === "photo";
}
