/**
 * UK postcode helpers and the postcodes.io geocoder (brief sections 8 and 9).
 *
 * Coordinates come only from postcodes.io: free, no key. A live postcode is tried first, then
 * a terminated one (still has coordinates), so a restaurant on a retired postcode still lands.
 * Only a restaurant's postcode is sent out, never a user's position. Server-side use only.
 */

const API = "https://api.postcodes.io";
const TIMEOUT_MS = 6000;

/** Outward code (A9, A99, A9A, AA9, AA99, AA9A) + inward code (9AA). */
const POSTCODE_RE = /^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$/;

/**
 * "sw1a1aa", " SW1A  1aa " -> "SW1A 1AA". Returns null if it can't be a UK postcode.
 * The inward code is always the last three characters, so the space goes before them.
 */
export function normalisePostcode(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const compact = input.toUpperCase().replace(/[\s .-]+/g, "");
  const m = POSTCODE_RE.exec(compact);
  return m ? `${m[1]} ${m[2]}` : null;
}

export interface Geocoded {
  /** Canonical postcode as postcodes.io spells it. */
  postcode: string;
  lat: number;
  lon: number;
  /** True when only the terminated-postcodes endpoint knew it. */
  terminated: boolean;
}

/** postcodes.io could not be reached or answered with a server error. Try again later. */
export class GeocodeUnavailableError extends Error {
  constructor() {
    super("The postcode service is not answering right now.");
    this.name = "GeocodeUnavailableError";
  }
}

type FetchFn = typeof fetch;

function pickCoords(result: unknown): { postcode: string; lat: number; lon: number } | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const lat = r.latitude;
  const lon = r.longitude;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { postcode: typeof r.postcode === "string" ? r.postcode : "", lat, lon };
}

/** One lookup. null = the service says it doesn't know it (or knows it without coordinates). */
async function lookup(path: string, postcode: string, fetchFn: FetchFn) {
  let res: Response;
  try {
    res = await fetchFn(`${API}/${path}/${encodeURIComponent(postcode)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new GeocodeUnavailableError();
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new GeocodeUnavailableError();
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new GeocodeUnavailableError();
  }
  return pickCoords((body as { result?: unknown } | null)?.result);
}

/**
 * Geocodes a UK postcode: GET /postcodes/{pc}, then GET /terminated_postcodes/{pc}.
 * Returns null when neither resolves (caller shows a friendly error); throws
 * GeocodeUnavailableError when the service itself is down. `fetchFn` is for tests.
 */
export async function geocodePostcode(
  input: string,
  fetchFn: FetchFn = fetch,
): Promise<Geocoded | null> {
  const postcode = normalisePostcode(input);
  if (!postcode) return null;

  const live = await lookup("postcodes", postcode, fetchFn);
  if (live) return { postcode: live.postcode || postcode, lat: live.lat, lon: live.lon, terminated: false };

  const old = await lookup("terminated_postcodes", postcode, fetchFn);
  if (old) return { postcode: old.postcode || postcode, lat: old.lat, lon: old.lon, terminated: true };

  return null;
}

export const POSTCODE_NOT_FOUND =
  "We couldn't find that postcode. Check it for typos, or use the restaurant's nearest postcode.";
export const POSTCODE_SERVICE_DOWN =
  "The postcode lookup is having a moment. Please try again in a minute.";
