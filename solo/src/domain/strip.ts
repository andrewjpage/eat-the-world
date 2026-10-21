import type { PassportCountry } from "@/lib/passport";

/** The passport's "Your stamps" strip shows at most this many. */
export const STRIP_CAP = 12;

/**
 * The stamps to lift to the top of the passport, from the summary's countries so the strip and the
 * grid below it agree. Visit stamps come first, newest first; memories (stamped before the app)
 * follow, A to Z. `total` counts every stamp, including those the cap leaves out.
 */
export function stampStrip(
  countries: readonly PassportCountry[],
  cap: number = STRIP_CAP,
): { shown: PassportCountry[]; total: number } {
  const byName = (a: PassportCountry, b: PassportCountry) => a.name.localeCompare(b.name);
  // A visit stamp's date is an ISO timestamp, so plain string order is date order.
  const newestFirst = (a: PassportCountry, b: PassportCountry) =>
    (b.date ?? "").localeCompare(a.date ?? "") || byName(a, b);

  const visits = countries.filter((c) => c.state === "stamped").sort(newestFirst);
  const memories = countries.filter((c) => c.state === "backfilled").sort(byName);
  const all = [...visits, ...memories];
  return { shown: all.slice(0, cap), total: all.length };
}
