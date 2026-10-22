import { describe, expect, it } from "vitest";
import { dishLabel, resolvePlace, visitsAt, visitsIn } from "@solo/domain/lookup";
import type { SeedData, SeedDish, SeedRestaurant, SoloRestaurant, SoloVisit } from "@solo/domain/types";

const suggestion: SeedRestaurant = {
  id: "seed:akoko",
  countryIso2: "NG",
  name: "Akoko",
  address: "21 Berners St, London",
  postcode: "W1T 3LP",
  lat: 51.52,
  lon: -0.13,
  confidence: "flagged",
  curatorNote: "Pan-regional.",
  googlePlaceId: "place-akoko",
};
const seed: SeedData = { generatedAt: "2026-10-01T00:00:00Z", countries: [], restaurants: [suggestion], dishes: [] };

const copy: SoloRestaurant = {
  id: "r-akoko",
  seedId: "seed:akoko",
  name: "Akoko (my copy)",
  countryIso2: "NG",
  address: "21 Berners St",
  lat: 51.52,
  lon: -0.13,
  createdAt: "2026-10-01T12:00:00.000Z",
};
const handAdded: SoloRestaurant = { ...copy, id: "r-mums", seedId: null, name: "Mum's Kitchen", address: null };

function visit(id: string, restaurantId: string, visitedOn: string, createdAt = `${visitedOn}T19:00:00.000Z`): SoloVisit {
  return { id, restaurantId, visitedOn, dishId: null, dishOther: null, rating: null, note: null, photoId: null, createdAt };
}

describe("resolvePlace", () => {
  it("opens a suggestion that has never been visited, with the seed's metadata", () => {
    const place = resolvePlace("seed:akoko", seed, []);
    expect(place).toMatchObject({
      name: "Akoko",
      postcode: "W1T 3LP",
      countryIso2: "NG",
      confidence: "flagged",
      curatorNote: "Pan-regional.",
      googlePlaceId: "place-akoko",
      own: null,
    });
    expect(place?.suggestion).toBe(suggestion);
  });

  it("resolves a suggestion I have copied to my copy, whichever id was opened", () => {
    for (const id of ["seed:akoko", "r-akoko"]) {
      const place = resolvePlace(id, seed, [copy]);
      expect(place?.own).toBe(copy);
      expect(place?.name).toBe("Akoko (my copy)");
      expect(place).toMatchObject({ confidence: "flagged", curatorNote: "Pan-regional.", googlePlaceId: "place-akoko" });
    }
  });

  it("treats a place added by hand as community, with no note and no place id", () => {
    expect(resolvePlace("r-mums", seed, [handAdded])).toMatchObject({
      name: "Mum's Kitchen",
      confidence: "community",
      curatorNote: null,
      googlePlaceId: null,
      postcode: null,
      suggestion: null,
    });
  });

  it("copes with a copy whose suggestion is no longer in the seed", () => {
    const orphan = { ...copy, seedId: "seed:gone" };
    expect(resolvePlace("r-akoko", seed, [orphan])).toMatchObject({ confidence: "community", suggestion: null });
  });

  it("is null for an id that matches nothing", () => {
    expect(resolvePlace("nope", seed, [copy])).toBeNull();
  });
});

describe("visitsAt", () => {
  it("lists only that restaurant's visits, newest first, latest-logged first on the same day", () => {
    const visits = [
      visit("old", "r-akoko", "2026-09-01"),
      visit("other", "r-mums", "2026-10-09"),
      visit("same-early", "r-akoko", "2026-10-03", "2026-10-03T12:00:00.000Z"),
      visit("same-late", "r-akoko", "2026-10-03", "2026-10-03T21:00:00.000Z"),
    ];
    expect(visitsAt("r-akoko", visits).map((v) => v.id)).toEqual(["same-late", "same-early", "old"]);
  });
});

describe("visitsIn", () => {
  it("lists my visits in a country with their restaurants, newest first, leaving out other countries and lost restaurants", () => {
    const abroad: SoloRestaurant = { ...copy, id: "r-fr", seedId: null, countryIso2: "FR" };
    const visits = [
      visit("v-akoko", "r-akoko", "2026-10-03"),
      visit("v-mums", "r-mums", "2026-10-09"),
      visit("v-fr", "r-fr", "2026-10-12"),
      visit("v-gone", "r-deleted", "2026-10-15"),
    ];
    const found = visitsIn("NG", [copy, handAdded, abroad], visits);
    expect(found.map((f) => [f.visit.id, f.restaurant.id])).toEqual([
      ["v-mums", "r-mums"],
      ["v-akoko", "r-akoko"],
    ]);
  });
});

describe("dishLabel", () => {
  const dishes: SeedDish[] = [{ id: "seed:dish:NG:suya", countryIso2: "NG", name: "Suya", note: null }];

  it("names the approved dish, else what I typed, else nothing", () => {
    expect(dishLabel({ ...visit("v", "r", "2026-10-01"), dishId: "seed:dish:NG:suya" }, dishes)).toBe("Suya");
    expect(dishLabel({ ...visit("v", "r", "2026-10-01"), dishOther: "Pepper soup" }, dishes)).toBe("Pepper soup");
    expect(dishLabel(visit("v", "r", "2026-10-01"), dishes)).toBeNull();
  });

  it("prefers the approved dish when both are set", () => {
    const both = { ...visit("v", "r", "2026-10-01"), dishId: "seed:dish:NG:suya", dishOther: "Beef skewers" };
    expect(dishLabel(both, dishes)).toBe("Suya");
  });
});
