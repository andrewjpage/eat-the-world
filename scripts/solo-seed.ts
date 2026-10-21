/**
 * Generates the seed data the solo app bundles: solo/src/data/seed.json (committed).
 * Reads the same CSVs as scripts/seed.ts and geocodes the postcodes once, here, so the app
 * never calls a geocoder at runtime.
 * Usage: npm run solo:seed   (needs network access to postcodes.io)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import type { SeedCountry, SeedData, SeedDish, SeedRestaurant } from "../solo/src/domain/types";
import { assertCountries, loadCountries } from "./lib/countries-data";
import { geocodePostcodes, normalisePostcode } from "./lib/geocode";

const SEED = resolve(process.cwd(), "seed");
const OUT = resolve(process.cwd(), "solo/src/data/seed.json");

const csv = (name: string): Record<string, string>[] =>
  parse(readFileSync(resolve(SEED, name), "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  });

/** Lower-case ASCII slug: accents folded, everything else collapsed to single hyphens. */
const slug = (...parts: string[]) =>
  parts
    .join(" ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function assertUnique(label: string, ids: string[]): void {
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`Duplicate ${label} ids: ${[...new Set(dupes)].join(", ")}`);
}

async function main() {
  const countries = loadCountries(resolve(SEED, "iso-3166-all.csv"), resolve(SEED, "country-display-names.csv"));
  assertCountries(countries);

  const rows = csv("london-restaurants.csv");
  const coords = await geocodePostcodes(rows.map((r) => ({ name: r.restaurant, postcode: r.postcode })));

  const restaurants = rows.map((r): SeedRestaurant => {
    const c = coords.get(normalisePostcode(r.postcode))!;
    return {
      id: `seed:${slug(r.restaurant, r.postcode)}`,
      countryIso2: r.country_iso2.toUpperCase(),
      name: r.restaurant,
      address: r.address || null,
      postcode: r.postcode || null,
      lat: c.lat,
      lon: c.lon,
      // Solo has no community tier: only the contested ones are marked.
      confidence: r.confidence === "flagged" ? "flagged" : "curated",
      curatorNote: r.curator_note || null,
      googlePlaceId: r.google_place_id || null,
    };
  });
  assertUnique("restaurant", restaurants.map((r) => r.id));

  // Same filter as scripts/seed.ts (status defaults to approved), but drafts never ship.
  const dishes = csv("signature-dishes.csv")
    .filter((r) => (r.status || "approved") === "approved")
    .map((r): SeedDish => {
      const countryIso2 = r.country_iso2.toUpperCase();
      return { id: `seed:dish:${countryIso2}:${slug(r.dish)}`, countryIso2, name: r.dish, note: r.note || null };
    });
  assertUnique("dish", dishes.map((d) => d.id));

  const data: SeedData = {
    generatedAt: new Date().toISOString(),
    countries: countries.map(
      (c): SeedCountry => ({
        iso2: c.iso2,
        iso_numeric: c.iso_numeric,
        name: c.name,
        iso_name: c.iso_name,
        m49_group: c.m49_group,
      }),
    ),
    restaurants,
    dishes,
  };
  writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`);
  console.log(
    `Wrote ${OUT}: ${data.countries.length} countries, ${restaurants.length} restaurants, ${dishes.length} dishes`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
