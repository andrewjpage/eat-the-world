import { describe, expect, it, vi } from "vitest";
import {
  GeocodeUnavailableError,
  geocodePostcode,
  normalisePostcode,
} from "@/lib/postcodes";
import {
  cleanIsoList,
  cleanPlaceId,
  cleanWebsite,
  parseSuggestion,
  slugify,
  statusImpact,
} from "@/components/curator/logic";

describe("normalisePostcode", () => {
  it.each([
    ["sw1a1aa", "SW1A 1AA"],
    ["  SW1A   1aa ", "SW1A 1AA"],
    ["n19ab", "N1 9AB"],
    ["N1 9AB", "N1 9AB"],
    ["e14 5ab", "E14 5AB"],
    ["w1d 3QU", "W1D 3QU"],
    ["ec1a-1bb", "EC1A 1BB"],
    ["B33 8TH", "B33 8TH"],
    ["m1 1ae", "M1 1AE"],
  ])("%s -> %s", (input, expected) => {
    expect(normalisePostcode(input)).toBe(expected);
  });

  it.each(["", "   ", "hello", "12345", "SW1A", "SW1A 1A", "SW1A 1AAA", "1AA 1AA", "N1 9A1"])(
    "rejects %j",
    (input) => {
      expect(normalisePostcode(input)).toBeNull();
    },
  );

  it("rejects non-strings", () => {
    expect(normalisePostcode(null)).toBeNull();
    expect(normalisePostcode(undefined)).toBeNull();
  });
});

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OK = { status: 200, result: { postcode: "N1 9AB", latitude: 51.5, longitude: -0.12 } };
const OLD = { status: 200, result: { postcode: "N1 9AB", latitude: 51.4, longitude: -0.2 } };

describe("geocodePostcode", () => {
  it("returns the live postcode and calls the normalised URL", async () => {
    const f = vi.fn().mockResolvedValue(reply(200, OK));
    const g = await geocodePostcode("n19ab", f as unknown as typeof fetch);
    expect(g).toEqual({ postcode: "N1 9AB", lat: 51.5, lon: -0.12, terminated: false });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe("https://api.postcodes.io/postcodes/N1%209AB");
  });

  it("falls back to terminated postcodes on a 404", async () => {
    const f = vi.fn().mockResolvedValueOnce(reply(404, { status: 404 })).mockResolvedValueOnce(reply(200, OLD));
    const g = await geocodePostcode("N1 9AB", f as unknown as typeof fetch);
    expect(g).toEqual({ postcode: "N1 9AB", lat: 51.4, lon: -0.2, terminated: true });
    expect(f.mock.calls[1][0]).toBe("https://api.postcodes.io/terminated_postcodes/N1%209AB");
  });

  it("returns null when neither endpoint knows the postcode", async () => {
    const f = vi.fn().mockResolvedValue(reply(404, { status: 404 }));
    expect(await geocodePostcode("N1 9AB", f as unknown as typeof fetch)).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("treats a terminated postcode without coordinates as unresolved", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply(404))
      .mockResolvedValueOnce(reply(200, { status: 200, result: { postcode: "N1 9AB", latitude: null, longitude: null } }));
    expect(await geocodePostcode("N1 9AB", f as unknown as typeof fetch)).toBeNull();
  });

  it("does not call the network for an invalid postcode", async () => {
    const f = vi.fn();
    expect(await geocodePostcode("nonsense", f as unknown as typeof fetch)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("throws GeocodeUnavailableError on a 5xx, never a silent null", async () => {
    const f = vi.fn().mockResolvedValue(reply(503));
    await expect(geocodePostcode("N1 9AB", f as unknown as typeof fetch)).rejects.toBeInstanceOf(
      GeocodeUnavailableError,
    );
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("throws GeocodeUnavailableError when fetch itself fails", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("network down"));
    await expect(geocodePostcode("N1 9AB", f as unknown as typeof fetch)).rejects.toBeInstanceOf(
      GeocodeUnavailableError,
    );
  });

  it("rejects out-of-range coordinates", async () => {
    const bad = { status: 200, result: { postcode: "N1 9AB", latitude: 951.5, longitude: -0.12 } };
    const f = vi.fn().mockResolvedValueOnce(reply(200, bad)).mockResolvedValueOnce(reply(404));
    expect(await geocodePostcode("N1 9AB", f as unknown as typeof fetch)).toBeNull();
  });
});

describe("parseSuggestion", () => {
  const base = { countryIso2: "jp", name: "  Koya  ", postcode: "w1d 3qu" };

  it("accepts the minimum and normalises the country", () => {
    const r = parseSuggestion(base);
    expect(r).toEqual({
      ok: true,
      value: {
        countryIso2: "JP",
        name: "Koya",
        address: null,
        postcode: "w1d 3qu",
        googlePlaceId: null,
        website: null,
        note: null,
      },
    });
  });

  it("keeps the optional fields", () => {
    const r = parseSuggestion({
      ...base,
      address: "49 Frith St",
      website: "koya.co.uk",
      googlePlaceId: "ChIJabcdefghijk123",
      note: "Udon",
    });
    expect(r.ok && r.value.website).toBe("https://koya.co.uk/");
    expect(r.ok && r.value.googlePlaceId).toBe("ChIJabcdefghijk123");
    expect(r.ok && r.value.address).toBe("49 Frith St");
  });

  it.each([
    [{ ...base, countryIso2: "" }, /country/i],
    [{ ...base, countryIso2: "JPN" }, /country/i],
    [{ ...base, name: "   " }, /name/i],
    [{ ...base, name: "x".repeat(201) }, /name/i],
    [{ ...base, postcode: "" }, /postcode/i],
    [{ ...base, website: "javascript:alert(1)" }, /website/i],
    [{ ...base, googlePlaceId: "no spaces allowed here" }, /place ID/i],
    [{ ...base, note: "n".repeat(1001) }, /note/i],
    [null, /try again/i],
    [[], /try again/i],
    ["string", /try again/i],
  ])("rejects %j", (body, message) => {
    const r = parseSuggestion(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });
});

describe("field cleaners", () => {
  it("cleanWebsite allows only http(s)", () => {
    expect(cleanWebsite("https://example.com/menu")).toBe("https://example.com/menu");
    expect(cleanWebsite("example.com")).toBe("https://example.com/");
    expect(cleanWebsite("ftp://example.com")).toBeNull();
    expect(cleanWebsite("data:text/html,hi")).toBeNull();
    expect(cleanWebsite("localhost")).toBeNull();
  });

  it("cleanPlaceId stores the id only", () => {
    expect(cleanPlaceId("ChIJN1t_tDeuEmsRUsoyG83frY4")).toBe("ChIJN1t_tDeuEmsRUsoyG83frY4");
    expect(cleanPlaceId("https://maps.google.com/?cid=1")).toBeNull();
    expect(cleanPlaceId("short")).toBeNull();
  });
});

describe("slugify", () => {
  it("makes a valid sets.slug", () => {
    expect(slugify("Arabian Peninsula & Levant")).toBe("arabian-peninsula-and-levant");
    expect(slugify("  The Stans!  ")).toBe("the-stans");
    expect(slugify("Côte d'Or")).toBe("cote-d-or");
    expect(slugify("???")).toBe("");
    expect(slugify("a".repeat(100))).toMatch(/^a{60}$/);
    for (const n of ["Horn of Africa", "Indian Ocean Islands"]) expect(slugify(n)).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("cleanIsoList", () => {
  it("upper-cases, dedupes, sorts and drops junk", () => {
    expect(cleanIsoList(["la", "KH", "la", " vn ", "xyz", "", 5, null])).toEqual(["KH", "LA", "VN"]);
    expect(cleanIsoList("LA")).toEqual([]);
  });
});

describe("statusImpact", () => {
  it("warns when closing the last eligible restaurant", () => {
    expect(statusImpact({ countryName: "Laos", from: "active", to: "closed", eligibleCount: 1 })).toMatch(/unlisted/);
    expect(statusImpact({ countryName: "Laos", from: "active", to: "closed", eligibleCount: 2 })).toBeNull();
  });
  it("says a country becomes listed", () => {
    expect(statusImpact({ countryName: "Japan", from: "pending", to: "active", eligibleCount: 0 })).toMatch(/listed/);
    expect(statusImpact({ countryName: "Laos", from: "active", to: "reported_closed", eligibleCount: 1 })).toBeNull();
  });
});
