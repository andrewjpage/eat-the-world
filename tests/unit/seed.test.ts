import { describe, expect, it, vi } from "vitest";
import { geocodePostcodes } from "../../scripts/lib/geocode";
import { assertCountries, loadCountries } from "../../scripts/lib/countries-data";

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("geocodePostcodes", () => {
  it("falls back to terminated postcodes with a warning naming the restaurant", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? "GET"} ${u}`);
      if (u.endsWith("/postcodes")) {
        return jsonRes({
          status: 200,
          result: [
            { query: "W1T 3LD", result: { postcode: "W1T 3LD", latitude: 51.52, longitude: -0.14 } },
            { query: "EC1V 1LP", result: null },
          ],
        });
      }
      if (u.includes("/terminated_postcodes/EC1V%201LP")) {
        return jsonRes({ status: 200, result: { postcode: "EC1V 1LP", latitude: 51.53, longitude: -0.1 } });
      }
      return jsonRes({ status: 404 }, 404);
    }) as unknown as typeof fetch;
    const warn = vi.fn();
    const m = await geocodePostcodes(
      [
        { name: "Enish", postcode: "w1t 3ld" },
        { name: "Old Place", postcode: "EC1V 1LP" },
      ],
      { fetchFn, warn },
    );
    expect(m.get("W1T 3LD")).toEqual({ lat: 51.52, lon: -0.14 });
    expect(m.get("EC1V 1LP")).toEqual({ lat: 51.53, lon: -0.1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("Old Place");
    expect(warn.mock.calls[0][0]).toContain("EC1V 1LP");
    expect(calls[0]).toMatch(/^POST .*\/postcodes$/);
  });

  it("throws when neither live nor terminated", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/postcodes")) return jsonRes({ result: [{ query: "ZZ1 1ZZ", result: null }] });
      return jsonRes({ status: 404 }, 404);
    }) as unknown as typeof fetch;
    await expect(
      geocodePostcodes([{ name: "Ghost Kitchen", postcode: "ZZ1 1ZZ" }], { fetchFn, warn: () => {} }),
    ).rejects.toThrow(/Ghost Kitchen/);
  });

  it("batches 100 per request", async () => {
    const posts: number[] = [];
    const fetchFn = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const pcs = JSON.parse(String(init?.body)).postcodes as string[];
      posts.push(pcs.length);
      return jsonRes({ result: pcs.map((q) => ({ query: q, result: { latitude: 1, longitude: 2 } })) });
    }) as unknown as typeof fetch;
    const items = Array.from({ length: 250 }, (_, i) => ({ name: `R${i}`, postcode: `AB${i} 1CD` }));
    await geocodePostcodes(items, { fetchFn });
    expect(posts).toEqual([100, 100, 50]);
  });
});

describe("loadCountries", () => {
  const rows = loadCountries("seed/iso-3166-all.csv", "seed/country-display-names.csv");
  it("has 249 rows, all with a region", () => {
    expect(() => assertCountries(rows)).not.toThrow();
    expect(rows).toHaveLength(249);
  });
  it("zero-pads numeric codes and applies overrides", () => {
    expect(rows.find((r) => r.iso2 === "AF")!.iso_numeric).toBe("004");
    const tw = rows.find((r) => r.iso2 === "TW")!;
    expect([tw.m49_region, tw.m49_group]).toEqual(["Asia", "Eastern Asia"]);
    const aq = rows.find((r) => r.iso2 === "AQ")!;
    expect(aq.m49_region).toBe("Antarctica");
  });
  it("Africa splits by intermediate region", () => {
    expect(rows.find((r) => r.iso2 === "NG")!.m49_group).toBe("Western Africa");
  });
});
