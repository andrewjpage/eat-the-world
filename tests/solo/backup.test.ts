import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyImport } from "@solo/backup/apply";
import { buildBackup } from "@solo/backup/build";
import {
  BACKUP_APP,
  BACKUP_SCHEMA_VERSION,
  backupFileName,
  parseBackup,
  summariseImport,
} from "@solo/backup/format";
import { shouldNudgeBackup } from "@solo/backup/nudge";
import { shareOrDownload } from "@solo/backup/share";
import { formatBytes } from "@solo/components/settings/bytes";
import { openSoloStore, type SoloStore } from "@solo/db/store";
import type { Backfill, SoloRestaurant, SoloVisit } from "@solo/domain/types";
import { MAX_DISH_OTHER, MAX_NOTE } from "@/components/checkin/logic";

/** Midday on 21 Oct 2026 in the machine's own time zone, which is what "today" means. */
const NOW = new Date(2026, 9, 21, 12, 0, 0);
const OPTIONS = { now: NOW };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function restaurant(id: string, over: Partial<SoloRestaurant> = {}): SoloRestaurant {
  return {
    id,
    seedId: null,
    name: `Restaurant ${id}`,
    countryIso2: "FR",
    address: "1 High St",
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

const backfill = (countryIso2: string): Backfill => ({ countryIso2, createdAt: "2026-09-01T09:00:00.000Z" });

/** Bytes that are not text: every value 0-255, repeated, so a lossy encoding would show. */
function bytes(length: number, salt = 0): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length }, (_, i) => (i * 7 + salt) % 256);
}

const jpeg = (length: number, salt = 0) => new Blob([bytes(length, salt)], { type: "image/jpeg" });

async function freshStore(): Promise<SoloStore> {
  return openSoloStore(new IDBFactory());
}

/** Two restaurants, three visits (two with a photo), two backfills, and a recorded export. */
async function populate(store: SoloStore): Promise<void> {
  await store.putRestaurant(restaurant("r1"));
  await store.putRestaurant(restaurant("r2", { name: "Sushi Place", countryIso2: "JP", lat: null, lon: null, address: null }));
  await store.putVisit(visit("v1", { photoId: "p1", dishOther: "Soup", note: "Lovely, with a ünïcode note" }));
  // Longer than one encoding chunk, so the chunk joins are exercised.
  await store.putVisit(visit("v2", { restaurantId: "r2", visitedOn: "2026-10-05", rating: null, photoId: "p2" }));
  await store.putVisit(visit("v3", { restaurantId: "r2", visitedOn: "2026-10-09", dishId: "seed:dish:JP:ramen" }));
  await store.putPhoto("p1", jpeg(10));
  await store.putPhoto("p2", jpeg(100_003, 5));
  await store.putBackfills([backfill("IT"), backfill("ES")]);
  await store.setSettings({ lastExportAt: "2026-10-02T08:00:00.000Z" });
}

const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
const byIso = (rows: Backfill[]) => [...rows].sort((a, b) => a.countryIso2.localeCompare(b.countryIso2));

async function expectSameData(actual: SoloStore, expected: SoloStore) {
  const [a, e] = [await actual.load(), await expected.load()];
  expect(byId(a.restaurants)).toEqual(byId(e.restaurants));
  expect(byId(a.visits)).toEqual(byId(e.visits));
  expect(byIso(a.backfills)).toEqual(byIso(e.backfills));
}

/** What Settings does with a chosen file: parse it, and only write when it passed. */
async function importText(store: SoloStore, text: string, mode: "merge" | "replace") {
  const parsed = parseBackup(text, OPTIONS);
  if (parsed.ok) await applyImport(store, parsed.backup, mode);
  return parsed;
}

const exportText = async (store: SoloStore, includePhotos = true) =>
  JSON.stringify(await buildBackup(await store.load(), store, includePhotos, NOW));

/** A valid backup file as a plain object, ready to be spoiled one field at a time. */
function validFile(over: Record<string, unknown> = {}) {
  return {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: "2026-10-20T10:00:00.000Z",
    restaurants: [restaurant("r1")],
    visits: [visit("v1")],
    backfills: [backfill("IT")],
    ...over,
  };
}

const parse = (file: unknown) => parseBackup(JSON.stringify(file), OPTIONS);

function rejection(file: unknown) {
  const result = parse(file);
  if (result.ok) throw new Error("expected the file to be rejected");
  return result;
}

describe("export and import", () => {
  it("replace into an empty store reproduces every restaurant, visit, backfill and photo", async () => {
    const source = await freshStore();
    await populate(source);
    const text = await exportText(source);

    const target = await freshStore();
    const parsed = await importText(target, text, "replace");
    expect(parsed.ok).toBe(true);

    await expectSameData(target, source);
    const photos = await target.allPhotos();
    expect([...photos.keys()].sort()).toEqual(["p1", "p2"]);
    for (const id of ["p1", "p2"]) {
      const [got, want] = [photos.get(id)!, (await source.getPhoto(id))!];
      expect(got.type).toBe("image/jpeg");
      expect(new Uint8Array(await got.arrayBuffer())).toEqual(new Uint8Array(await want.arrayBuffer()));
    }
  });

  it("names the file by local date and tags it with the app and schema version", async () => {
    const source = await freshStore();
    await populate(source);
    const backup = await buildBackup(await source.load(), source, true, NOW);

    expect(backupFileName(NOW)).toBe("eat-the-world-2026-10-21.json");
    expect(backup).toMatchObject({ app: "eat-the-world-solo", schemaVersion: 1, exportedAt: NOW.toISOString() });
    expect(backup.restaurants).toHaveLength(2);
    expect(backup.visits).toHaveLength(3);
    expect(backup.backfills).toHaveLength(2);
    // Settings are this phone's business; a backup does not carry them.
    expect(backup).not.toHaveProperty("settings");
  });

  it("leaves photos out when asked to, and says nothing of photos the visits lack", async () => {
    const source = await freshStore();
    await populate(source);

    expect(await buildBackup(await source.load(), source, false, NOW)).not.toHaveProperty("photos");
    const withPhotos = await buildBackup(await source.load(), source, true, NOW);
    expect(Object.keys(withPhotos.photos ?? {}).sort()).toEqual(["p1", "p2"]);
  });

  it("reads photos one at a time and never asks the store for all of them", async () => {
    const source = await freshStore();
    await populate(source);

    let inFlight = 0;
    let mostAtOnce = 0;
    const getPhoto = source.getPhoto.bind(source);
    const spy: SoloStore = {
      ...source,
      allPhotos: () => Promise.reject(new Error("buildBackup must not load every photo")),
      async getPhoto(id) {
        mostAtOnce = Math.max(mostAtOnce, ++inFlight);
        try {
          return await getPhoto(id);
        } finally {
          inFlight--;
        }
      },
    };

    const backup = await buildBackup(await source.load(), spy, true, NOW);
    expect(Object.keys(backup.photos ?? {})).toHaveLength(2);
    expect(mostAtOnce).toBe(1);
  });

  it("skips a photo the store no longer has instead of failing the export", async () => {
    const source = await freshStore();
    await source.putRestaurant(restaurant("r1"));
    await source.putVisit(visit("v1", { photoId: "gone" }));

    const backup = await buildBackup(await source.load(), source, true, NOW);
    expect(backup.photos).toEqual({});
    expect(backup.visits[0].photoId).toBe("gone");
  });

  it("merging the same file twice adds nothing the second time", async () => {
    const source = await freshStore();
    await populate(source);
    const text = await exportText(source);

    const target = await freshStore();
    const first = parseBackup(text, OPTIONS);
    if (!first.ok) throw new Error(first.message);
    const before = summariseImport(await target.load(), first.backup);
    expect(before).toEqual({ newVisits: 3, newRestaurants: 2, newBackfills: 2, alreadyHere: 0, photos: 2 });
    await applyImport(target, first.backup, "merge");

    const second = summariseImport(await target.load(), first.backup);
    expect(second).toMatchObject({ newVisits: 0, newRestaurants: 0, newBackfills: 0, alreadyHere: 7 });
    expect(second.alreadyHere).toBe(before.newVisits + before.newRestaurants + before.newBackfills);

    await applyImport(target, first.backup, "merge");
    await expectSameData(target, source);
    expect((await target.allPhotos()).size).toBe(2);
  });

  it("merge keeps what is here and adds what is not, and leaves the settings alone", async () => {
    const target = await freshStore();
    await target.putRestaurant(restaurant("r1", { name: "My own name for it" }));
    await target.putVisit(visit("v1", { rating: 2 }));
    await target.setSettings({ lastExportAt: "2026-10-19T07:00:00.000Z" });

    const result = await importText(target, JSON.stringify(validFile({ visits: [visit("v1", { rating: 5 }), visit("v9")] })), "merge");
    expect(result.ok).toBe(true);

    const here = await target.load();
    expect(here.restaurants.map((r) => r.name)).toEqual(["My own name for it"]);
    expect(byId(here.visits).map((v) => [v.id, v.rating])).toEqual([["v1", 2], ["v9", 4]]);
    expect(here.backfills.map((b) => b.countryIso2)).toEqual(["IT"]);
    expect(here.settings.lastExportAt).toBe("2026-10-19T07:00:00.000Z");
  });

  it("replace swaps everything for the file's contents but keeps this phone's settings", async () => {
    const target = await freshStore();
    await target.putRestaurant(restaurant("old"));
    await target.putVisit(visit("old-v", { restaurantId: "old", photoId: "old-p" }));
    await target.putPhoto("old-p", jpeg(8));
    await target.putBackfills([backfill("PE")]);
    await target.setSettings({ lastExportAt: "2026-10-19T07:00:00.000Z" });

    await importText(target, JSON.stringify(validFile()), "replace");

    const here = await target.load();
    expect(here.restaurants.map((r) => r.id)).toEqual(["r1"]);
    expect(here.visits.map((v) => v.id)).toEqual(["v1"]);
    expect(here.backfills.map((b) => b.countryIso2)).toEqual(["IT"]);
    expect(here.settings.lastExportAt).toBe("2026-10-19T07:00:00.000Z");
    expect((await target.allPhotos()).size).toBe(0);
  });

  it("replace with a backup made without photos keeps the photos the file's visits name", async () => {
    const source = await freshStore();
    await populate(source);
    const withoutPhotos = await exportText(source, false);
    expect(JSON.parse(withoutPhotos)).not.toHaveProperty("photos");

    const parsed = await importText(source, withoutPhotos, "replace");
    expect(parsed.ok).toBe(true);

    const photos = await source.allPhotos();
    expect([...photos.keys()].sort()).toEqual(["p1", "p2"]);
    expect(new Uint8Array(await photos.get("p2")!.arrayBuffer())).toEqual(bytes(100_003, 5));
    expect((await source.load()).visits.map((v) => v.photoId).sort()).toEqual([null, "p1", "p2"]);
  });

  it("replace still removes photos on the phone that none of the file's visits name", async () => {
    const target = await freshStore();
    await target.putRestaurant(restaurant("r1"));
    await target.putRestaurant(restaurant("old"));
    await target.putVisit(visit("v1", { photoId: "p1" }));
    await target.putVisit(visit("old-v", { restaurantId: "old", photoId: "old-p" }));
    await target.putPhoto("p1", jpeg(12, 3));
    await target.putPhoto("old-p", jpeg(8));
    await target.putPhoto("loose", jpeg(5));

    // The file has v1 (and so p1) plus a visit whose photo this phone never had.
    const file = validFile({ visits: [visit("v1", { photoId: "p1" }), visit("v2", { photoId: "never-had" })] });
    await importText(target, JSON.stringify(file), "replace");

    const photos = await target.allPhotos();
    expect([...photos.keys()]).toEqual(["p1"]);
    expect(new Uint8Array(await photos.get("p1")!.arrayBuffer())).toEqual(bytes(12, 3));
    expect((await target.load()).visits.map((v) => v.id).sort()).toEqual(["v1", "v2"]);
  });

  it("replace takes the file's own photo over the phone's when both have one", async () => {
    const source = await freshStore();
    await populate(source);
    const text = await exportText(source);

    await source.putPhoto("p1", jpeg(10, 99));
    await importText(source, text, "replace");

    expect(new Uint8Array(await (await source.getPhoto("p1"))!.arrayBuffer())).toEqual(bytes(10));
  });

  it("a backup without photos merged into a store with photos leaves them", async () => {
    const source = await freshStore();
    await populate(source);
    const withoutPhotos = await exportText(source, false);

    await importText(source, withoutPhotos, "merge");

    const photos = await source.allPhotos();
    expect([...photos.keys()].sort()).toEqual(["p1", "p2"]);
    expect(new Uint8Array(await photos.get("p2")!.arrayBuffer())).toEqual(bytes(100_003, 5));
  });

  it("restores a lost photo for a visit that is already here, but never keeps one nothing refers to", async () => {
    const source = await freshStore();
    await populate(source);
    const file = JSON.parse(await exportText(source));
    file.photos.stray = { type: "image/jpeg", base64: btoa("stray") };

    const target = await freshStore();
    // v1 is here and names p1, whose photo is gone; v2 is here with no photo at all.
    await target.putRestaurant(restaurant("r1"));
    await target.putRestaurant(restaurant("r2"));
    await target.putVisit(visit("v1", { photoId: "p1" }));
    await target.putVisit(visit("v2", { restaurantId: "r2", photoId: null }));
    await importText(target, JSON.stringify(file), "merge");

    expect([...(await target.allPhotos()).keys()]).toEqual(["p1"]);

    const replaced = await freshStore();
    await importText(replaced, JSON.stringify(file), "replace");
    expect([...(await replaced.allPhotos()).keys()].sort()).toEqual(["p1", "p2"]);
  });
});

describe("a file that is not a usable backup", () => {
  async function untouchedBy(text: string) {
    const store = await freshStore();
    await populate(store);
    const before = await store.load();
    const photosBefore = [...(await store.allPhotos()).keys()].sort();
    const importData = vi.spyOn(store, "importData");

    const result = await importText(store, text, "replace");

    expect(importData).not.toHaveBeenCalled();
    expect(await store.load()).toEqual(before);
    expect([...(await store.allPhotos()).keys()].sort()).toEqual(photosBefore);
    return result;
  }

  it("a file from a newer version is refused as newer-version", async () => {
    const result = await untouchedBy(JSON.stringify(validFile({ schemaVersion: 2 })));
    expect(result).toMatchObject({ ok: false, reason: "newer-version" });
  });

  it("plain text is refused as not-json", async () => {
    expect(await untouchedBy("hello")).toMatchObject({ ok: false, reason: "not-json" });
    expect(parseBackup("", OPTIONS)).toMatchObject({ ok: false, reason: "not-json" });
  });

  it("another app's file is refused as wrong-app", async () => {
    expect(await untouchedBy(JSON.stringify(validFile({ app: "some-other-app" })))).toMatchObject({
      ok: false,
      reason: "wrong-app",
    });
    expect(parse([1, 2, 3])).toMatchObject({ ok: false, reason: "wrong-app" });
    expect(parse(null)).toMatchObject({ ok: false, reason: "wrong-app" });
    const { app, ...noApp } = validFile();
    void app;
    expect(parse(noApp)).toMatchObject({ ok: false, reason: "wrong-app" });
  });

  it("a visit rated 9 is refused as invalid, with a message to show", async () => {
    const result = await untouchedBy(JSON.stringify(validFile({ visits: [visit("v1", { rating: 9 as never })] })));
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(result.ok ? "" : result.message).toMatch(/rating/i);
  });

  it.each([
    ["a missing schema version", { schemaVersion: undefined }],
    ["version 0", { schemaVersion: 0 }],
    ["a schema version that is text", { schemaVersion: "1" }],
    ["a fractional schema version", { schemaVersion: 1.5 }],
    ["restaurants that are not a list", { restaurants: {} }],
    ["no visits list", { visits: undefined }],
    ["no exported-at time", { exportedAt: undefined }],
  ])("refuses %s as invalid", (_name, over) => {
    expect(rejection(validFile(over))).toMatchObject({ reason: "invalid" });
  });

  it.each([
    ["a rating of 0", visit("v1", { rating: 0 as never })],
    ["a rating of 2.5", visit("v1", { rating: 2.5 as never })],
    ["a rating as text", visit("v1", { rating: "4" as never })],
    ["an impossible date", visit("v1", { visitedOn: "2026-02-30" })],
    ["a date that is not zero padded", visit("v1", { visitedOn: "2026-2-3" })],
    ["a date before 1900", visit("v1", { visitedOn: "1899-12-31" })],
    ["a date that is not a date", visit("v1", { visitedOn: "yesterday" })],
    ["a date two days ahead", visit("v1", { visitedOn: "2026-10-23" })],
    ["a note that is too long", visit("v1", { note: "x".repeat(MAX_NOTE + 1) })],
    ["a dish name that is too long", visit("v1", { dishOther: "x".repeat(MAX_DISH_OTHER + 1) })],
    ["no id", visit("", {})],
    ["an unknown restaurant", visit("v1", { restaurantId: "nowhere" })],
    ["a photo id that is a number", visit("v1", { photoId: 7 as never })],
    ["a created-at that is not a time", visit("v1", { createdAt: "later" })],
  ])("refuses a visit with %s", (_name, bad) => {
    expect(rejection(validFile({ visits: [bad] }))).toMatchObject({ reason: "invalid" });
  });

  it("accepts today, the first day of 1900, a full-length note and a rating of 1 or 5", () => {
    const visits = [
      visit("v1", { visitedOn: "2026-10-21", rating: 1 }),
      visit("v2", { visitedOn: "1900-01-01", rating: 5 }),
      visit("v3", { note: "x".repeat(MAX_NOTE), dishOther: "y".repeat(MAX_DISH_OTHER), rating: null }),
    ];
    expect(parse(validFile({ visits }))).toMatchObject({ ok: true });
  });

  it("accepts tomorrow's date, which a phone across the date line can already be on", () => {
    expect(parse(validFile({ visits: [visit("v1", { visitedOn: "2026-10-22" })] }))).toMatchObject({ ok: true });
  });

  it.each([
    ["a restaurant in no country", restaurant("r1", { countryIso2: "ZZ" })],
    ["a restaurant with no name", restaurant("r1", { name: "  " })],
    ["a restaurant with only a latitude", restaurant("r1", { lon: null })],
    ["a latitude past the pole", restaurant("r1", { lat: 91 })],
    ["a restaurant with no id", restaurant("", {})],
  ])("refuses %s", (_name, bad) => {
    expect(rejection(validFile({ restaurants: [bad] }))).toMatchObject({ reason: "invalid" });
  });

  it("refuses a country that does not exist, or a backfill with no time", () => {
    expect(rejection(validFile({ backfills: [{ countryIso2: "ZZ", createdAt: "2026-09-01T09:00:00.000Z" }] }))).toMatchObject({
      reason: "invalid",
    });
    expect(rejection(validFile({ backfills: [{ countryIso2: "IT" }] }))).toMatchObject({ reason: "invalid" });
  });

  it("refuses repeated ids, which the merge could not tell apart", () => {
    expect(rejection(validFile({ restaurants: [restaurant("r1"), restaurant("r1")] }))).toMatchObject({ reason: "invalid" });
    expect(rejection(validFile({ visits: [visit("v1"), visit("v1", { rating: 2 })] }))).toMatchObject({ reason: "invalid" });
    expect(rejection(validFile({ backfills: [backfill("IT"), backfill("IT")] }))).toMatchObject({ reason: "invalid" });
  });

  it.each([
    ["a photo that is not an image", { type: "text/html", base64: btoa("<b>hi</b>") }],
    ["a photo with no type", { base64: btoa("abc") }],
    ["a photo that is not base64", { type: "image/jpeg", base64: "not base64 at all!" }],
    ["a photo with broken padding", { type: "image/jpeg", base64: "QUJD=" }],
    ["a photo that is not text", { type: "image/jpeg", base64: 12 }],
    ["a photo that is not an object", "image"],
  ])("refuses %s", (_name, bad) => {
    expect(rejection(validFile({ photos: { p1: bad } }))).toMatchObject({ reason: "invalid" });
  });

  it("refuses a photos entry that is not a map", () => {
    expect(rejection(validFile({ photos: [] }))).toMatchObject({ reason: "invalid" });
  });

  it("keeps only the fields it knows, so a file cannot slip other keys into the database", () => {
    const result = parse(
      validFile({
        restaurants: [{ ...restaurant("r1"), extra: "x" }],
        visits: [{ ...visit("v1"), secret: 1 }],
      }),
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.backup.restaurants[0]).toEqual(restaurant("r1"));
    expect(result.backup.visits[0]).toEqual(visit("v1"));
  });

  it("treats a photo keyed __proto__ as data, not as a prototype", () => {
    const text = JSON.stringify(validFile()).replace(/}$/, ',"photos":{"__proto__":{"type":"image/png","base64":"QUJDRA=="}}}');
    const result = parseBackup(text, OPTIONS);
    if (!result.ok) throw new Error(result.message);
    expect(Object.getPrototypeOf(result.backup.photos)).toBe(Object.prototype);
    expect(Object.keys(result.backup.photos ?? {})).toEqual(["__proto__"]);
  });

  it("accepts a good photo and a file with none", () => {
    expect(parse(validFile({ photos: { v1: { type: "image/png", base64: "QUJDRA==" } } }))).toMatchObject({ ok: true });
    expect(parse(validFile())).toMatchObject({ ok: true });
  });
});

describe("shouldNudgeBackup", () => {
  const day = 24 * 60 * 60 * 1000;
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  const visitsMade = (count: number, createdAt: string) =>
    Array.from({ length: count }, (_, i) => visit(`n${i}`, { createdAt }));

  it("stays quiet for 9 new visits and 5 days", () => {
    expect(
      shouldNudgeBackup({ visits: visitsMade(9, ago(day)), backfills: [], lastExportAt: ago(5 * day), now: NOW }),
    ).toBe(false);
  });

  it("speaks up at 10 new visits", () => {
    expect(
      shouldNudgeBackup({ visits: visitsMade(10, ago(day)), backfills: [], lastExportAt: ago(5 * day), now: NOW }),
    ).toBe(true);
  });

  it("counts backfills alongside visits", () => {
    const backfills = Array.from({ length: 4 }, (_, i) => ({ countryIso2: `C${i}`, createdAt: ago(day) }));
    expect(
      shouldNudgeBackup({ visits: visitsMade(6, ago(day)), backfills, lastExportAt: ago(5 * day), now: NOW }),
    ).toBe(true);
  });

  it("speaks up for one new visit once 31 days have passed since the export", () => {
    expect(
      shouldNudgeBackup({ visits: visitsMade(1, ago(day)), backfills: [], lastExportAt: ago(31 * day), now: NOW }),
    ).toBe(true);
    expect(
      shouldNudgeBackup({ visits: visitsMade(1, ago(day)), backfills: [], lastExportAt: ago(29 * day), now: NOW }),
    ).toBe(false);
  });

  it("stays quiet when nothing is new, however long it has been", () => {
    const old = visitsMade(12, ago(100 * day));
    expect(shouldNudgeBackup({ visits: old, backfills: [], lastExportAt: ago(60 * day), now: NOW })).toBe(false);
    expect(shouldNudgeBackup({ visits: [], backfills: [], lastExportAt: null, now: NOW })).toBe(false);
  });

  it("ignores what was made before the last export", () => {
    const before = visitsMade(10, ago(10 * day));
    expect(shouldNudgeBackup({ visits: before, backfills: [], lastExportAt: ago(5 * day), now: NOW })).toBe(false);
  });

  it("with no export yet, counts everything, and measures the 30 days from the oldest record", () => {
    expect(shouldNudgeBackup({ visits: visitsMade(10, ago(day)), backfills: [], lastExportAt: null, now: NOW })).toBe(true);
    expect(shouldNudgeBackup({ visits: visitsMade(1, ago(day)), backfills: [], lastExportAt: null, now: NOW })).toBe(false);
    const oldest = [visit("old", { createdAt: ago(31 * day) }), ...visitsMade(1, ago(day))];
    expect(shouldNudgeBackup({ visits: oldest, backfills: [], lastExportAt: null, now: NOW })).toBe(true);
    const memory = [{ countryIso2: "IT", createdAt: ago(40 * day) }];
    expect(shouldNudgeBackup({ visits: [], backfills: memory, lastExportAt: null, now: NOW })).toBe(true);
  });
});

describe("shareOrDownload", () => {
  const NAME = "eat-the-world-2026-10-21.json";

  /** A page with a sharing browser and a document that records the anchor clicked to download. */
  function stubBrowser(navigatorParts: Record<string, unknown>) {
    const clicked: { download: string; href: string }[] = [];
    vi.stubGlobal("navigator", navigatorParts);
    vi.stubGlobal("document", {
      createElement: () => {
        const anchor = {
          download: "",
          href: "",
          click: () => clicked.push({ download: anchor.download, href: anchor.href }),
          remove() {},
        };
        return anchor;
      },
      body: { append() {} },
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    return clicked;
  }

  const abort = () => Object.assign(new Error("share cancelled"), { name: "AbortError" });

  it("shares the file where the browser will share files", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const clicked = stubBrowser({ canShare: () => true, share });

    expect(await shareOrDownload(NAME, "{}")).toBe("shared");

    expect(clicked).toEqual([]);
    const shared = share.mock.calls[0][0].files[0] as File;
    expect(shared.name).toBe(NAME);
    expect(await shared.text()).toBe("{}");
  });

  it("reports a closed share sheet as cancelled, and downloads nothing", async () => {
    const clicked = stubBrowser({ canShare: () => true, share: vi.fn().mockRejectedValue(abort()) });
    expect(await shareOrDownload(NAME, "{}")).toBe("cancelled");
    expect(clicked).toEqual([]);
  });

  it("downloads when the browser cannot share files", async () => {
    const share = vi.fn();
    const clicked = stubBrowser({ canShare: () => false, share });
    expect(await shareOrDownload(NAME, "{}")).toBe("downloaded");
    expect(share).not.toHaveBeenCalled();
    expect(clicked).toEqual([{ download: NAME, href: "blob:backup" }]);
  });

  it("downloads when the browser has no sharing at all", async () => {
    const clicked = stubBrowser({});
    expect(await shareOrDownload(NAME, "{}")).toBe("downloaded");
    expect(clicked).toHaveLength(1);
  });

  it("falls back to a download when sharing fails for any other reason", async () => {
    const refused = Object.assign(new Error("needs a tap"), { name: "NotAllowedError" });
    const clicked = stubBrowser({ canShare: () => true, share: vi.fn().mockRejectedValue(refused) });
    expect(await shareOrDownload(NAME, "{}")).toBe("downloaded");
    expect(clicked).toHaveLength(1);
  });
});

describe("formatBytes", () => {
  it("writes sizes for people", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(980)).toBe("980 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(12.4 * 1024 * 1024)).toBe("12 MB");
    expect(formatBytes(10 * 1024 ** 3)).toBe("10 GB");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});
