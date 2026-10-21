import type { DBSchema } from "idb";
import type { Backfill, SoloRestaurant, SoloVisit } from "@solo/domain/types";

export const DB_NAME = "eat-the-world-solo";
export const DB_VERSION = 1;

/** Every object store in the database. The e2e fixtures write into IndexedDB by these names. */
export const STORE_NAMES = ["restaurants", "visits", "backfills", "photos", "settings"] as const;

/** The `settings` store holds one row, under this key. */
export const SETTINGS_KEY = "app";

export interface SoloSettings {
  /** When the last backup left the device, or null if none has. */
  lastExportAt: string | null;
}

export const DEFAULT_SETTINGS: SoloSettings = { lastExportAt: null };

/** Everything the app knows, apart from photos (which are fetched by id). */
export interface SoloData {
  restaurants: SoloRestaurant[];
  visits: SoloVisit[];
  backfills: Backfill[];
  settings: SoloSettings;
}

export interface SoloSchema extends DBSchema {
  restaurants: { key: string; value: SoloRestaurant };
  visits: { key: string; value: SoloVisit };
  /** Keyed by `countryIso2`. */
  backfills: { key: string; value: Backfill };
  /** Out-of-line key: the photo id. JPEG blobs, already resized. */
  photos: { key: string; value: Blob };
  settings: { key: string; value: SoloSettings };
}

/** Creates the version 1 stores. Runs inside the open request's upgrade transaction. */
export function createSchema(db: IDBDatabase): void {
  db.createObjectStore("restaurants", { keyPath: "id" });
  db.createObjectStore("visits", { keyPath: "id" });
  db.createObjectStore("backfills", { keyPath: "countryIso2" });
  db.createObjectStore("photos");
  db.createObjectStore("settings");
}
