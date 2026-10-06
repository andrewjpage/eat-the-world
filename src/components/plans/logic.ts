import { buildIcs } from "@/lib/ics";
import { TIMEZONE } from "@/lib/time";

export type Rsvp = "yes" | "no" | "maybe";
export type PlanStatus = "proposed" | "booked" | "done" | "cancelled";

export const PLAN_DURATION_MS = 2 * 3600_000;

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Wall-clock time in Europe/London, expressed as if it were UTC (ms). */
function londonWallAsUtc(ms: number): number {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

/**
 * The instant for a London wall-clock date ("YYYY-MM-DD") and time ("HH:MM"), DST-safe.
 * Returns null for malformed input or a time that does not exist (the spring-forward gap).
 */
export function londonToInstant(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [y, mo, da, h, mi] = [+d[1], +d[2], +d[3], +t[1], +t[2]];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, da, h, mi);
  // Calendar overflow (31 Feb) rolls over: reject.
  if (new Date(wall).getUTCDate() !== da) return null;
  let guess = wall - (londonWallAsUtc(wall) - wall);
  guess = wall - (londonWallAsUtc(guess) - guess);
  // A skipped hour does not round-trip.
  if (londonWallAsUtc(guess) !== wall) return null;
  return new Date(guess);
}

/** The default dinner time on a new plan (London). */
export const DEFAULT_PLAN_TIME = "19:30";

/** YYYY-MM-DD as a UTC-midnight Date, for day arithmetic only. */
const dayUtc = (date: string) => new Date(`${date}T00:00:00Z`);

/**
 * The London date of the next Friday dinner: this Friday, or next week's once this
 * Friday's DEFAULT_PLAN_TIME has passed. Used to make Spin -> plan one tap.
 */
export function nextFridayLondon(now: Date = new Date()): string {
  const today = londonToInstant(londonWallDate(now), DEFAULT_PLAN_TIME);
  const d = dayUtc(londonWallDate(now));
  let days = (5 - d.getUTCDay() + 7) % 7;
  if (days === 0 && today && now.getTime() >= today.getTime()) days = 7;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A ?date= value worth prefilling: a real YYYY-MM-DD, today (London) or later, within a year. */
export function parsePlanDate(v: unknown, now: Date = new Date()): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  if (!londonToInstant(v, "12:00")) return null;
  const today = londonWallDate(now);
  const days = (dayUtc(v).getTime() - dayUtc(today).getTime()) / 86_400_000;
  return days >= 0 && days <= 366 ? v : null;
}

function londonWallDate(now: Date): string {
  const p = Object.fromEntries(partsFmt.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const whenFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Sat 12 Oct, 19:30" in London time. Built from numeric parts and fixed names, so the server
 * (Node's ICU) and every browser give the same string and the plan card hydrates cleanly.
 */
export function formatWhen(ts: Date | string): string {
  const p = Object.fromEntries(
    whenFmt.formatToParts(typeof ts === "string" ? new Date(ts) : ts).map((x) => [x.type, x.value]),
  );
  const y = Number(p.year);
  const m = Number(p.month);
  const d = Number(p.day);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m - 1]}, ${p.hour}:${p.minute}`;
}

export interface PlanRsvpSummary {
  yes: string[];
  maybe: string[];
  no: string[];
}

/** Group RSVP rows into names per answer, sorted by name. */
export function summariseRsvps(rows: { response: Rsvp; name: string }[]): PlanRsvpSummary {
  const out: PlanRsvpSummary = { yes: [], maybe: [], no: [] };
  for (const r of rows) out[r.response].push(r.name);
  for (const k of Object.keys(out) as Rsvp[]) out[k].sort((a, b) => a.localeCompare(b));
  return out;
}

/** Is the plan still worth listing? Proposed or booked, and not more than 3 hours past. */
export function isUpcoming(plan: { status: PlanStatus; proposed_for: string }, now: Date): boolean {
  if (plan.status !== "proposed" && plan.status !== "booked") return false;
  return new Date(plan.proposed_for).getTime() >= now.getTime() - 3 * 3600_000;
}

export interface PlanForShare {
  id: string;
  proposed_for: string;
  restaurant: { name: string; address?: string | null; postcode?: string | null };
}

/** The .ics for a plan: a 2 hour event at the restaurant. */
export function planIcs(plan: PlanForShare, groupName: string, groupUrl: string, now = new Date()): string {
  const start = new Date(plan.proposed_for);
  const where = [plan.restaurant.address, plan.restaurant.postcode].filter(Boolean).join(", ");
  return buildIcs({
    uid: `${plan.id}@eattheworld`,
    start,
    end: new Date(start.getTime() + PLAN_DURATION_MS),
    summary: `Dinner at ${plan.restaurant.name}`,
    location: [plan.restaurant.name, where].filter(Boolean).join(", "),
    description: `${groupName} dinner, planned on Eat the World. ${groupUrl}`,
    now,
  });
}

/** Download file name, e.g. "dinner-the-golden-dragon.ics". */
export function icsFilename(restaurantName: string): string {
  const slug = restaurantName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `dinner-${slug || "plan"}.ics`;
}

/** wa.me link with the plan and an absolute link to the group. */
export function planWhatsAppUrl(p: { restaurantName: string; proposedFor: Date | string; groupUrl: string }): string {
  const text = `Dinner at ${p.restaurantName}, ${formatWhen(p.proposedFor)}. Are you in? ${p.groupUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
