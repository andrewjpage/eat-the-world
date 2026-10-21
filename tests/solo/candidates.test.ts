import { describe, expect, it } from "vitest";
import { buildCandidates, fold, searchCandidates } from "@solo/domain/candidates";
import type { SeedData, SoloRestaurant, SoloVisit } from "@solo/domain/types";

const seed: SeedData = {
  generatedAt: "2026-10-01T00:00:00Z",
  countries: [
    { iso2: "NG", iso_numeric: "566", name: "Nigeria", iso_name: "Nigeria", m49_group: "Western Africa" },
    { iso2: "ES", iso_numeric: "724", name: "Spain", iso_name: "Spain", m49_group: "Southern Europe" },
    { iso2: "TR", iso_numeric: "792", name: "Türkiye", iso_name: "Türkiye", m49_group: "Western Asia" },
  ],
  restaurants: [
    { id: "seed:akoko", countryIso2: "NG", name: "Akoko", address: "21 Berners St", postcode: "W1T 3LP", lat: 51.5, lon: -0.13, confidence: "flagged", curatorNote: null, googlePlaceId: null },
    { id: "seed:brindisa", countryIso2: "ES", name: "Brindisa", address: "Borough Market", postcode: "SE1 9AF", lat: 51.5, lon: -0.09, confidence: "curated", curatorNote: null, googlePlaceId: null },
    { id: "seed:cafe-anatolia", countryIso2: "TR", name: "Cafe Anatolia", address: null, postcode: "N1 1AA", lat: 51.54, lon: -0.1, confidence: "community", curatorNote: null, googlePlaceId: null },
  ],
  dishes: [],
};

const own = (id: string, over: Partial<SoloRestaurant> = {}): SoloRestaurant => ({
  id,
  seedId: null,
  name: id,
  countryIso2: "NG",
  address: null,
  lat: null,
  lon: null,
  createdAt: "2026-10-01T12:00:00.000Z",
  ...over,
});

const visit = (id: string, restaurantId: string, visitedOn: string): SoloVisit => ({
  id,
  restaurantId,
  visitedOn,
  dishId: null,
  dishOther: null,
  rating: null,
  note: null,
  photoId: null,
  createdAt: `${visitedOn}T19:00:00.000Z`,
});

describe("buildCandidates", () => {
  it("offers every suggestion when I have no restaurants", () => {
    const all = buildCandidates(seed, [], []);
    expect(all.map((c) => c.name)).toEqual(["Akoko", "Brindisa", "Cafe Anatolia"]);
    expect(all[0]).toMatchObject({ ref: { seedId: "seed:akoko" }, countryName: "Nigeria", visits: 0, lastVisitedOn: null });
  });

  it("shows a suggestion I have copied once, as my copy", () => {
    const copy = own("r-akoko", { seedId: "seed:akoko", name: "Akoko" });
    const all = buildCandidates(seed, [copy], []);
    expect(all.filter((c) => c.name === "Akoko")).toHaveLength(1);
    expect(all.find((c) => c.name === "Akoko")?.ref).toEqual({ existingId: "r-akoko" });
  });

  it("puts places I have been first, latest visit first, then my other places, then suggestions", () => {
    const old = own("r-old", { name: "Old Haunt", countryIso2: "ES" });
    const recent = own("r-recent", { name: "Recent Place" });
    const unvisited = own("r-unvisited", { name: "Added Not Eaten" });
    const all = buildCandidates(
      seed,
      [old, recent, unvisited],
      [visit("v1", "r-old", "2026-09-01"), visit("v2", "r-recent", "2026-10-15"), visit("v3", "r-old", "2026-09-20")],
    );

    expect(all.map((c) => c.name)).toEqual([
      "Recent Place",
      "Old Haunt",
      "Added Not Eaten",
      "Akoko",
      "Brindisa",
      "Cafe Anatolia",
    ]);
    expect(all[1]).toMatchObject({ visits: 2, lastVisitedOn: "2026-09-20" });
  });

  it("carries the position of a place that has one and null for one that has none", () => {
    const pinned = own("r1", { lat: 40.4, lon: -3.7 });
    const all = buildCandidates(seed, [pinned, own("r2")], []);
    expect(all.find((c) => c.key === "r1")).toMatchObject({ lat: 40.4, lon: -3.7 });
    expect(all.find((c) => c.key === "r2")).toMatchObject({ lat: null, lon: null });
  });
});

describe("searchCandidates", () => {
  const all = buildCandidates(seed, [own("r-mum", { name: "Mum's Kitchen", address: "Peckham" })], []);

  it("matches the name, the country, the address and the postcode, ignoring case", () => {
    expect(searchCandidates(all, "akoko").map((c) => c.name)).toEqual(["Akoko"]);
    expect(searchCandidates(all, "SPAIN").map((c) => c.name)).toEqual(["Brindisa"]);
    expect(searchCandidates(all, "peckham").map((c) => c.name)).toEqual(["Mum's Kitchen"]);
    expect(searchCandidates(all, "se1 9af").map((c) => c.name)).toEqual(["Brindisa"]);
  });

  it("ignores accents, so 'turkiye' finds Türkiye", () => {
    expect(searchCandidates(all, "turkiye").map((c) => c.name)).toEqual(["Cafe Anatolia"]);
    expect(searchCandidates(all, "TÜRKIYE").map((c) => c.name)).toEqual(["Cafe Anatolia"]);
  });

  it("needs every word to match", () => {
    expect(searchCandidates(all, "cafe nigeria")).toEqual([]);
    expect(searchCandidates(all, "cafe anatolia").map((c) => c.name)).toEqual(["Cafe Anatolia"]);
  });

  it("limits results to one country when asked, with or without a query", () => {
    expect(searchCandidates(all, "", { countryIso2: "NG" }).map((c) => c.name)).toEqual(["Mum's Kitchen", "Akoko"]);
    expect(searchCandidates(all, "kitchen", { countryIso2: "ES" })).toEqual([]);
  });

  it("caps the list", () => {
    expect(searchCandidates(all, "", { limit: 2 })).toHaveLength(2);
  });
});

describe("fold", () => {
  it("lower-cases and strips accents", () => {
    expect(fold("Türkiye")).toBe("turkiye");
    expect(fold("Bếp House")).toBe("bep house");
  });
});
