import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import { loadCountries } from "../../scripts/lib/countries-data";
import type { Geometry } from "geojson";
import { areaDeg2, dotPoint, FALLBACK_DOTS, fixAntimeridian, isSmall, normNumeric } from "@/components/world/geometry";

const root = resolve(__dirname, "../..");
const topo = JSON.parse(
  readFileSync(resolve(root, "node_modules/world-atlas/countries-50m.json"), "utf8"),
) as Topology;
const countries = loadCountries(resolve(root, "seed/iso-3166-all.csv"), resolve(root, "seed/country-display-names.csv"));
const byIso2 = new Map(countries.map((c) => [c.iso2, c]));
const fc = feature(topo, topo.objects.countries as GeometryCollection);
const atlasIds = new Set(fc.features.map((f) => normNumeric(f.id)).filter((id): id is string => id !== null));

describe("world-atlas countries-50m join", () => {
  it("is the 50m file, version 2.0.2", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "node_modules/world-atlas/package.json"), "utf8"));
    expect(pkg.version).toBe("2.0.2");
    // 50m keeps small islands the 110m file drops (Mauritius).
    expect(atlasIds.has("480")).toBe(true);
  });

  it("every country listed in the London seed has its numeric code in the atlas", () => {
    const rows = parse(readFileSync(resolve(root, "seed/london-restaurants.csv"), "utf8"), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    }) as { country_iso2: string }[];
    const listed = [...new Set(rows.map((r) => r.country_iso2.toUpperCase()))];
    expect(listed.length).toBeGreaterThan(30);
    const missing = listed.filter((iso2) => {
      const c = byIso2.get(iso2);
      return !c || !atlasIds.has(c.iso_numeric);
    });
    expect(missing).toEqual([]);
  });

  it("ids are zero-padded three-digit strings on both sides of the join", () => {
    for (const f of fc.features) {
      if (f.id === undefined) continue;
      expect(String(f.id)).toMatch(/^\d{3}$/);
    }
    for (const c of countries) expect(c.iso_numeric).toMatch(/^\d{3}$/);
    expect(byIso2.get("AF")!.iso_numeric).toBe("004");
    expect(atlasIds.has("004")).toBe(true);
  });

  it("Kosovo, Northern Cyprus and Somaliland have no id, so they never join", () => {
    const unnamed = fc.features
      .filter((f) => f.id === undefined)
      .map((f) => (f.properties as { name: string }).name);
    expect(unnamed).toEqual(expect.arrayContaining(["Kosovo", "N. Cyprus", "Somaliland"]));
  });

  it("every ISO country is either in the atlas or has a fallback dot", () => {
    const absent = countries.filter((c) => !atlasIds.has(c.iso_numeric)).map((c) => c.iso2);
    expect(absent.sort()).toEqual(Object.keys(FALLBACK_DOTS).sort());
    for (const [lat, lon] of Object.values(FALLBACK_DOTS)) {
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
    }
  });
});

describe("small countries get a dot", () => {
  const geom = (iso2: string) => fc.features.find((f) => normNumeric(f.id) === byIso2.get(iso2)!.iso_numeric)!.geometry;

  it("MU, SG, BH, MT, MV and SC are too small to see", () => {
    for (const iso2 of ["MU", "SG", "BH", "MT", "MV", "SC"]) {
      expect(isSmall(geom(iso2)), iso2).toBe(true);
    }
  });

  it("large and mid-sized countries are drawn as shapes only", () => {
    for (const iso2 of ["FR", "LA", "NG", "ET", "GB", "IT", "JP", "LK", "FJ"]) {
      expect(isSmall(geom(iso2)), iso2).toBe(false);
    }
  });

  it("areaDeg2 sums every piece of a multipolygon", () => {
    const sq = (x: number, y: number, s: number) => [
      [x, y],
      [x + s, y],
      [x + s, y + s],
      [x, y + s],
      [x, y],
    ];
    expect(areaDeg2({ type: "Polygon", coordinates: [sq(0, 0, 2)] })).toBe(4);
    expect(areaDeg2({ type: "MultiPolygon", coordinates: [[sq(0, 0, 2)], [sq(10, 10, 1)]] })).toBe(5);
    expect(areaDeg2({ type: "Point", coordinates: [0, 0] })).toBe(0);
  });

  it("puts the dot on one of the country's own islands", () => {
    const at = dotPoint(geom("MU"))!;
    expect(at[0]).toBeGreaterThan(-21);
    expect(at[0]).toBeLessThan(-19.5);
    expect(at[1]).toBeGreaterThan(57);
    expect(at[1]).toBeLessThan(58);
    // Kiribati straddles the antimeridian: an all-pieces centroid would land mid-Atlantic near 0.
    expect(isSmall(geom("KI"))).toBe(true);
    const ki = dotPoint(geom("KI"))!;
    expect(Math.abs(ki[1])).toBeGreaterThan(150);
    expect(Math.abs(ki[0])).toBeLessThan(12);
  });

  it("normNumeric pads and rejects junk", () => {
    expect(normNumeric(4)).toBe("004");
    expect(normNumeric("076")).toBe("076");
    expect(normNumeric(undefined)).toBeNull();
    expect(normNumeric("")).toBeNull();
    expect(normNumeric("abc")).toBeNull();
  });
});

describe("antimeridian fix", () => {
  const rings = (g: Geometry): number[][][] =>
    g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : [];
  const maxJump = (g: Geometry) =>
    Math.max(0, ...rings(g).flatMap((r) => r.slice(1).map((p, i) => Math.abs(p[0] - r[i][0]))));
  const featureOf = (iso2: string) => fc.features.find((f) => normNumeric(f.id) === byIso2.get(iso2)!.iso_numeric)!;
  const iso2Of = (id: string | number | undefined) => countries.find((c) => c.iso_numeric === normNumeric(id))?.iso2;

  it("the raw atlas has rings that jump across the world (so a flat map needs the fix)", () => {
    expect(maxJump(featureOf("RU").geometry)).toBeGreaterThan(300);
  });

  it("after the fix no ring jumps more than 180 degrees between points", () => {
    for (const f of fc.features) {
      expect(maxJump(fixAntimeridian(f.geometry)), String((f.properties as { name?: string } | null)?.name)).toBeLessThan(180);
    }
  });

  it("keeps Russia whole with Chukotka just past +180, and tames Fiji's cut-line sliver", () => {
    const ru = fixAntimeridian(featureOf("RU").geometry);
    const lons = rings(ru).flatMap((r) => r.map((p) => p[0]));
    expect(Math.max(...lons)).toBeGreaterThan(180);
    expect(Math.max(...lons)).toBeLessThan(195);
    expect(rings(ru).length).toBe(rings(featureOf("RU").geometry).length);
    // Fiji's cut-line sliver spans -180..180 in the raw atlas; unwrapped it collapses to a speck.
    const fj = featureOf("FJ").geometry;
    expect(areaDeg2(fj)).toBeGreaterThan(10);
    expect(areaDeg2(fixAntimeridian(fj))).toBeLessThan(3);
    expect(isSmall(fixAntimeridian(fj))).toBe(false);
    // Only Antarctica (a ring round the pole, never drawn) loses a piece.
    for (const f of fc.features) {
      if (iso2Of(f.id) === "AQ") continue;
      expect(rings(fixAntimeridian(f.geometry)).length, String((f.properties as { name?: string } | null)?.name)).toBe(rings(f.geometry).length);
    }
  });

  it("leaves non-polygon geometry alone", () => {
    const pt: Geometry = { type: "Point", coordinates: [1, 2] };
    expect(fixAntimeridian(pt)).toBe(pt);
  });
});
