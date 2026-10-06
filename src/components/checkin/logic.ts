/**
 * Pure check-in logic shared by the browser, the /api/check-in route handler and
 * the /visit server actions: input validation, StampResult parsing, friendly
 * error mapping, copy and the WhatsApp nudge link. No I/O and no logging.
 *
 * Privacy: a location is validated and handed on, never stored or echoed in an error.
 */
import { APP_NAME } from "@/lib/app";
import { haversineMetres, type LatLon } from "@/lib/geo";
import {
  BASE_POINTS,
  CONFIRM_WINDOW_DAYS,
  DISH_BONUS_POINTS,
  GEO_MAX_ACCURACY_M,
  GEO_MAX_SLACK_M,
  MAX_NEW_STAMPS_PER_DAY,
  TABLE_BONUS_MIN,
  rarityBonus,
  type PointsBreakdown,
} from "@/lib/scoring";
import { londonDate } from "@/lib/time";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_DISH_OTHER = 120;
export const MAX_NOTE = 1000;
export const MAX_TAGGED = 25;
/** A check-in body is a few hundred bytes; anything bigger is not ours. */
export const MAX_BODY_BYTES = 8 * 1024;

export type StampOutcome = "stamped" | "upgraded" | "repeat" | "waiting" | "no_change";
export type VerificationKind = "geo_verified" | "photo" | "self_reported";

/** The jsonb every stamp-producing database function returns (docs/architecture.md). */
export interface StampResult {
  visit_id: string;
  outcome: StampOutcome;
  country_iso2: string;
  points: PointsBreakdown | null;
  table_pending: number;
  first_in_group: boolean;
  verification: VerificationKind;
}

const OUTCOMES: readonly StampOutcome[] = ["stamped", "upgraded", "repeat", "waiting", "no_change"];
const VERIFICATIONS: readonly VerificationKind[] = ["geo_verified", "photo", "self_reported"];

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);

/** Checks the shape of a StampResult coming back from Postgres; null if it is not one. */
export function parseStampResult(x: unknown): StampResult | null {
  if (!isObj(x)) return null;
  const { visit_id, outcome, country_iso2, points, table_pending, first_in_group, verification } = x;
  if (typeof visit_id !== "string" || !UUID_RE.test(visit_id)) return null;
  if (!OUTCOMES.includes(outcome as StampOutcome)) return null;
  if (typeof country_iso2 !== "string" || !/^[A-Z]{2}$/.test(country_iso2)) return null;
  if (!VERIFICATIONS.includes(verification as VerificationKind)) return null;
  let p: PointsBreakdown | null = null;
  if (points !== null && points !== undefined) {
    if (!isObj(points)) return null;
    const { base, rarity, table, dish, total } = points;
    if (![base, rarity, table, dish, total].every(isInt)) return null;
    p = { base, rarity, table, dish, total } as PointsBreakdown;
  }
  return {
    visit_id,
    outcome: outcome as StampOutcome,
    country_iso2,
    points: p,
    table_pending: isInt(table_pending) ? table_pending : 0,
    first_in_group: first_in_group === true,
    verification: verification as VerificationKind,
  };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/** What the dish picker, rating and note produce. */
export interface AttendanceInput {
  signatureDishId: string | null;
  dishOther: string | null;
  rating: number | null;
  note: string | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function text(x: unknown, max: number): string | null | undefined {
  if (x === null || x === undefined) return null;
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  if (t.length > max) return undefined;
  return t === "" ? null : t;
}

/** Validates the dish, rating and note (types, ranges, uuid format). */
export function parseAttendanceInput(x: unknown): Parsed<AttendanceInput> {
  if (!isObj(x)) return { ok: false, error: "That didn't look right. Please try again." };
  const dishId = x.signatureDishId ?? null;
  if (dishId !== null && (typeof dishId !== "string" || !UUID_RE.test(dishId))) {
    return { ok: false, error: "That dish isn't on the list." };
  }
  const rating = x.rating ?? null;
  if (rating !== null && (!isInt(rating) || rating < 1 || rating > 5)) {
    return { ok: false, error: "Ratings go from 1 to 5." };
  }
  const other = text(x.dishOther, MAX_DISH_OTHER);
  if (other === undefined) {
    return { ok: false, error: `Keep the dish name under ${MAX_DISH_OTHER} characters.` };
  }
  const note = text(x.note, MAX_NOTE);
  if (note === undefined) {
    return { ok: false, error: `Keep the note under ${MAX_NOTE} characters.` };
  }
  return {
    ok: true,
    value: {
      signatureDishId: dishId as string | null,
      // An approved dish wins over free text, like the dish picker.
      dishOther: dishId ? null : other,
      rating: rating as number | null,
      note,
    },
  };
}

/** A position reading from the browser. Held in memory only, sent once in the POST body. */
export interface Fix {
  lat: number;
  lon: number;
  accuracy: number;
}

export interface CheckInBody extends AttendanceInput {
  restaurantId: string;
  groupId: string;
  tagged: string[];
  /** Null when the person skipped or location failed: the visit is self-reported. */
  location: Fix | null;
  /** One random uuid per check-in, so a retry can't create a second visit. */
  clientKey: string | null;
}

const isFiniteNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function parseFix(x: unknown): Fix | null {
  if (!isObj(x)) return null;
  const { lat, lon, accuracy } = x;
  if (!isFiniteNum(lat) || !isFiniteNum(lon) || !isFiniteNum(accuracy)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180 || accuracy < 0) return null;
  return { lat, lon, accuracy };
}

/**
 * Validates the JSON body of POST /api/check-in. Error strings are fixed and never
 * include any part of the input. An unusable location is dropped (the check-in
 * continues unverified); it is not an error.
 */
export function parseCheckInBody(x: unknown): Parsed<CheckInBody> {
  if (!isObj(x)) return { ok: false, error: "That didn't look right. Please try again." };
  if (typeof x.restaurantId !== "string" || !UUID_RE.test(x.restaurantId)) {
    return { ok: false, error: "We couldn't find that restaurant." };
  }
  if (typeof x.groupId !== "string" || !UUID_RE.test(x.groupId)) {
    return { ok: false, error: "Pick a group to check in with." };
  }
  const tagged = x.tagged ?? [];
  if (!Array.isArray(tagged) || tagged.length > MAX_TAGGED) {
    return { ok: false, error: "You can tag up to 25 people." };
  }
  if (!tagged.every((t) => typeof t === "string" && UUID_RE.test(t))) {
    return { ok: false, error: "We couldn't tell who you tagged. Please try again." };
  }
  const clientKey = x.clientKey ?? null;
  if (clientKey !== null && (typeof clientKey !== "string" || !UUID_RE.test(clientKey))) {
    return { ok: false, error: "That didn't look right. Please try again." };
  }
  const attendance = parseAttendanceInput(x);
  if (!attendance.ok) return attendance;
  return {
    ok: true,
    value: {
      restaurantId: x.restaurantId,
      groupId: x.groupId,
      tagged: [...new Set(tagged as string[])],
      location: parseFix(x.location),
      clientKey: clientKey as string | null,
      ...attendance.value,
    },
  };
}

// ---------------------------------------------------------------------------
// Friendly errors
// ---------------------------------------------------------------------------

/** What _require_uid() raises when the session has expired. */
export const SIGNED_OUT_DB_MESSAGE = "Please sign in first.";

/**
 * The only database messages shown to people: the sentences our SQL functions
 * raise on purpose. Anything else (including a driver or type error that could
 * quote a value) becomes the fallback, so input is never echoed back. A unit test
 * checks that a migration still raises each one word for word.
 */
export const KNOWN_DB_MESSAGES: readonly string[] = [
  SIGNED_OUT_DB_MESSAGE,
  "You can only check in with a group you belong to.",
  "We couldn't find that restaurant.",
  "That dish isn't on the list.",
  "Ratings go from 1 to 5.",
  "You can only tag people in this group.",
  "You weren't tagged on this visit.",
  "You've already declined this visit.",
  "You've already confirmed this visit.",
  "This visit is more than 7 days old, so it can't be confirmed now.",
  "You weren't on this visit.",
];

export function friendlyDbMessage(message: string | null | undefined, fallback: string): string {
  const m = message?.trim();
  return m && KNOWN_DB_MESSAGES.includes(m) ? m : fallback;
}

export const CHECK_IN_FALLBACK = "We couldn't save that check-in. Check your signal and try again.";

// ---------------------------------------------------------------------------
// Copy, links and dates
// ---------------------------------------------------------------------------

export interface OutcomeCopy {
  title: string;
  body: string | null;
  /** Whether the stamp is inked on screen. */
  inked: boolean;
}

/** Brief section 2 wording for each outcome. A waiting stamp is never a refusal. */
export function outcomeCopy(outcome: StampOutcome): OutcomeCopy {
  switch (outcome) {
    case "stamped":
      return { title: "Stamped!", body: null, inked: true };
    case "upgraded":
      return {
        title: "Upgraded!",
        body: "Your before-the-app stamp is now a full stamp.",
        inked: true,
      };
    case "repeat":
      return {
        title: "Already stamped",
        body: "Already stamped — logged as a repeat visit, 0 points.",
        inked: false,
      };
    case "waiting":
      return {
        title: "Stamp waiting",
        body: "Stamp waiting: claim it tomorrow. Three new stamps a day keeps it fair, and your points are saved.",
        inked: false,
      };
    case "no_change":
      return { title: "All set", body: "Nothing new to stamp here.", inked: false };
  }
}

/** The text of a "+5 when N more confirm" hint, or null when the table bonus is settled. */
export function tableHint(pending: number): string | null {
  if (pending <= 0) return null;
  return `+5 when ${pending} more confirm`;
}

/** The absolute wa.me link that nudges the table to confirm on /visit/[id]. */
export function nudgeUrl(opts: { visitId: string; restaurantName: string; baseUrl: string }): string {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const link = `${base}/visit/${opts.visitId}`;
  const msg = `I checked us in at ${opts.restaurantName} on ${APP_NAME}. Tap to confirm you were there: ${link}`;
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

/** "120 m", "1.4 km". Rounded, so it never implies precision a postcode centroid can't give. */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

/** True while a pending attendance can still be confirmed (7 days from the visit). */
export function confirmWindowOpen(visitedAt: string | Date, now: Date = new Date()): boolean {
  const t = (visitedAt instanceof Date ? visitedAt : new Date(visitedAt)).getTime();
  return now.getTime() <= t + CONFIRM_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** True when the daily cap of new stamps is already used on the London day of `now`. */
export function dailyCapFull(stampedAts: (string | null)[], now: Date = new Date()): boolean {
  const today = londonDate(now);
  const used = stampedAts.filter((s) => s && londonDate(s) === today).length;
  return used >= MAX_NEW_STAMPS_PER_DAY;
}

/** Whether a restaurant (a nearby candidate) matches a search query. */
export function matchesQuery(
  r: { name: string; address?: string | null; postcode?: string | null; country?: string | null },
  query: string,
): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = [r.name, r.address, r.postcode, r.country].filter(Boolean).join(" ").toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export const LAST_GROUP_KEY = "ett:last-group";

/** The remembered group if it is still one of mine, else the first. */
export function pickDefaultGroup(groupIds: string[], remembered: string | null): string | null {
  if (remembered && groupIds.includes(remembered)) return remembered;
  return groupIds[0] ?? null;
}

// ---------------------------------------------------------------------------
// Retries and the predicted stamp (brief section 4, Speed)
// ---------------------------------------------------------------------------

/**
 * Whether a failed POST /api/check-in is worth sending again with the same client key:
 * no reply at all (null), a timeout, rate limiting or a server error. Other 4xx are final.
 */
export function retryable(status: number | null): boolean {
  return status === null || status === 408 || status === 429 || status >= 500;
}

/** How many times the browser sends a check-in before showing "Not saved yet". */
export const CHECK_IN_ATTEMPTS = 3;

/** The pause before attempt `n` (2 or 3): 1 s, then 3 s. */
export function retryDelayMs(n: number): number {
  return n <= 2 ? 1000 : 3000;
}

/** What the check-in page knows before the server answers. */
export interface StampPrediction {
  /** The user already has a visit stamp for the country: a repeat. */
  hasVisitStamp: boolean;
  /** The user's only stamp for the country is a "before the app" one: an upgrade. */
  hasBackfilledStamp: boolean;
  /** The user's recent stamped_at values, to count today's new stamps (London). */
  stampedAts: (string | null)[];
  /** Restaurants counted for rarity: city_country_status.restaurant_count, +1 if this one isn't counted. */
  rarityCount: number;
  /** Whether no other member of each group has a visit stamp for the country, by group id. */
  firstInGroup: Record<string, boolean>;
}

/** A placeholder visit id for the predicted result (never sent or linked). */
export const PREDICTED_VISIT_ID = "00000000-0000-4000-8000-000000000000";

/**
 * The StampResult the server will most likely return, so the stamp shows straight away.
 * The server's answer replaces it. table_pending is 0 unless at least two friends are
 * tagged: only they can make the table, and the checker is the first of three.
 */
export function predictStampResult(
  p: StampPrediction,
  input: {
    countryIso2: string;
    groupId: string;
    dishBonus: boolean;
    tagged: number;
    verification: VerificationKind;
  },
  now: Date = new Date(),
): StampResult {
  const outcome: StampOutcome = p.hasVisitStamp
    ? "repeat"
    : dailyCapFull(p.stampedAts, now)
      ? "waiting"
      : p.hasBackfilledStamp
        ? "upgraded"
        : "stamped";
  const inked = outcome === "stamped" || outcome === "upgraded";
  const rarity = rarityBonus(p.rarityCount);
  const dish = input.dishBonus ? DISH_BONUS_POINTS : 0;
  const needed = TABLE_BONUS_MIN - 1;
  return {
    visit_id: PREDICTED_VISIT_ID,
    outcome,
    country_iso2: input.countryIso2,
    points: inked
      ? { base: BASE_POINTS, rarity, table: 0, dish, total: BASE_POINTS + rarity + dish }
      : null,
    table_pending: input.tagged >= needed ? needed : 0,
    first_in_group: inked && p.firstInGroup[input.groupId] === true,
    verification: input.verification,
  };
}

/**
 * The brief's geo_verified rule, worked out on the phone for the predicted stamp only.
 * The position stays on the device; the server decides the real badge.
 */
export function predictVerification(fix: Fix | null, place: LatLon | null): VerificationKind {
  if (!fix || !place) return "self_reported";
  const distance = Math.round(haversineMetres(fix, place) / 10) * 10;
  return fix.accuracy <= GEO_MAX_ACCURACY_M && distance - fix.accuracy <= GEO_MAX_SLACK_M
    ? "geo_verified"
    : "self_reported";
}
