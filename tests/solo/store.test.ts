import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestPersistence } from "@solo/db/persist";
import { DB_NAME, DEFAULT_SETTINGS, type SoloData } from "@solo/db/schema";
import { openSoloStore, StoreUnavailableError, type SoloStore } from "@solo/db/store";
import type { Backfill, SoloRestaurant, SoloVisit } from "@solo/domain/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

function restaurant(id: string, over: Partial<SoloRestaurant> = {}): SoloRestaurant {
  return {
    id,
    seedId: null,
    name: `Restaurant ${id}`,
    countryIso2: "FR",
    address: null,
    lat: 48.85,
    lon: 2.35,
    createdAt: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

function visit(id: string, over: Partial<SoloVisit> = {}): SoloVisit {
  return {
    id,
    restaurantId: "r1",
    visitedOn: "2026-10-01",
    dishId: null,
    dishOther: null,
    rating: 4,
    note: null,
    photoId: null,
    createdAt: "2026-10-01T12:00:00.000Z",
    ...over,
  };
}

function backfill(countryIso2: string): Backfill {
  return { countryIso2, createdAt: "2026-09-01T09:00:00.000Z" };
}

function photo(text: string): Blob {
  return new Blob([text], { type: "image/jpeg" });
}

function data(over: Partial<SoloData> = {}): SoloData {
  return { restaurants: [], visits: [], backfills: [], settings: { ...DEFAULT_SETTINGS }, ...over };
}

async function freshStore(factory = new IDBFactory()): Promise<{ factory: IDBFactory; store: SoloStore }> {
  return { factory, store: await openSoloStore(factory) };
}

/** Puts a restaurant, a visit with a photo, a backfill and settings into the store. */
async function seedStore(store: SoloStore): Promise<void> {
  await store.putRestaurant(restaurant("r1"));
  await store.putVisit(visit("v1", { photoId: "p1" }));
  await store.putPhoto("p1", photo("one"));
  await store.putBackfills([backfill("IT")]);
  await store.setSettings({ lastExportAt: "2026-10-02T08:00:00.000Z" });
}

const sorted = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

describe("round trip", () => {
  it("loads defaults from an empty database", async () => {
    const { store } = await freshStore();
    expect(await store.load()).toEqual({ restaurants: [], visits: [], backfills: [], settings: { lastExportAt: null } });
    expect(await store.allPhotos()).toEqual(new Map());
    expect(await store.getPhoto("nope")).toBeNull();
  });

  it("keeps a restaurant, visit, backfill, photo and settings", async () => {
    const { store } = await freshStore();
    await seedStore(store);

    expect(await store.load()).toEqual({
      restaurants: [restaurant("r1")],
      visits: [visit("v1", { photoId: "p1" })],
      backfills: [backfill("IT")],
      settings: { lastExportAt: "2026-10-02T08:00:00.000Z" },
    });

    const stored = await store.getPhoto("p1");
    expect(stored).toBeInstanceOf(Blob);
    expect(stored?.type).toBe("image/jpeg");
    expect(await stored?.text()).toBe("one");
    expect(Array.from((await store.allPhotos()).keys())).toEqual(["p1"]);
  });

  it("overwrites a record put twice and adds backfills in one call", async () => {
    const { store } = await freshStore();
    await store.putRestaurant(restaurant("r1"));
    await store.putRestaurant(restaurant("r1", { name: "Renamed" }));
    await store.putBackfills([backfill("IT"), backfill("ES")]);
    await store.putBackfills([backfill("IT")]);

    const loaded = await store.load();
    expect(loaded.restaurants.map((r) => r.name)).toEqual(["Renamed"]);
    expect(loaded.backfills.map((b) => b.countryIso2).sort()).toEqual(["ES", "IT"]);
  });

  it("keeps the other settings when a patch is applied", async () => {
    const { store } = await freshStore();
    await store.setSettings({ lastExportAt: "2026-10-02T08:00:00.000Z" });
    await store.setSettings({});
    expect((await store.load()).settings).toEqual({ lastExportAt: "2026-10-02T08:00:00.000Z" });
    await store.setSettings({ lastExportAt: null });
    expect((await store.load()).settings).toEqual({ lastExportAt: null });
  });

  it("keeps its data when the database is opened again", async () => {
    const { factory, store } = await freshStore();
    await seedStore(store);

    const reopened = await openSoloStore(factory);
    expect((await reopened.load()).visits).toEqual([visit("v1", { photoId: "p1" })]);
    expect(await (await reopened.getPhoto("p1"))?.text()).toBe("one");
  });

  it("keeps separate databases apart by name", async () => {
    const factory = new IDBFactory();
    const mine = await openSoloStore(factory);
    const other = await openSoloStore(factory, "someone-else");
    await mine.putRestaurant(restaurant("r1"));
    expect((await other.load()).restaurants).toEqual([]);
    expect(DB_NAME).toBe("eat-the-world-solo");
  });
});

describe("deleting", () => {
  it("deleteVisit removes the visit and its photo but not other photos", async () => {
    const { store } = await freshStore();
    await store.putVisit(visit("v1", { photoId: "p1" }));
    await store.putVisit(visit("v2", { photoId: "p2" }));
    await store.putPhoto("p1", photo("one"));
    await store.putPhoto("p2", photo("two"));

    await store.deleteVisit("v1");

    expect((await store.load()).visits.map((v) => v.id)).toEqual(["v2"]);
    expect(await store.getPhoto("p1")).toBeNull();
    expect(await (await store.getPhoto("p2"))?.text()).toBe("two");
  });

  it("deleteVisit works for a visit without a photo and ignores an unknown id", async () => {
    const { store } = await freshStore();
    await store.putVisit(visit("v1"));
    await store.putPhoto("orphan", photo("keep me"));

    await store.deleteVisit("v1");
    await store.deleteVisit("never-existed");

    expect((await store.load()).visits).toEqual([]);
    expect(await store.getPhoto("orphan")).not.toBeNull();
  });

  it("deletePhoto removes that photo only, and ignores an unknown id", async () => {
    const { store } = await freshStore();
    await store.putPhoto("p1", photo("one"));
    await store.putPhoto("p2", photo("two"));

    await store.deletePhoto("p1");
    await store.deletePhoto("never-existed");

    expect(await store.getPhoto("p1")).toBeNull();
    expect(await (await store.getPhoto("p2"))?.text()).toBe("two");
  });

  it("deleteBackfill removes only that country", async () => {
    const { store } = await freshStore();
    await store.putBackfills([backfill("IT"), backfill("ES")]);
    await store.deleteBackfill("IT");
    expect((await store.load()).backfills.map((b) => b.countryIso2)).toEqual(["ES"]);
  });

  it("clearAll empties every store, settings included", async () => {
    const { factory, store } = await freshStore();
    await seedStore(store);

    await store.clearAll();

    expect(await store.load()).toEqual(data());
    expect((await store.allPhotos()).size).toBe(0);
    expect((await (await openSoloStore(factory)).load()).restaurants).toEqual([]);
  });
});

describe("importData", () => {
  const incoming = () =>
    data({
      restaurants: [restaurant("r1", { name: "From the file" }), restaurant("r2")],
      visits: [visit("v1", { note: "from the file" }), visit("v2", { restaurantId: "r2", photoId: "p2" })],
      backfills: [backfill("IT"), backfill("ES")],
      settings: { lastExportAt: "2026-12-31T00:00:00.000Z" },
    });

  it("merge twice leaves the counts unchanged the second time", async () => {
    const { store } = await freshStore();
    const photos = new Map([["p2", photo("two")]]);

    await store.importData(incoming(), { mode: "merge", photos });
    const first = await store.load();
    const firstPhotos = (await store.allPhotos()).size;
    await store.importData(incoming(), { mode: "merge", photos });
    const second = await store.load();

    expect(first.restaurants).toHaveLength(2);
    expect(first.visits).toHaveLength(2);
    expect(first.backfills).toHaveLength(2);
    expect(firstPhotos).toBe(1);
    expect(second).toEqual(first);
    expect((await store.allPhotos()).size).toBe(1);
  });

  it("merge keeps what is already here and adds only what is new", async () => {
    const { store } = await freshStore();
    await store.putRestaurant(restaurant("r1", { name: "Mine" }));
    await store.putVisit(visit("v1", { note: "mine" }));
    await store.putBackfills([backfill("IT")]);
    await store.putPhoto("p2", photo("mine"));

    await store.importData(incoming(), { mode: "merge", photos: new Map([["p2", photo("theirs")], ["p3", photo("new")]]) });

    const loaded = await store.load();
    expect(sorted(loaded.restaurants).map((r) => r.name)).toEqual(["Mine", "Restaurant r2"]);
    expect(sorted(loaded.visits).map((v) => v.note)).toEqual(["mine", null]);
    expect(loaded.backfills.map((b) => b.countryIso2).sort()).toEqual(["ES", "IT"]);
    expect(await (await store.getPhoto("p2"))?.text()).toBe("mine");
    expect(await (await store.getPhoto("p3"))?.text()).toBe("new");
  });

  it("merge leaves the settings alone", async () => {
    const { store } = await freshStore();
    await store.setSettings({ lastExportAt: "2026-10-02T08:00:00.000Z" });
    await store.importData(incoming(), { mode: "merge", photos: new Map() });
    expect((await store.load()).settings).toEqual({ lastExportAt: "2026-10-02T08:00:00.000Z" });
  });

  it("merge with no photos keeps the photos already on the device", async () => {
    const { store } = await freshStore();
    await seedStore(store);

    await store.importData(data({ visits: [visit("v1", { photoId: "p1" })] }), { mode: "merge", photos: new Map() });

    expect(await (await store.getPhoto("p1"))?.text()).toBe("one");
    expect((await store.load()).visits).toHaveLength(1);
  });

  it("replace swaps everything, photos included, and writes the settings as given", async () => {
    const { store } = await freshStore();
    await seedStore(store);
    await store.putRestaurant(restaurant("old-only"));
    await store.putBackfills([backfill("JP")]);

    await store.importData(incoming(), { mode: "replace", photos: new Map([["p2", photo("two")]]) });

    const loaded = await store.load();
    expect(sorted(loaded.restaurants)).toEqual(sorted(incoming().restaurants));
    expect(sorted(loaded.visits)).toEqual(sorted(incoming().visits));
    expect(loaded.backfills.map((b) => b.countryIso2).sort()).toEqual(["ES", "IT"]);
    expect(loaded.settings).toEqual({ lastExportAt: "2026-12-31T00:00:00.000Z" });
    expect(Array.from((await store.allPhotos()).keys())).toEqual(["p2"]);
    expect(await store.getPhoto("p1")).toBeNull();
  });

  it("replace with no photos clears the photos", async () => {
    const { store } = await freshStore();
    await seedStore(store);
    await store.importData(data(), { mode: "replace", photos: new Map() });
    expect((await store.allPhotos()).size).toBe(0);
    expect(await store.load()).toEqual(data());
  });

  it.each(["replace", "merge"] as const)("a failure part-way in %s mode leaves the old data untouched", async (mode) => {
    const { store } = await freshStore();
    await seedStore(store);
    const before = await store.load();

    // A function cannot be stored: the write throws after earlier writes in the same call went through.
    const unstorable = restaurant("r9", { name: () => "boom" } as unknown as Partial<SoloRestaurant>);
    const bad = data({
      restaurants: [restaurant("r2"), unstorable],
      visits: [visit("v2")],
      backfills: [backfill("ES")],
      settings: { lastExportAt: "2026-12-31T00:00:00.000Z" },
    });

    await expect(store.importData(bad, { mode, photos: new Map([["p9", photo("nine")]]) })).rejects.toThrow();

    expect(await store.load()).toEqual(before);
    expect(Array.from((await store.allPhotos()).keys())).toEqual(["p1"]);
  });

  it("a photo that cannot be stored rejects the call and leaves nothing behind", async () => {
    const { store } = await freshStore();
    await store.putVisit(visit("v1", { photoId: "p1" }));

    await expect(store.putPhoto("p1", (() => "not a blob") as unknown as Blob)).rejects.toThrow();

    expect(await store.getPhoto("p1")).toBeNull();
    expect((await store.load()).visits).toHaveLength(1);
  });
});

describe("openSoloStore", () => {
  const fakeFactory = (open: () => unknown) => ({ open }) as unknown as IDBFactory;

  async function rejection(promise: Promise<unknown>): Promise<StoreUnavailableError> {
    const error = await promise.then(
      () => {
        throw new Error("expected openSoloStore to reject");
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(StoreUnavailableError);
    return error as StoreUnavailableError;
  }

  it("rejects with StoreUnavailableError when the factory's open throws", async () => {
    const error = await rejection(
      openSoloStore(
        fakeFactory(() => {
          throw new DOMException("The operation is insecure.", "SecurityError");
        }),
      ),
    );
    expect(error.message).toMatch(/unavailable/i);
    expect(error.message).not.toMatch(/insecure|SecurityError/);
    expect((error.cause as DOMException).name).toBe("SecurityError");
  });

  it("rejects with StoreUnavailableError when there is no indexedDB at all", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await rejection(openSoloStore());
  });

  it("rejects with StoreUnavailableError when merely reading indexedDB throws", async () => {
    // Some browsers throw on the property access itself (stubGlobal first so the original is restored).
    vi.stubGlobal("indexedDB", undefined);
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get() {
        throw new Error("blocked by policy");
      },
    });
    await rejection(openSoloStore());
  });

  it("rejects with StoreUnavailableError when the request errors", async () => {
    // The database already exists at a newer version than this build understands.
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(DB_NAME, 2);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    await rejection(openSoloStore(factory));
  });

  it("rejects with StoreUnavailableError when the open is blocked, and closes a late connection", async () => {
    const request: Record<string, unknown> = {};
    const lateConnection = { close: vi.fn() };
    const factory = fakeFactory(() => {
      queueMicrotask(() => (request.onblocked as () => void)());
      return request;
    });

    await rejection(openSoloStore(factory));

    request.result = lateConnection;
    (request.onsuccess as () => void)();
    expect(lateConnection.close).toHaveBeenCalledOnce();
  });
});

describe("requestPersistence", () => {
  it("is unsupported when there is no navigator", async () => {
    vi.stubGlobal("navigator", undefined);
    expect(await requestPersistence()).toBe("unsupported");
  });

  it("is unsupported when navigator.storage is absent", async () => {
    vi.stubGlobal("navigator", {});
    expect(await requestPersistence()).toBe("unsupported");
  });

  it("is unsupported when storage has no persist()", async () => {
    vi.stubGlobal("navigator", { storage: {} });
    expect(await requestPersistence()).toBe("unsupported");
  });

  it("reports what the browser answers", async () => {
    vi.stubGlobal("navigator", { storage: { persist: async () => true } });
    expect(await requestPersistence()).toBe("granted");
    vi.stubGlobal("navigator", { storage: { persist: async () => false } });
    expect(await requestPersistence()).toBe("denied");
  });

  it("is denied when persist() throws", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        persist: async () => {
          throw new Error("not allowed");
        },
      },
    });
    expect(await requestPersistence()).toBe("denied");
  });
});
