export interface Coord {
  lat: number;
  lon: number;
}

export interface GeocodeInput {
  name: string;
  postcode: string;
}

type FetchFn = typeof fetch;

const BASE = "https://api.postcodes.io";
const BATCH = 100;

export const normalisePostcode = (p: string) => p.replace(/\s+/g, " ").trim().toUpperCase();

/**
 * Geocode UK postcodes. Bulk POST /postcodes (100 per request); a postcode that
 * does not resolve falls back to GET /terminated_postcodes/{postcode} with a
 * warning naming the restaurant. If neither resolves, throws.
 * Returns a map keyed by normalised postcode.
 */
export async function geocodePostcodes(
  items: GeocodeInput[],
  opts: { fetchFn?: FetchFn; warn?: (msg: string) => void } = {},
): Promise<Map<string, Coord>> {
  const f = opts.fetchFn ?? fetch;
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const out = new Map<string, Coord>();

  const unique = [...new Set(items.map((i) => normalisePostcode(i.postcode)))];
  for (let i = 0; i < unique.length; i += BATCH) {
    const chunk = unique.slice(i, i + BATCH);
    const res = await f(`${BASE}/postcodes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postcodes: chunk }),
    });
    if (!res.ok) throw new Error(`postcodes.io bulk lookup failed: HTTP ${res.status}`);
    const body = (await res.json()) as {
      result: Array<{
        query: string;
        result: { postcode?: string; latitude: number | null; longitude: number | null } | null;
      }>;
    };
    for (const r of body.result) {
      const lat = r.result?.latitude;
      const lon = r.result?.longitude;
      if (typeof lat === "number" && typeof lon === "number") {
        out.set(normalisePostcode(r.query), { lat, lon });
      }
    }
  }

  for (const pc of unique) {
    if (out.has(pc)) continue;
    const who = items.filter((i) => normalisePostcode(i.postcode) === pc).map((i) => i.name);
    const res = await f(`${BASE}/terminated_postcodes/${encodeURIComponent(pc)}`);
    if (res.ok) {
      const body = (await res.json()) as {
        result?: { latitude: number | null; longitude: number | null };
      };
      const lat = body.result?.latitude;
      const lon = body.result?.longitude;
      if (typeof lat === "number" && typeof lon === "number") {
        warn(`WARNING: postcode ${pc} is terminated; using its last coordinates for ${who.join(", ")}`);
        out.set(pc, { lat, lon });
        continue;
      }
    }
    throw new Error(`Postcode ${pc} (${who.join(", ")}) resolves neither live nor terminated`);
  }
  return out;
}
