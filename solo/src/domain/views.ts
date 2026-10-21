import { displayName } from "@/lib/countries";
import { summarisePassport, type PassportSummary } from "@/lib/passport";
import { buildPins, type MapRestaurant, type Pin } from "@/components/map/pins";
import type { WorldData } from "@/components/world/states";
import type { SeedCountry, SeedRestaurant, SoloRestaurant, SoloStamp, SoloVisit } from "./types";

/**
 * Adapters from solo data to the inputs the shared Passport, World and Map logic expects, so the
 * group app's components render solo data unchanged.
 */

/** Midday UTC, which `Stamp` formats in Europe/London without crossing a day. */
export function stampDate(earnedOn: string): string {
  return `${earnedOn}T12:00:00Z`;
}

export function buildPassport(input: {
  countries: SeedCountry[];
  listed: ReadonlySet<string>;
  stamps: readonly SoloStamp[];
  now: Date;
}): PassportSummary {
  const summary = summarisePassport({
    countries: input.countries,
    statusRows: [...input.listed].map((iso2) => ({ country_iso2: iso2, status: "listed" })),
    stamps: input.stamps.map((s) => ({
      country_iso2: s.countryIso2,
      points: 0,
      backfilled: s.kind === "backfilled",
      verification: "self_reported" as const,
      earned_at: stampDate(s.earnedOn),
      stamped_at: null,
    })),
    awards: [],
    attendances: [],
    now: input.now,
  });
  // Solo has no verification, so no country carries a badge.
  return { ...summary, countries: summary.countries.map((c) => ({ ...c, verification: null })) };
}

export function buildWorldData(input: {
  countries: SeedCountry[];
  listed: ReadonlySet<string>;
  stamps: readonly SoloStamp[];
}): WorldData {
  const countriesOf = (kind: SoloStamp["kind"]) =>
    input.stamps
      .filter((s) => s.kind === kind)
      .map((s) => s.countryIso2)
      .sort();
  return {
    countries: input.countries.map((c) => ({ iso2: c.iso2, iso_numeric: c.iso_numeric, name: displayName(c) })),
    listed: [...input.listed].sort(),
    visitStamped: countriesOf("visit"),
    backfilled: countriesOf("backfilled"),
    groups: [],
  };
}

/**
 * Map pins for the seed suggestions plus my own restaurants. A suggestion I have already copied
 * shows once, as my copy. Restaurants without coordinates are left off. The shared "friend has been
 * here" ring marks the restaurants I have visited.
 */
export function soloPins(input: {
  suggestions: SeedRestaurant[];
  own: SoloRestaurant[];
  visits: readonly SoloVisit[];
  stamps: readonly SoloStamp[];
  countryNames: ReadonlyMap<string, string>;
}): Pin[] {
  const copied = new Set(input.own.flatMap((r) => (r.seedId ? [r.seedId] : [])));

  const fromSeed: MapRestaurant[] = input.suggestions
    .filter((s) => !copied.has(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      country_iso2: s.countryIso2,
      address: s.address,
      postcode: s.postcode,
      lat: s.lat,
      lon: s.lon,
      status: "active",
      confidence: s.confidence,
      curator_note: s.curatorNote,
    }));

  const fromOwn: MapRestaurant[] = input.own.flatMap((r) =>
    r.lat === null || r.lon === null
      ? []
      : [
          {
            id: r.id,
            name: r.name,
            country_iso2: r.countryIso2,
            address: r.address,
            postcode: null,
            lat: r.lat,
            lon: r.lon,
            status: "active" as const,
            confidence: "community" as const,
            curator_note: null,
          },
        ],
  );

  const visitStamped = new Set(input.stamps.filter((s) => s.kind === "visit").map((s) => s.countryIso2));
  const visited = new Set(input.visits.map((v) => v.restaurantId));
  return buildPins([...fromSeed, ...fromOwn], visitStamped, visited, input.countryNames);
}
