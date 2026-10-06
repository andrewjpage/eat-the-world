import { CONFIRM_WINDOW_DAYS, MAX_NEW_STAMPS_PER_DAY, type Verification } from "./scoring";
import { londonDate } from "./time";

/**
 * Pure Passport-home maths (brief section 2: the honest denominator).
 * No I/O: src/components/passport/data.ts fetches the rows and calls this.
 */

/** How a country cell looks. Matches StampState in src/components/ui/Stamp. */
export type PassportState = "stamped" | "backfilled" | "listed" | "unlisted" | "uncharted";

export interface PassportCountryRow {
  iso2: string;
  name: string | null;
  iso_name: string | null;
  m49_group: string | null;
}

export interface PassportStatusRow {
  country_iso2: string;
  status: string;
}

export interface PassportStampRow {
  country_iso2: string;
  points: number;
  backfilled: boolean;
  verification: Verification;
  earned_at: string;
  stamped_at: string | null;
}

export interface PassportAttendanceRow {
  visit_id: string;
  status: "pending" | "confirmed" | "declined";
  stamp_waiting: boolean;
  visits: {
    visited_at: string;
    restaurants: { name: string; country_iso2: string } | null;
  } | null;
}

export interface PassportCountry {
  iso2: string;
  name: string;
  region: string;
  state: PassportState;
  date: string | null;
  verification: Verification | null;
}

export interface PendingItem {
  visitId: string;
  kind: "pending" | "waiting";
  restaurant: string;
  countryIso2: string | null;
  /** Waiting stamps only: true when today's cap is already full, so the claim must wait. */
  claimTomorrow: boolean;
}

export interface PassportSummary {
  countries: PassportCountry[];
  /** Listed countries with a visit stamp (backfilled stamps never count in London). */
  londonStamped: number;
  /** Countries with at least one eligible London restaurant. */
  londonListed: number;
  /** Every stamp, including backfilled ones. */
  anywhereStamps: number;
  /** Visit stamps plus set awards; backfilled stamps score 0. */
  points: number;
  isoTotal: number;
  pending: PendingItem[];
}

export function summarisePassport({
  countries,
  statusRows,
  stamps: stampRows,
  awards,
  attendances,
  now,
}: {
  countries: PassportCountryRow[];
  statusRows: PassportStatusRow[];
  stamps: PassportStampRow[];
  awards: { points: number }[];
  attendances: PassportAttendanceRow[];
  now: Date;
}): PassportSummary {
  const status = new Map(statusRows.map((r) => [r.country_iso2, r.status]));
  const stamps = new Map(stampRows.map((s) => [s.country_iso2, s]));

  let londonListed = 0;
  let londonStamped = 0;
  const list: PassportCountry[] = countries.map((c) => {
    const st = status.get(c.iso2) ?? "unlisted";
    const stamp = stamps.get(c.iso2);
    const visitStamp = stamp && !stamp.backfilled ? stamp : null;
    if (st === "listed") {
      londonListed++;
      if (visitStamp) londonStamped++;
    }
    let state: PassportState;
    if (stamp) state = stamp.backfilled ? "backfilled" : "stamped";
    else if (st === "listed") state = "listed";
    else if (st === "uncharted") state = "uncharted";
    else state = "unlisted";
    return {
      iso2: c.iso2,
      name: c.name || c.iso_name || c.iso2,
      region: c.m49_group || "Elsewhere",
      state,
      date: visitStamp ? visitStamp.earned_at : null,
      verification: visitStamp ? visitStamp.verification : null,
    };
  });

  const points =
    stampRows.filter((s) => !s.backfilled).reduce((n, s) => n + s.points, 0) +
    awards.reduce((n, a) => n + a.points, 0);

  // The daily cap counts stamps by stamped_at on today's London date (backfills have none).
  const today = londonDate(now);
  const stampedToday = stampRows.filter(
    (s) => s.stamped_at && londonDate(s.stamped_at) === today,
  ).length;
  const capFull = stampedToday >= MAX_NEW_STAMPS_PER_DAY;

  const cutoff = now.getTime() - CONFIRM_WINDOW_DAYS * 86_400_000;
  const pending: PendingItem[] = [];
  for (const a of attendances) {
    const r = a.visits?.restaurants;
    const item = {
      visitId: a.visit_id,
      restaurant: r?.name ?? "a restaurant",
      countryIso2: r?.country_iso2 ?? null,
    };
    if (a.status === "pending") {
      if (a.visits && new Date(a.visits.visited_at).getTime() >= cutoff) {
        pending.push({ ...item, kind: "pending", claimTomorrow: false });
      }
    } else if (a.stamp_waiting && a.status === "confirmed") {
      // SQL clears stamp_waiting only on claim, so a waiting row for a country
      // stamped since (at another visit) would claim as a repeat: drop it.
      const since = r ? stamps.get(r.country_iso2) : undefined;
      if (since && !since.backfilled) continue;
      pending.push({ ...item, kind: "waiting", claimTomorrow: capFull });
    }
  }
  pending.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "waiting" ? -1 : 1));

  return {
    countries: list,
    londonStamped,
    londonListed,
    anywhereStamps: stampRows.length,
    points,
    isoTotal: countries.length,
    pending,
  };
}
