import { describe, expect, it } from "vitest";
import { buildPins, formatDistance, nearestUnstamped, pinKey, pinSvg, type MapRestaurant } from "@/components/map/pins";
import { DEFAULT_TILE_ATTRIBUTION, DEFAULT_TILE_URL, resolveTileConfig, TILE_CONFIG } from "@/lib/tiles";

describe("tile config", () => {
  it("defaults to OpenStreetMap with a visible attribution", () => {
    const c = resolveTileConfig();
    expect(c.url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(c.url).toBe(DEFAULT_TILE_URL);
    expect(c.attribution).toContain("OpenStreetMap");
    expect(c.attribution).toContain("contributors");
    expect(c.attribution).toBe(DEFAULT_TILE_ATTRIBUTION);
    expect(c.maxZoom).toBe(19);
  });

  it("treats blank env values as unset", () => {
    expect(resolveTileConfig("", "  ")).toEqual(resolveTileConfig());
    expect(resolveTileConfig(null, null)).toEqual(resolveTileConfig());
  });

  it("swaps provider with one URL and one attribution", () => {
    const c = resolveTileConfig(" https://tiles.example/{z}/{x}/{y}.png?key=k ", "&copy; Example");
    expect(c.url).toBe("https://tiles.example/{z}/{x}/{y}.png?key=k");
    expect(c.attribution).toBe("&copy; Example");
  });

  it("a swapped URL without an attribution keeps the OSM credit", () => {
    expect(resolveTileConfig("https://tiles.example/{z}/{x}/{y}.png").attribution).toBe(DEFAULT_TILE_ATTRIBUTION);
  });

  it("the live config is the OSM default when no env override is set", () => {
    // Guard against a stray NEXT_PUBLIC_TILE_URL in the test environment.
    if (!process.env.NEXT_PUBLIC_TILE_URL) expect(TILE_CONFIG.url).toBe(DEFAULT_TILE_URL);
    expect(TILE_CONFIG.url).toContain("{z}/{x}/{y}");
  });
});

const r = (id: string, country_iso2: string, lat: number, lon: number): MapRestaurant => ({
  id,
  name: `Place ${id}`,
  country_iso2,
  address: null,
  postcode: null,
  lat,
  lon,
  status: "active",
  confidence: "curated",
  curator_note: null,
});

describe("pins", () => {
  const rows = [r("a", "LA", 51.51, -0.13), r("b", "FR", 51.52, -0.1), r("c", "ES", 51.4, -0.2)];
  const pins = buildPins(rows, new Set(["FR"]), new Set(["a", "b"]), new Map([["LA", "Laos"]]));

  it("bright for a country I have no visit stamp for, muted for one I do", () => {
    expect(pins.map((p) => p.state)).toEqual(["new", "stamped", "new"]);
  });

  it("rings the restaurants a friend has visited", () => {
    expect(pins.map((p) => p.friendVisited)).toEqual([true, true, false]);
  });

  it("names the country, falling back to the code", () => {
    expect(pins[0].countryName).toBe("Laos");
    expect(pins[1].countryName).toBe("FR");
  });

  it("drops rows without usable coordinates", () => {
    expect(buildPins([r("x", "LA", NaN, 0)], new Set(), new Set(), new Map())).toEqual([]);
  });

  it("the pin cache key and artwork depend on state, ring and selection", () => {
    const keys = new Set([
      pinKey({ state: "new", friendVisited: false }, false),
      pinKey({ state: "stamped", friendVisited: false }, false),
      pinKey({ state: "new", friendVisited: true }, false),
      pinKey({ state: "new", friendVisited: false }, true),
    ]);
    expect(keys.size).toBe(4);
    expect(pinSvg("new", true)).toContain("etw-ring");
    expect(pinSvg("new", false)).not.toContain("etw-ring");
    expect(pinSvg("stamped", false)).toContain("etw-pin-stamped");
  });
});

describe("nearest unstamped", () => {
  const pins = buildPins(
    [r("near-stamped", "FR", 51.5, -0.12), r("mid", "LA", 51.52, -0.12), r("far", "ES", 51.6, -0.3)],
    new Set(["FR"]),
    new Set(),
    new Map(),
  );

  it("skips stamped countries even when they are closest", () => {
    const hit = nearestUnstamped({ lat: 51.5, lon: -0.12 }, pins)!;
    expect(hit.pin.id).toBe("mid");
    expect(hit.distanceM).toBeGreaterThan(2000);
    expect(hit.distanceM).toBeLessThan(2400);
  });

  it("is null when every country is stamped, or there are no pins", () => {
    expect(nearestUnstamped({ lat: 51.5, lon: -0.12 }, pins.filter((p) => p.state === "stamped"))).toBeNull();
    expect(nearestUnstamped({ lat: 0, lon: 0 }, [])).toBeNull();
  });

  it("works from anywhere on Earth", () => {
    expect(nearestUnstamped({ lat: -33.9, lon: 151.2 }, pins)?.pin.id).toBeDefined();
  });
});

describe("formatDistance", () => {
  it("reads naturally at every scale", () => {
    expect(formatDistance(3)).toBe("10 m");
    expect(formatDistance(342)).toBe("340 m");
    expect(formatDistance(1400)).toBe("1.4 km");
    expect(formatDistance(27_400)).toBe("27 km");
    expect(formatDistance(-1)).toBe("");
    expect(formatDistance(NaN)).toBe("");
  });
});
