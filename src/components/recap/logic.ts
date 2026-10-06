import { TIMEZONE } from "@/lib/time";

/**
 * stamped: earned a stamp on this visit. waiting: confirmed, but the daily cap held the stamp
 * back. repeat: confirmed, country already on their passport. pending: tagged, not confirmed yet.
 */
export type RecapState = "stamped" | "waiting" | "repeat" | "pending";

export interface RecapPerson {
  name: string;
  dish: string | null;
  rating: number | null;
  points: number;
  state: RecapState;
}

/** What goes where the points sit, and whether it is a points number (red, plus sign). */
export function recapPointsLabel(p: Pick<RecapPerson, "points" | "state">): { text: string; isPoints: boolean } {
  switch (p.state) {
    case "stamped":
      return { text: `+${p.points}`, isPoints: true };
    case "waiting":
      return { text: "Stamp waiting", isPoints: false };
    case "pending":
      return { text: "Confirming…", isPoints: false };
    default:
      return { text: "Repeat visit", isPoints: false };
  }
}

/** Points earned at this table: confirmed people only. */
export function recapTotal(people: Pick<RecapPerson, "points" | "state">[]): number {
  return people.reduce((s, p) => s + (p.state === "stamped" ? p.points : 0), 0);
}

/** The card's closing line. Never a sad zero. */
export function recapFooter(people: Pick<RecapPerson, "points" | "state">[]): string {
  const total = recapTotal(people);
  if (total > 0) return `${total} points on the table`;
  if (people.some((p) => p.state === "waiting" || p.state === "pending")) return "Stamps on the way";
  return "Back for seconds";
}

export const RECAP_MAX_PEOPLE = 6;

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: TIMEZONE,
});

export function recapDate(ts: Date | string): string {
  return dateFmt.format(typeof ts === "string" ? new Date(ts) : ts);
}

/** Dish line: the approved dish, else the free-text one, else null. */
export function dishLabel(approved: string | null | undefined, other: string | null | undefined): string | null {
  const v = (approved || other || "").trim();
  return v ? v.slice(0, 60) : null;
}

const STATE_ORDER: Record<RecapState, number> = { stamped: 0, waiting: 1, repeat: 2, pending: 3 };

/**
 * People shown on the card: highest points first, then confirmed before pending, then name;
 * the rest become "+N more".
 */
export function arrangePeople<P extends Pick<RecapPerson, "name" | "points"> & { state?: RecapState }>(
  people: P[],
  max = RECAP_MAX_PEOPLE,
) {
  const rank = (p: P) => STATE_ORDER[p.state ?? "stamped"];
  const sorted = [...people].sort(
    (a, b) => b.points - a.points || rank(a) - rank(b) || a.name.localeCompare(b.name),
  );
  return { shown: sorted.slice(0, max), more: Math.max(0, sorted.length - max) };
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Share text for the recap, also the wa.me fallback. */
export function recapText(r: {
  restaurantName: string;
  countryName: string;
  names: string[];
  totalPoints: number;
  link: string;
}): string {
  const who = r.names.length ? ` with ${joinNames(r.names)}` : "";
  const pts = r.totalPoints > 0 ? ` ${r.totalPoints} points on the table.` : "";
  return `Stamped ${r.countryName} at ${r.restaurantName}${who}.${pts} ${r.link}`.replace(/\s+/g, " ").trim();
}

export function recapWhatsAppUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
