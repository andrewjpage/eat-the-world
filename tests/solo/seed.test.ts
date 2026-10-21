import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import { FALLBACK_DOTS, normNumeric } from "@/components/world/geometry";
import { dishesFor, listedCountries, seed } from "@solo/data/seed";

const root = resolve(__dirname, "../..");
const csv = (name: string): Record<string, string>[] =>
  parse(readFileSync(resolve(root, "seed", name), "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  });

const topo = JSON.parse(
  readFileSync(resolve(root, "node_modules/world-atlas/countries-50m.json"), "utf8"),
) as Topology;
const atlasIds = new Set(
  feature(topo, topo.objects.countries as GeometryCollection).features
    .map((f) => normNumeric(f.id))
    .filter((id): id is string => id !== null),
);

describe("bundled seed", () => {
  it("has 249 countries with unique codes", () => {
    expect(seed.countries).toHaveLength(249);
    expect(new Set(seed.countries.map((c) => c.iso2)).size).toBe(249);
    expect(Number.isNaN(Date.parse(seed.generatedAt))).toBe(false);
  });

  it("keeps every non-null iso_numeric a zero-padded three-digit string", () => {
    const numeric = seed.countries.flatMap((c) => (c.iso_numeric === null ? [] : [c.iso_numeric]));
    expect(numeric.length).toBeGreaterThan(200);
    for (const n of numeric) expect(n).toMatch(/^\d{3}$/);
    expect(seed.countries.find((c) => c.iso2 === "AF")!.iso_numeric).toBe("004");
  });

  it("has 68 London restaurants across 39 countries", () => {
    expect(seed.restaurants).toHaveLength(68);
    expect(listedCountries(seed).size).toBe(39);
  });

  it("every restaurant has an in-London position and a unique seed: id", () => {
    for (const r of seed.restaurants) {
      expect(Number.isFinite(r.lat), r.name).toBe(true);
      expect(Number.isFinite(r.lon), r.name).toBe(true);
      expect(r.lat, r.name).toBeGreaterThan(51.2);
      expect(r.lat, r.name).toBeLessThan(51.8);
      expect(r.lon, r.name).toBeGreaterThan(-0.6);
      expect(r.lon, r.name).toBeLessThan(0.3);
      expect(r.id, r.name).toMatch(/^seed:[a-z0-9-]+$/);
    }
    expect(new Set(seed.restaurants.map((r) => r.id)).size).toBe(seed.restaurants.length);
  });

  it("restaurants match the CSV: same names, countries and confidence flags", () => {
    const rows = csv("london-restaurants.csv");
    expect(seed.restaurants.map((r) => [r.name, r.countryIso2, r.postcode])).toEqual(
      rows.map((r) => [r.restaurant, r.country_iso2.toUpperCase(), r.postcode]),
    );
    // The group app's "community" tier has no solo equivalent: only "flagged" shows as contested.
    expect(seed.restaurants.filter((r) => r.confidence === "flagged")).toHaveLength(
      rows.filter((r) => r.confidence === "flagged").length,
    );
    for (const r of seed.restaurants) expect(["curated", "flagged"]).toContain(r.confidence);
  });

  it("every restaurant belongs to a seeded country", () => {
    const iso2s = new Set(seed.countries.map((c) => c.iso2));
    for (const r of seed.restaurants) expect(iso2s.has(r.countryIso2), r.name).toBe(true);
  });

  it("carries exactly the approved dishes from signature-dishes.csv", () => {
    const approved = csv("signature-dishes.csv").filter((r) => r.status === "approved");
    expect(approved.length).toBeGreaterThan(100);
    expect(seed.dishes).toHaveLength(approved.length);
    expect(seed.dishes.map((d) => [d.countryIso2, d.name])).toEqual(
      approved.map((r) => [r.country_iso2.toUpperCase(), r.dish]),
    );
    expect(new Set(seed.dishes.map((d) => d.id)).size).toBe(seed.dishes.length);
  });

  it("dishesFor returns one country's dishes", () => {
    const af = dishesFor(seed, "AF");
    expect(af.map((d) => d.name)).toEqual(
      expect.arrayContaining(["Kabuli Pulao", "Mantu", "Bolani", "Borani Banjan"]),
    );
    expect(af.every((d) => d.countryIso2 === "AF")).toBe(true);
    expect(dishesFor(seed, "ZZ")).toEqual([]);
  });

  it("every restaurant country is in the world atlas; the rest are in it or have a fallback dot", () => {
    const listed = listedCountries(seed);
    const missing = seed.countries.filter((c) => c.iso_numeric !== null && !atlasIds.has(c.iso_numeric));
    for (const c of missing) expect(listed.has(c.iso2), c.iso2).toBe(false);
    expect(missing.map((c) => c.iso2).sort()).toEqual(Object.keys(FALLBACK_DOTS).sort());
  });
});
