import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { MAX_DISH_OTHER, MAX_NOTE } from "@/components/checkin/logic";
import { openSoloStore, type SoloStore } from "@solo/db/store";
import { deriveStamps } from "@solo/domain/stamps";
import type { NewVisitInput } from "@solo/services/visits";
import {
  logVisit,
  outcomeCopy,
  removeVisit,
  updateRestaurant,
  updateVisit,
  VisitError,
} from "@solo/services/visits";
import type { SeedData } from "@solo/domain/types";

const seed: SeedData = {
  generatedAt: "2026-10-01T00:00:00Z",
  countries: [
    { iso2: "ES", iso_numeric: "724", name: "Spain", iso_name: "Spain", m49_group: "Southern Europe" },
    { iso2: "FR", iso_numeric: "250", name: "France", iso_name: "France", m49_group: "Western Europe" },
    { iso2: "NG", iso_numeric: "566", name: "Nigeria", iso_name: "Nigeria", m49_group: "Western Africa" },
  ],
  restaurants: [
    {
      id: "seed:akoko",
      countryIso2: "NG",
      name: "Akoko",
      address: "21 Berners St, London",
      postcode: "W1T 3LP",
      lat: 51.517912,
      lon: -0.136752,
      confidence: "flagged",
      curatorNote: "Pan-regional.",
      googlePlaceId: null,
    },
  ],
  dishes: [{ id: "seed:dish:NG:suya", countryIso2: "NG", name: "Suya", note: null }],
};

/** Midday on 21 Oct 2026 in the machine's own time zone, which is what "today" means. */
const NOW = new Date(2026, 9, 21, 12, 0, 0);

const AKOKO = { seedId: "seed:akoko" } as const;
const SOHO_CAFE = { name: "Soho Cafe", countryIso2: "FR", address: "28 Greek St", coords: { lat: 51.51, lon: -0.13 } };

function input(over: Partial<NewVisitInput> = {}): NewVisitInput {
  return {
    restaurant: AKOKO,
    visitedOn: "2026-10-20",
    dishId: null,
    dishOther: null,
    rating: null,
    note: null,
    photo: null,
    ...over,
  };
}

const jpeg = (text: string) => new Blob([text], { type: "image/jpeg" });

async function freshStore(): Promise<SoloStore> {
  return openSoloStore(new IDBFactory());
}

/** Logs through the service the way the screen does: reading the store first. */
async function log(store: SoloStore, over: Partial<NewVisitInput> = {}, now = NOW) {
  return logVisit(store, await store.load(), seed, input(over), now);
}

async function stampsOf(store: SoloStore) {
  const { restaurants, visits, backfills } = await store.load();
  return deriveStamps(restaurants, visits, backfills);
}

async function expectNothingWritten(store: SoloStore) {
  const data = await store.load();
  expect(data.restaurants).toEqual([]);
  expect(data.visits).toEqual([]);
  expect((await store.allPhotos()).size).toBe(0);
}

describe("logVisit: restaurants", () => {
  it("copies a London suggestion into my restaurants once, then reuses the copy", async () => {
    const store = await freshStore();

    const first = await log(store);
    expect(first.restaurant).toMatchObject({
      seedId: "seed:akoko",
      name: "Akoko",
      countryIso2: "NG",
      address: "21 Berners St, London",
      lat: 51.517912,
      lon: -0.136752,
    });
    expect((await store.load()).restaurants).toHaveLength(1);

    const second = await log(store, { visitedOn: "2026-10-21" });
    expect(second.restaurant.id).toBe(first.restaurant.id);
    const data = await store.load();
    expect(data.restaurants).toHaveLength(1);
    expect(data.visits.map((v) => v.restaurantId)).toEqual([first.restaurant.id, first.restaurant.id]);
  });

  it("reuses my copy when the visit names it by its own id", async () => {
    const store = await freshStore();
    const first = await log(store);

    const again = await log(store, { restaurant: { existingId: first.restaurant.id } });

    expect(again.restaurant.id).toBe(first.restaurant.id);
    expect((await store.load()).restaurants).toHaveLength(1);
  });

  it("adds a brand-new place with the country, address and pin I gave it", async () => {
    const store = await freshStore();

    const result = await log(store, { restaurant: SOHO_CAFE });

    expect(result.restaurant).toMatchObject({
      seedId: null,
      name: "Soho Cafe",
      countryIso2: "FR",
      address: "28 Greek St",
      lat: 51.51,
      lon: -0.13,
    });
    expect((await store.load()).restaurants).toEqual([result.restaurant]);
  });

  it("keeps a new place off the map when there is no pin", async () => {
    const store = await freshStore();

    const { restaurant } = await log(store, { restaurant: { name: "  Mum's Kitchen ", countryIso2: "NG" } });

    expect(restaurant).toMatchObject({ name: "Mum's Kitchen", address: null, lat: null, lon: null });
  });

  it("refuses an unknown suggestion or restaurant id and writes nothing", async () => {
    const store = await freshStore();
    await expect(log(store, { restaurant: { seedId: "seed:nope" } })).rejects.toBeInstanceOf(VisitError);
    await expect(log(store, { restaurant: { existingId: "nope" } })).rejects.toBeInstanceOf(VisitError);
    await expectNothingWritten(store);
  });
});

describe("logVisit: outcomes", () => {
  it("is stamped for a country's first visit, then repeat", async () => {
    const store = await freshStore();

    expect((await log(store)).outcome).toBe("stamped");
    expect((await log(store, { visitedOn: "2026-10-21" })).outcome).toBe("repeat");
    expect(await stampsOf(store)).toEqual([
      expect.objectContaining({ countryIso2: "NG", kind: "visit", earnedOn: "2026-10-20" }),
    ]);
  });

  it("upgrades a before-the-app memory into a full stamp", async () => {
    const store = await freshStore();
    await store.putBackfills([{ countryIso2: "NG", createdAt: "2026-09-01T09:00:00.000Z" }]);

    const result = await log(store);

    expect(result.outcome).toBe("upgraded");
    expect(await stampsOf(store)).toEqual([expect.objectContaining({ countryIso2: "NG", kind: "visit" })]);
  });

  it("a backdated visit moves the stamp date earlier", async () => {
    const store = await freshStore();
    await log(store, { visitedOn: "2026-10-20" });

    await log(store, { visitedOn: "2026-09-15" });

    expect((await stampsOf(store))[0].earnedOn).toBe("2026-09-15");
  });
});

describe("logVisit: what it saves", () => {
  it("saves the date, dish, rating, note and photo", async () => {
    const store = await freshStore();

    const { visit, photoSaved } = await log(store, {
      dishId: "seed:dish:NG:suya",
      rating: 5,
      note: "  Smoky.  ",
      photo: jpeg("plate"),
    });

    expect(photoSaved).toBe(true);
    expect(visit).toMatchObject({
      visitedOn: "2026-10-20",
      dishId: "seed:dish:NG:suya",
      dishOther: null,
      rating: 5,
      note: "Smoky.",
      createdAt: NOW.toISOString(),
    });
    expect(visit.photoId).toEqual(expect.any(String));
    expect(await (await store.getPhoto(visit.photoId!))?.text()).toBe("plate");
    expect((await store.load()).visits).toEqual([visit]);
  });

  it("lets an approved dish win over typed text, and keeps typed text otherwise", async () => {
    const store = await freshStore();

    const approved = await log(store, { dishId: "seed:dish:NG:suya", dishOther: "Something" });
    const typed = await log(store, { dishOther: "  Pepper soup " });

    expect(approved.visit).toMatchObject({ dishId: "seed:dish:NG:suya", dishOther: null });
    expect(typed.visit).toMatchObject({ dishId: null, dishOther: "Pepper soup" });
  });

  it("writes the restaurant, then the photo, then the visit last", async () => {
    const store = await freshStore();
    const calls: string[] = [];
    const spy: SoloStore = {
      ...store,
      putRestaurant: (r) => (calls.push("putRestaurant"), store.putRestaurant(r)),
      putPhoto: (id, b) => (calls.push("putPhoto"), store.putPhoto(id, b)),
      putVisit: (v) => (calls.push("putVisit"), store.putVisit(v)),
    };

    await logVisit(spy, await store.load(), seed, input({ photo: jpeg("x") }), NOW);

    expect(calls).toEqual(["putRestaurant", "putPhoto", "putVisit"]);
  });

  it("still saves the visit when the photo cannot be stored, and says so", async () => {
    const store = await freshStore();
    const failing: SoloStore = { ...store, putPhoto: () => Promise.reject(new Error("QuotaExceededError")) };

    const result = await logVisit(failing, await store.load(), seed, input({ photo: jpeg("big"), rating: 4 }), NOW);

    expect(result.photoSaved).toBe(false);
    expect(result.visit.photoId).toBeNull();
    const data = await store.load();
    expect(data.visits).toEqual([result.visit]);
    expect(data.visits[0].rating).toBe(4);
    expect((await store.allPhotos()).size).toBe(0);
  });

  it("does not leave the photo behind when the visit itself cannot be stored", async () => {
    const store = await freshStore();
    const failing: SoloStore = { ...store, putVisit: () => Promise.reject(new Error("disk full")) };

    await expect(logVisit(failing, await store.load(), seed, input({ photo: jpeg("x") }), NOW)).rejects.toThrow(
      "disk full",
    );

    expect((await store.allPhotos()).size).toBe(0);
    expect((await store.load()).visits).toEqual([]);
  });
});

describe("logVisit: validation", () => {
  const cases: [string, Partial<NewVisitInput>][] = [
    ["a future date", { visitedOn: "2026-10-22" }],
    ["a malformed date", { visitedOn: "2026-1-5" }],
    ["a date that is not on the calendar", { visitedOn: "2026-02-30" }],
    ["a date long before any diary", { visitedOn: "0202-10-10" }],
    ["a rating of 9", { rating: 9 as unknown as 5 }],
    ["a rating of 0", { rating: 0 as unknown as 1 }],
    ["a fractional rating", { rating: 2.5 as unknown as 2 }],
    ["a note over the limit", { note: "x".repeat(MAX_NOTE + 1) }],
    ["typed dish text over the limit", { dishOther: "x".repeat(MAX_DISH_OTHER + 1) }],
    ["an empty restaurant name", { restaurant: { name: "   ", countryIso2: "FR" } }],
    ["an unknown country", { restaurant: { name: "Cafe", countryIso2: "ZZ" } }],
  ];

  it.each(cases)("refuses %s and writes nothing", async (_label, over) => {
    const store = await freshStore();

    const attempt = log(store, { photo: jpeg("x"), ...over });

    await expect(attempt).rejects.toBeInstanceOf(VisitError);
    await expectNothingWritten(store);
  });

  it("accepts today, the longest note and the longest dish text", async () => {
    const store = await freshStore();
    await log(store, { visitedOn: "2026-10-21", note: "x".repeat(MAX_NOTE), dishOther: "y".repeat(MAX_DISH_OTHER) });
    expect((await store.load()).visits).toHaveLength(1);
  });

  it("judges 'today' by the device's calendar date, not UTC", async () => {
    const store = await freshStore();
    const lateEvening = new Date(2026, 9, 21, 23, 59, 0);
    await expect(log(store, { visitedOn: "2026-10-21" }, lateEvening)).resolves.toBeDefined();
    await expect(log(store, { visitedOn: "2026-10-22" }, lateEvening)).rejects.toBeInstanceOf(VisitError);
  });

  it("shows messages that name the problem", async () => {
    const store = await freshStore();
    await expect(log(store, { visitedOn: "2026-10-22" })).rejects.toThrow(/future/i);
    await expect(log(store, { rating: 9 as unknown as 5 })).rejects.toThrow("Ratings go from 1 to 5.");
  });
});

describe("updateVisit", () => {
  it("changes only the keys it is given", async () => {
    const store = await freshStore();
    const { visit } = await log(store, { dishId: "seed:dish:NG:suya", rating: 3, note: "ok", photo: jpeg("p") });

    await updateVisit(store, visit.id, { rating: 5 });

    const [saved] = (await store.load()).visits;
    expect(saved).toEqual({ ...visit, rating: 5 });
    expect(await (await store.getPhoto(visit.photoId!))?.text()).toBe("p");
  });

  it("clears a field set to null and trims text", async () => {
    const store = await freshStore();
    const { visit } = await log(store, { rating: 3, note: "ok" });

    await updateVisit(store, visit.id, { rating: null, note: null, dishOther: "  Jollof " });

    expect((await store.load()).visits[0]).toMatchObject({ rating: null, note: null, dishOther: "Jollof" });
  });

  it("swapping to an approved dish drops typed text, and typing drops the approved dish", async () => {
    const store = await freshStore();
    const { visit } = await log(store, { dishOther: "Pepper soup" });

    await updateVisit(store, visit.id, { dishId: "seed:dish:NG:suya" });
    expect((await store.load()).visits[0]).toMatchObject({ dishId: "seed:dish:NG:suya", dishOther: null });

    await updateVisit(store, visit.id, { dishOther: "Egusi" });
    expect((await store.load()).visits[0]).toMatchObject({ dishId: null, dishOther: "Egusi" });
  });

  it("backdating moves the stamp date earlier", async () => {
    const store = await freshStore();
    const { visit } = await log(store, { visitedOn: "2026-10-20" });

    await updateVisit(store, visit.id, { visitedOn: "2026-08-02" });

    expect((await stampsOf(store))[0].earnedOn).toBe("2026-08-02");
  });

  it("refuses a bad change and leaves the visit as it was", async () => {
    const store = await freshStore();
    const { visit } = await log(store, { rating: 4 });
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const future = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

    await expect(updateVisit(store, visit.id, { visitedOn: future })).rejects.toBeInstanceOf(VisitError);
    await expect(updateVisit(store, visit.id, { rating: 9 as unknown as 5 })).rejects.toBeInstanceOf(VisitError);
    await expect(updateVisit(store, visit.id, { note: "x".repeat(MAX_NOTE + 1) })).rejects.toBeInstanceOf(VisitError);

    expect((await store.load()).visits).toEqual([visit]);
  });

  it("refuses an unknown visit", async () => {
    const store = await freshStore();
    await expect(updateVisit(store, "nope", { rating: 5 })).rejects.toBeInstanceOf(VisitError);
  });

  it("adds a photo to a visit that had none", async () => {
    const store = await freshStore();
    const { visit } = await log(store);

    await updateVisit(store, visit.id, { photo: jpeg("new") });

    const [saved] = (await store.load()).visits;
    expect(await (await store.getPhoto(saved.photoId!))?.text()).toBe("new");
  });

  it("replaces a photo and removes the old one from the store", async () => {
    const store = await freshStore();
    const { visit } = await log(store, { photo: jpeg("old") });

    await updateVisit(store, visit.id, { photo: jpeg("new") });

    const [saved] = (await store.load()).visits;
    expect(saved.photoId).not.toBe(visit.photoId);
    expect(await (await store.getPhoto(saved.photoId!))?.text()).toBe("new");
    expect(await store.getPhoto(visit.photoId!)).toBeNull();
    expect((await store.allPhotos()).size).toBe(1);
  });

  it("photo: null removes the photo from the visit and from the store", async () => {
    const store = await freshStore();
    const { visit } = await log(store, { photo: jpeg("old") });

    await updateVisit(store, visit.id, { photo: null });

    expect((await store.load()).visits[0].photoId).toBeNull();
    expect((await store.allPhotos()).size).toBe(0);
  });

  it("keeps the old photo and the visit untouched when the new photo cannot be stored", async () => {
    const store = await freshStore();
    const { visit } = await log(store, { photo: jpeg("old"), rating: 2 });
    const failing: SoloStore = { ...store, putPhoto: () => Promise.reject(new Error("QuotaExceededError")) };

    await expect(updateVisit(failing, visit.id, { photo: jpeg("new"), rating: 5 })).rejects.toBeInstanceOf(VisitError);

    expect((await store.load()).visits).toEqual([visit]);
    expect(await (await store.getPhoto(visit.photoId!))?.text()).toBe("old");
  });
});

describe("updateRestaurant", () => {
  it("moves the stamp when the country changes", async () => {
    const store = await freshStore();
    const { restaurant } = await log(store, { restaurant: SOHO_CAFE });
    expect((await stampsOf(store)).map((s) => s.countryIso2)).toEqual(["FR"]);

    await updateRestaurant(store, restaurant.id, { countryIso2: "ES" }, seed);

    expect((await stampsOf(store)).map((s) => s.countryIso2)).toEqual(["ES"]);
  });

  it("renames and re-addresses a place, and clears a blank address", async () => {
    const store = await freshStore();
    const { restaurant } = await log(store, { restaurant: SOHO_CAFE });

    await updateRestaurant(store, restaurant.id, { name: "  Maison Bertaux ", address: "28 Greek Street" }, seed);
    expect((await store.load()).restaurants[0]).toMatchObject({ name: "Maison Bertaux", address: "28 Greek Street" });

    await updateRestaurant(store, restaurant.id, { address: "  " }, seed);
    expect((await store.load()).restaurants[0].address).toBeNull();
  });

  it("refuses an empty name, an unknown country or an unknown restaurant", async () => {
    const store = await freshStore();
    const { restaurant } = await log(store, { restaurant: SOHO_CAFE });

    await expect(updateRestaurant(store, restaurant.id, { name: " " }, seed)).rejects.toBeInstanceOf(VisitError);
    await expect(updateRestaurant(store, restaurant.id, { countryIso2: "ZZ" }, seed)).rejects.toBeInstanceOf(
      VisitError,
    );
    await expect(updateRestaurant(store, "nope", { name: "x" }, seed)).rejects.toBeInstanceOf(VisitError);
    expect((await store.load()).restaurants).toEqual([restaurant]);
  });
});

describe("removeVisit", () => {
  it("deletes the visit and its photo, and the stamp follows", async () => {
    const store = await freshStore();
    const { visit } = await log(store, { photo: jpeg("p") });
    expect(await stampsOf(store)).toHaveLength(1);

    await removeVisit(store, visit.id);

    expect((await store.load()).visits).toEqual([]);
    expect(await store.getPhoto(visit.photoId!)).toBeNull();
    expect(await stampsOf(store)).toEqual([]);
  });

  it("hands the stamp to the next visit in that country", async () => {
    const store = await freshStore();
    const first = await log(store, { visitedOn: "2026-10-01" });
    await log(store, { visitedOn: "2026-10-10" });

    await removeVisit(store, first.visit.id);

    expect((await stampsOf(store))[0]).toMatchObject({ kind: "visit", earnedOn: "2026-10-10" });
  });
});

describe("outcomeCopy", () => {
  it("names the country in every outcome's title", () => {
    for (const outcome of ["stamped", "upgraded", "repeat"] as const) {
      const copy = outcomeCopy(outcome, "Spain");
      expect(copy.title).toContain("Spain");
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it("tells an upgrade apart from a first stamp and a repeat", () => {
    expect(outcomeCopy("upgraded", "Spain").title).toMatch(/upgraded/i);
    expect(outcomeCopy("upgraded", "Spain").body).toMatch(/before-the-app/i);
    expect(outcomeCopy("stamped", "Spain").title).toMatch(/stamped/i);
    expect(outcomeCopy("repeat", "Spain").body).toMatch(/another/i);
  });
});
