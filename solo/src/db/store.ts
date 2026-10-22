import { wrap, type IDBPDatabase, type IDBPTransaction, type StoreNames } from "idb";
import type { Backfill, SoloRestaurant, SoloVisit } from "@solo/domain/types";
import {
  createSchema,
  DB_NAME,
  DB_VERSION,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  STORE_NAMES,
  type SoloData,
  type SoloSchema,
  type SoloSettings,
} from "./schema";

export type { SoloData, SoloSettings } from "./schema";

export interface SoloStore {
  load(): Promise<SoloData>;
  putRestaurant(r: SoloRestaurant): Promise<void>;
  putVisit(v: SoloVisit): Promise<void>;
  /** Also deletes the visit's photo. */
  deleteVisit(id: string): Promise<void>;
  putBackfills(b: Backfill[]): Promise<void>;
  deleteBackfill(iso2: string): Promise<void>;
  putPhoto(id: string, blob: Blob): Promise<void>;
  getPhoto(id: string): Promise<Blob | null>;
  /** Removes one photo. A visit that still names it is left as it is, so point the visit elsewhere first. */
  deletePhoto(id: string): Promise<void>;
  allPhotos(): Promise<Map<string, Blob>>;
  setSettings(patch: Partial<SoloSettings>): Promise<void>;
  /**
   * One transaction: it all happens or none of it does. `replace` clears every store first and writes
   * `data.settings` as given. `merge` writes only records and photos whose ids are absent (what is
   * already here wins) and leaves the settings alone.
   */
  importData(data: SoloData, opts: { mode: "merge" | "replace"; photos: Map<string, Blob> }): Promise<void>;
  clearAll(): Promise<void>;
}

const UNAVAILABLE_MESSAGE =
  "Storage is unavailable in this window, so nothing can be saved here. Private and guest windows often block it; open the app in a normal browser window.";

/** The browser would not open the database. The message is plain language, safe to show on screen. */
export class StoreUnavailableError extends Error {
  constructor(message: string = UNAVAILABLE_MESSAGE, options?: ErrorOptions) {
    super(message, options);
    this.name = "StoreUnavailableError";
  }
}

type Db = IDBPDatabase<SoloSchema>;
type StoreName = StoreNames<SoloSchema>;

/** `idb`'s `openDB` only talks to the global factory; this takes any, so tests can supply their own. */
function openDatabase(factory: IDBFactory, name: string): Promise<Db> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      reject(cause);
    };

    const request = factory.open(name, DB_VERSION);
    request.onupgradeneeded = (event) => createSchema(request.result, event.oldVersion);
    request.onblocked = () => fail(new Error("Opening the database is blocked by another window."));
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      // An open that was given up on (blocked) must not leave a connection behind.
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      // Another window wants a newer version (this one is the old build). Closing lets that upgrade
      // proceed rather than wait forever; this window's code is stale anyway, so it starts over.
      request.result.onversionchange = () => {
        request.result.close();
        globalThis.location?.reload?.();
      };
      resolve(wrap(request.result) as unknown as Db);
    };
  });
}

/**
 * Runs `run` in one transaction and resolves once it has committed. If `run` throws, or any request
 * fails, the transaction is aborted so a half-finished write is never kept.
 */
async function inTransaction<N extends StoreName[], M extends IDBTransactionMode, T>(
  db: Db,
  names: [...N],
  mode: M,
  run: (tx: IDBPTransaction<SoloSchema, N, M>) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(names, mode);
  // Failures are reported by the awaits below; this keeps an abort from also surfacing as unhandled.
  tx.done.catch(() => {});
  try {
    const result = await run(tx);
    await tx.done;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // Already committed or aborted.
    }
    throw error;
  }
}

const ALL_STORES: StoreName[] = [...STORE_NAMES];

function createStore(db: Db): SoloStore {
  return {
    load: () =>
      inTransaction(db, ["restaurants", "visits", "backfills", "settings"], "readonly", async (tx) => {
        const [restaurants, visits, backfills, settings] = await Promise.all([
          tx.objectStore("restaurants").getAll(),
          tx.objectStore("visits").getAll(),
          tx.objectStore("backfills").getAll(),
          tx.objectStore("settings").get(SETTINGS_KEY),
        ]);
        return { restaurants, visits, backfills, settings: { ...DEFAULT_SETTINGS, ...settings } };
      }),

    async putRestaurant(r) {
      await db.put("restaurants", r);
    },

    async putVisit(v) {
      await db.put("visits", v);
    },

    deleteVisit: (id) =>
      inTransaction(db, ["visits", "photos"], "readwrite", async (tx) => {
        const visits = tx.objectStore("visits");
        const visit = await visits.get(id);
        if (!visit) return;
        await visits.delete(id);
        if (visit.photoId) await tx.objectStore("photos").delete(visit.photoId);
      }),

    putBackfills: (rows) =>
      inTransaction(db, ["backfills"], "readwrite", async (tx) => {
        for (const row of rows) await tx.objectStore("backfills").put(row);
      }),

    async deleteBackfill(iso2) {
      await db.delete("backfills", iso2);
    },

    async putPhoto(id, blob) {
      await db.put("photos", blob, id);
    },

    async getPhoto(id) {
      return (await db.get("photos", id)) ?? null;
    },

    async deletePhoto(id) {
      await db.delete("photos", id);
    },

    allPhotos: () =>
      inTransaction(db, ["photos"], "readonly", async (tx) => {
        const store = tx.objectStore("photos");
        const [ids, blobs] = await Promise.all([store.getAllKeys(), store.getAll()]);
        return new Map(ids.map((id, i) => [id, blobs[i]]));
      }),

    setSettings: (patch) =>
      inTransaction(db, ["settings"], "readwrite", async (tx) => {
        const store = tx.objectStore("settings");
        const current = await store.get(SETTINGS_KEY);
        await store.put({ ...DEFAULT_SETTINGS, ...current, ...patch }, SETTINGS_KEY);
      }),

    importData: (data, { mode, photos }) =>
      inTransaction(db, ALL_STORES, "readwrite", async (tx) => {
        if (mode === "replace") {
          for (const name of ALL_STORES) await tx.objectStore(name).clear();
        }
        // Merge skips ids already here; after a replace nothing is.
        const keysHere = async (name: "restaurants" | "visits" | "backfills" | "photos") =>
          new Set(mode === "merge" ? await tx.objectStore(name).getAllKeys() : []);

        const haveRestaurants = await keysHere("restaurants");
        for (const r of data.restaurants) {
          if (!haveRestaurants.has(r.id)) await tx.objectStore("restaurants").put(r);
        }
        const haveVisits = await keysHere("visits");
        for (const v of data.visits) {
          if (!haveVisits.has(v.id)) await tx.objectStore("visits").put(v);
        }
        const haveBackfills = await keysHere("backfills");
        for (const b of data.backfills) {
          if (!haveBackfills.has(b.countryIso2)) await tx.objectStore("backfills").put(b);
        }
        const havePhotos = await keysHere("photos");
        for (const [id, blob] of photos) {
          if (!havePhotos.has(id)) await tx.objectStore("photos").put(blob, id);
        }
        if (mode === "replace") await tx.objectStore("settings").put(data.settings, SETTINGS_KEY);
      }),

    clearAll: () =>
      inTransaction(db, ALL_STORES, "readwrite", async (tx) => {
        for (const name of ALL_STORES) await tx.objectStore(name).clear();
      }),
  };
}

/**
 * Opens the on-device database. Every way the browser can refuse (no IndexedDB, a private window, a
 * database from a newer build, a blocked open) rejects with `StoreUnavailableError`; the underlying
 * error is kept as its `cause`.
 */
export async function openSoloStore(factory?: IDBFactory, name: string = DB_NAME): Promise<SoloStore> {
  let db: Db;
  try {
    const target = factory ?? globalThis.indexedDB;
    if (!target) throw new Error("This browser has no IndexedDB.");
    db = await openDatabase(target, name);
  } catch (cause) {
    throw new StoreUnavailableError(undefined, { cause });
  }
  return createStore(db);
}
