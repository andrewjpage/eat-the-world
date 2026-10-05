import type { LeaderRow } from "./data";

/** Pure leaderboard helpers (the component is client-side; these are easy to test). */

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC", // the value is a calendar date (YYYY-MM-DD), not an instant
});

/** "1 Sep 2026" from a YYYY-MM-DD date. */
function fmt(d: string): string {
  return dateFmt.format(new Date(`${d}T00:00:00Z`));
}

/** Competition ranking: equal countries and points share a rank (1, 1, 3). Rows arrive sorted. */
export function rankRows(rows: LeaderRow[]): { row: LeaderRow; rank: number }[] {
  return rows.map((row, i) => {
    const first = rows.findIndex((r) => r.points === row.points && r.countries === row.countries);
    return { row, rank: first === -1 ? i + 1 : first + 1 };
  });
}

/** "1 Sep 2026 to 30 Sep 2026", "from ...", "until ...", or null when no dates are set. */
export function seasonLabel(start: string | null, end: string | null): string | null {
  if (start && end) return `${fmt(start)} to ${fmt(end)}`;
  if (start) return `from ${fmt(start)}`;
  if (end) return `until ${fmt(end)}`;
  return null;
}
