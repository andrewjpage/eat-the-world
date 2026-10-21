import { MAX_DISH_OTHER, MAX_NOTE } from "@/components/checkin/logic";
import { seed as bundledSeed } from "@solo/data/seed";
import type { SoloData } from "@solo/db/schema";
import { isFutureDate, localToday } from "@solo/domain/stamps";
import type { Backfill, SeedData, SoloRestaurant, SoloVisit } from "@solo/domain/types";
import { isRating, isRealDate } from "@solo/services/visits";

export const BACKUP_APP = "eat-the-world-solo";
export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupFile {
  app: string;
  schemaVersion: number;
  /** When the snapshot was taken (ISO). */
  exportedAt: string;
  restaurants: SoloRestaurant[];
  visits: SoloVisit[];
  backfills: Backfill[];
  /** Keyed by photo id. Absent when the backup was made without photos. */
  photos?: Record<string, { type: string; base64: string }>;
}

export type ParseResult =
  | { ok: true; backup: BackupFile }
  | { ok: false; reason: "not-json" | "wrong-app" | "newer-version" | "invalid"; message: string };

export interface ImportSummary {
  newVisits: number;
  newRestaurants: number;
  newBackfills: number;
  /** Restaurants, visits and countries in the file that this phone already has. */
  alreadyHere: number;
  /** Photos in the file that belong to one of its visits. */
  photos: number;
}

/** `eat-the-world-YYYY-MM-DD.json`, dated by the local day. */
export function backupFileName(now: Date): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `eat-the-world-${date}.json`;
}

/** A problem with the file's contents. The message is plain language, safe to show on screen. */
class BackupInvalid extends Error {}

const invalid = (message: string): never => {
  throw new BackupInvalid(message);
};

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isId = (value: unknown): value is string => isText(value) && value !== "";
const isTime = (value: unknown): value is string => isText(value) && !Number.isNaN(Date.parse(value));
const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value);
const isCoordinate = (value: unknown, limit: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;

/** What a photo's bytes must look like once encoded: standard base64, correctly padded. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const IMAGE_TYPE = /^image\/[a-z0-9][a-z0-9.+-]*$/i;

function listOf(file: Row, key: string): unknown[] {
  const list = file[key];
  return Array.isArray(list) ? list : invalid(`The file has no list of ${key}.`);
}

function restaurantsOf(file: Row, seed: SeedData): SoloRestaurant[] {
  const countries = new Set(seed.countries.map((c) => c.iso2));
  const seen = new Set<string>();
  return listOf(file, "restaurants").map((raw, i) => {
    const at = `Restaurant ${i + 1}`;
    if (!isRow(raw) || !isId(raw.id)) return invalid(`${at} has no id.`);
    if (seen.has(raw.id)) return invalid(`${at} repeats an id that appears earlier in the file.`);
    seen.add(raw.id);
    if (!isText(raw.name) || raw.name.trim() === "") return invalid(`${at} has no name.`);
    if (!isText(raw.countryIso2) || !countries.has(raw.countryIso2)) return invalid(`${at} is in a country we don't know.`);
    if (!isTextOrNull(raw.seedId) || !isTextOrNull(raw.address)) return invalid(`${at} has a broken address.`);
    const [lat, lon] = [raw.lat, raw.lon];
    const placed = isCoordinate(lat, 90) && isCoordinate(lon, 180);
    if (!placed && (lat !== null || lon !== null)) return invalid(`${at} has a position that is not on the map.`);
    if (!isTime(raw.createdAt)) return invalid(`${at} has no time it was added.`);
    return {
      id: raw.id,
      seedId: raw.seedId,
      name: raw.name,
      countryIso2: raw.countryIso2,
      address: raw.address,
      lat: placed ? lat : null,
      lon: placed ? lon : null,
      createdAt: raw.createdAt,
    };
  });
}

function visitsOf(file: Row, restaurants: SoloRestaurant[], today: string): SoloVisit[] {
  const known = new Set(restaurants.map((r) => r.id));
  const seen = new Set<string>();
  return listOf(file, "visits").map((raw, i) => {
    const at = `Visit ${i + 1}`;
    if (!isRow(raw) || !isId(raw.id)) return invalid(`${at} has no id.`);
    if (seen.has(raw.id)) return invalid(`${at} repeats an id that appears earlier in the file.`);
    seen.add(raw.id);
    if (!isId(raw.restaurantId) || !known.has(raw.restaurantId)) return invalid(`${at} is for a restaurant the file doesn't have.`);
    if (!isText(raw.visitedOn) || !isRealDate(raw.visitedOn)) return invalid(`${at} has a date that isn't a real date.`);
    if (isFutureDate(raw.visitedOn, today)) return invalid(`${at} is dated in the future.`);
    if (raw.rating !== null && !isRating(raw.rating)) return invalid(`${at} has a rating outside 1 to 5.`);
    if (!isTextOrNull(raw.dishId) || !isTextOrNull(raw.dishOther) || !isTextOrNull(raw.note) || !isTextOrNull(raw.photoId)) {
      return invalid(`${at} has a field that isn't text.`);
    }
    if ((raw.dishOther?.length ?? 0) > MAX_DISH_OTHER) return invalid(`${at} has a dish name over ${MAX_DISH_OTHER} characters.`);
    if ((raw.note?.length ?? 0) > MAX_NOTE) return invalid(`${at} has a note over ${MAX_NOTE} characters.`);
    if (!isTime(raw.createdAt)) return invalid(`${at} has no time it was logged.`);
    return {
      id: raw.id,
      restaurantId: raw.restaurantId,
      visitedOn: raw.visitedOn,
      dishId: raw.dishId,
      dishOther: raw.dishOther,
      rating: raw.rating,
      note: raw.note,
      photoId: raw.photoId,
      createdAt: raw.createdAt,
    };
  });
}

function backfillsOf(file: Row, seed: SeedData): Backfill[] {
  const countries = new Set(seed.countries.map((c) => c.iso2));
  const seen = new Set<string>();
  return listOf(file, "backfills").map((raw, i) => {
    const at = `Country ${i + 1} from before the app`;
    if (!isRow(raw) || !isText(raw.countryIso2) || !countries.has(raw.countryIso2)) return invalid(`${at} isn't a country we know.`);
    if (seen.has(raw.countryIso2)) return invalid(`${at} repeats a country that appears earlier in the file.`);
    seen.add(raw.countryIso2);
    if (!isTime(raw.createdAt)) return invalid(`${at} has no time it was added.`);
    return { countryIso2: raw.countryIso2, createdAt: raw.createdAt };
  });
}

function photosOf(file: Row): BackupFile["photos"] {
  if (file.photos === undefined) return undefined;
  if (!isRow(file.photos)) return invalid("The photos in the file are in a form we can't read.");
  // fromEntries defines plain properties, so a photo keyed "__proto__" cannot reach the prototype.
  return Object.fromEntries(
    Object.entries(file.photos).map(([id, raw]) => {
      if (!isRow(raw) || !isText(raw.type) || !IMAGE_TYPE.test(raw.type)) return invalid("A photo in the file isn't an image.");
      if (!isText(raw.base64) || raw.base64.length % 4 !== 0 || !BASE64.test(raw.base64)) {
        return invalid("A photo in the file is damaged.");
      }
      return [id, { type: raw.type, base64: raw.base64 }];
    }),
  );
}

/**
 * Reads a backup file's text and checks every record in it, so nothing half-valid is ever written.
 * Checks use the same date, rating and length rules as logging a visit. `seed` and `now` are for tests.
 */
export function parseBackup(text: string, options: { seed?: SeedData; now?: Date } = {}): ParseResult {
  const { seed = bundledSeed, now = new Date() } = options;

  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-json", message: "That file isn't a backup. It isn't a JSON file at all." };
  }
  if (!isRow(file) || file.app !== BACKUP_APP) {
    return { ok: false, reason: "wrong-app", message: "That file isn't an Eat the World backup." };
  }
  const version = file.schemaVersion;
  if (typeof version === "number" && Number.isInteger(version) && version > BACKUP_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "newer-version",
      message: "That backup comes from a newer version of the app. Update this app, then try again.",
    };
  }
  if (version !== BACKUP_SCHEMA_VERSION) {
    return { ok: false, reason: "invalid", message: "That backup has a version number we don't recognise." };
  }

  try {
    const exportedAt = isTime(file.exportedAt) ? file.exportedAt : invalid("The file doesn't say when it was made.");
    const restaurants = restaurantsOf(file, seed);
    const visits = visitsOf(file, restaurants, localToday(now));
    const backfills = backfillsOf(file, seed);
    const photos = photosOf(file);
    const backup: BackupFile = {
      app: BACKUP_APP,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt,
      restaurants,
      visits,
      backfills,
      ...(photos && { photos }),
    };
    return { ok: true, backup };
  } catch (error) {
    if (!(error instanceof BackupInvalid)) throw error;
    return { ok: false, reason: "invalid", message: `That backup can't be used. ${error.message}` };
  }
}

/** What a merge would add, counted against what is on the phone now. */
export function summariseImport(current: SoloData, backup: BackupFile): ImportSummary {
  const outcome = <T>(incoming: T[], key: (row: T) => string, here: T[]) => {
    const have = new Set(here.map(key));
    const fresh = incoming.filter((row) => !have.has(key(row))).length;
    return { fresh, existing: incoming.length - fresh };
  };
  const restaurants = outcome(backup.restaurants, (r) => r.id, current.restaurants);
  const visits = outcome(backup.visits, (v) => v.id, current.visits);
  const backfills = outcome(backup.backfills, (b) => b.countryIso2, current.backfills);
  return {
    newVisits: visits.fresh,
    newRestaurants: restaurants.fresh,
    newBackfills: backfills.fresh,
    alreadyHere: visits.existing + restaurants.existing + backfills.existing,
    photos: backup.visits.filter((v) => v.photoId !== null && backup.photos?.[v.photoId]).length,
  };
}
