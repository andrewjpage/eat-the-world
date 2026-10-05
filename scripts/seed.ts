/**
 * Insert-only, idempotent seed (brief section 9). Never updates existing rows.
 * Usage: npm run seed   (needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import { assertCountries, loadCountries } from "./lib/countries-data";
import { geocodePostcodes, normalisePostcode } from "./lib/geocode";
import { serverRealtimeOptions } from "../src/lib/supabase/node-realtime";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const SEED = resolve(process.cwd(), "seed");
const csv = (name: string): Record<string, string>[] =>
  parse(readFileSync(resolve(SEED, name), "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  });

const summary: Array<[string, number, number]> = [];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: serverRealtimeOptions(),
  });

  /** Insert rows, never updating existing ones; records inserted vs already present. */
  async function insertOnly(
    label: string,
    table: string,
    rows: object[],
    onConflict: string,
  ): Promise<void> {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await db
        .from(table)
        .upsert(rows.slice(i, i + 500), { onConflict, ignoreDuplicates: true })
        .select();
      if (error) throw new Error(`${table}: ${error.message}`);
      inserted += data?.length ?? 0;
    }
    summary.push([label, inserted, rows.length - inserted]);
  }

  // 1. Countries
  const countries = loadCountries(resolve(SEED, "iso-3166-all.csv"), resolve(SEED, "country-display-names.csv"));
  assertCountries(countries);
  await insertOnly("countries", "countries", countries, "iso2");

  // 2. London
  await insertOnly("cities", "cities", [{ name: "London", slug: "london" }], "slug");
  const { data: city, error: cityErr } = await db.from("cities").select("id").eq("slug", "london").single();
  if (cityErr || !city) throw new Error(`London city not found: ${cityErr?.message}`);

  // 3. Restaurants
  const rest = csv("london-restaurants.csv");
  const coords = await geocodePostcodes(rest.map((r) => ({ name: r.restaurant, postcode: r.postcode })));
  const restaurantRows = rest.map((r) => {
    const c = coords.get(normalisePostcode(r.postcode))!;
    return {
      city_id: city.id,
      country_iso2: r.country_iso2.toUpperCase(),
      name: r.restaurant,
      address: r.address,
      postcode: r.postcode,
      lat: c.lat,
      lon: c.lon,
      google_place_id: r.google_place_id || null,
      status: "active",
      confidence: r.confidence || "curated",
      curator_note: r.curator_note || null,
    };
  });
  await insertOnly("restaurants", "restaurants", restaurantRows, "name,postcode");

  // 4. City statuses: every country starts unlisted
  await insertOnly(
    "city_countries",
    "city_countries",
    countries.map((c) => ({ city_id: city.id, country_iso2: c.iso2, status: "unlisted" })),
    "city_id,country_iso2",
  );

  // 5. Sets
  const sets = csv("sets.csv").map((r) => ({
    slug: r.slug,
    name: r.name,
    country_iso2s: r.country_iso2s.split(/\s+/).filter(Boolean),
  }));
  await insertOnly("sets", "sets", sets, "slug");

  // 6. Signature dishes
  const dishes = csv("signature-dishes.csv").map((r) => ({
    country_iso2: r.country_iso2.toUpperCase(),
    name: r.dish,
    note: r.note || null,
    status: r.status || "approved",
  }));
  await insertOnly("signature_dishes", "signature_dishes", dishes, "country_iso2,name");

  console.log("\nSeed summary (inserted / already present):");
  for (const [label, ins, present] of summary) {
    console.log(`  ${label.padEnd(18)} ${String(ins).padStart(4)} / ${present}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
