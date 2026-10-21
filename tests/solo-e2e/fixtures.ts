import { expect, test as base, type Page } from "@playwright/test";
import { DB_NAME, DB_VERSION, SETTINGS_KEY, STORE_NAMES, type SoloData } from "../../solo/src/db/schema";

/**
 * `test` for the solo specs. Every page in the test, including ones opened later in the same
 * context, must finish without an uncaught error or a console error, unless the spec lists it in
 * `ignoreErrors`. A screen that blanks itself would otherwise only fail on the assertion after it.
 */
export const test = base.extend<{ ignoreErrors: RegExp | null; noPageErrors: void }>({
  ignoreErrors: [null, { option: true }],
  noPageErrors: [
    async ({ context, ignoreErrors }, use) => {
      const errors: string[] = [];
      const watch = (page: Page) => {
        page.on("pageerror", (error) => errors.push(`${error.name}: ${error.message}`));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
      };
      context.pages().forEach(watch);
      context.on("page", watch);
      await use();
      expect(
        errors.filter((text) => !ignoreErrors?.test(text)),
        "uncaught errors and console errors",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The stores that hold `SoloData`; photos are blobs and are not injected. */
const DATA_STORES = STORE_NAMES.filter((name): name is keyof SoloData => name !== "photos");

/**
 * Writes straight into the app's IndexedDB, replacing the contents of every store named in `data`
 * and leaving the others alone. The page must already have loaded the app once, because the app
 * creates the database; call `page.reload()` afterwards to show the new data.
 */
export async function injectData(page: Page, data: Partial<SoloData>): Promise<void> {
  const stores = DATA_STORES.filter((name) => data[name] !== undefined);
  if (stores.length === 0) return;

  await page.evaluate(
    async ({ dbName, dbVersion, settingsKey, stores, rows }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion);
        // The app creates the stores; making an empty database here would leave it without any.
        request.onupgradeneeded = () => {
          request.transaction?.abort();
          reject(new Error("injectData: load the app once first, so that it creates the database."));
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(stores, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);

        for (const name of stores) {
          const store = tx.objectStore(name);
          store.clear();
          if (name === "settings") store.put(rows.settings, settingsKey);
          else for (const row of rows[name] as unknown[]) store.put(row);
        }
      });
      db.close();
    },
    { dbName: DB_NAME, dbVersion: DB_VERSION, settingsKey: SETTINGS_KEY, stores, rows: data },
  );
}
