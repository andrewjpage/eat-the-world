/** Pure world-view logic (brief section 6.3): what colour each country is, and the counts. */

/**
 * - `stamped`: a visit stamp (mine, or any member's in group view): stamp red
 * - `backfilled`: mine only, done before the app: sepia
 * - `listed`: London has a specialist but nobody has stamped it: outline
 * - `neutral`: everything else
 */
export type WorldState = "stamped" | "backfilled" | "listed" | "neutral";

export interface CountryState {
  state: WorldState;
  /** Group view: the share of members with a visit stamp (0..1), for shading. Mine: 1 or 0. */
  share: number;
}

const NEUTRAL: CountryState = { state: "neutral", share: 0 };

/** My view. A visit stamp wins over a backfilled one, which wins over "listed". */
export function mineStates(input: {
  iso2s: readonly string[];
  listed: ReadonlySet<string>;
  visitStamped: ReadonlySet<string>;
  backfilled: ReadonlySet<string>;
}): Map<string, CountryState> {
  const out = new Map<string, CountryState>();
  for (const iso2 of input.iso2s) {
    if (input.visitStamped.has(iso2)) out.set(iso2, { state: "stamped", share: 1 });
    else if (input.backfilled.has(iso2)) out.set(iso2, { state: "backfilled", share: 1 });
    else if (input.listed.has(iso2)) out.set(iso2, { state: "listed", share: 0 });
    else out.set(iso2, NEUTRAL);
  }
  return out;
}

/** The group's combined visit stamps. `counts` maps a country to how many members have stamped it. */
export function groupStates(input: {
  iso2s: readonly string[];
  listed: ReadonlySet<string>;
  counts: Readonly<Record<string, number>>;
  members: number;
}): Map<string, CountryState> {
  const out = new Map<string, CountryState>();
  for (const iso2 of input.iso2s) {
    const n = input.counts[iso2] ?? 0;
    if (n > 0) out.set(iso2, { state: "stamped", share: Math.min(1, n / Math.max(1, input.members)) });
    else if (input.listed.has(iso2)) out.set(iso2, { state: "listed", share: 0 });
    else out.set(iso2, NEUTRAL);
  }
  return out;
}

export interface WorldSummary {
  stamped: number;
  /** Mine only; 0 in group view. */
  backfilled: number;
  /** Countries London lists that have no visit stamp yet. */
  toGo: number;
  /** Countries London lists. */
  listed: number;
}

/** Counts for the header. `toGo` is listed minus visit-stamped, so a backfilled country still counts as to go. */
export function summarise(
  states: ReadonlyMap<string, CountryState>,
  listed: ReadonlySet<string>,
): WorldSummary {
  let stamped = 0;
  let backfilled = 0;
  let toGo = 0;
  for (const [iso2, s] of states) {
    if (s.state === "stamped") stamped++;
    else if (s.state === "backfilled") backfilled++;
    if (listed.has(iso2) && s.state !== "stamped") toGo++;
  }
  return { stamped, backfilled, toGo, listed: listed.size };
}

export interface WorldGroup {
  id: string;
  name: string;
  members: number;
  /** country iso2 -> members with a visit stamp for it (only countries with at least one). */
  counts: Record<string, number>;
}

export interface WorldCountry {
  iso2: string;
  iso_numeric: string | null;
  name: string;
}

export interface WorldData {
  countries: WorldCountry[];
  listed: string[];
  visitStamped: string[];
  backfilled: string[];
  groups: WorldGroup[];
}

/** Map from numeric id ("004") to the country it belongs to. */
export function byNumeric(countries: readonly WorldCountry[]): Map<string, WorldCountry> {
  const m = new Map<string, WorldCountry>();
  for (const c of countries) if (c.iso_numeric) m.set(c.iso_numeric, c);
  return m;
}
