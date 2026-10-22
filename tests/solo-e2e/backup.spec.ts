import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { DB_NAME } from "../../solo/src/db/schema";
import type { Backfill, SoloRestaurant, SoloVisit } from "../../solo/src/domain/types";
import { expect, injectData, test } from "./fixtures";

/** A 1x1 PNG: a real image, so the photo that travels through the backup is one the page can decode. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==",
  "base64",
);

const restaurant = (id: string, name: string, countryIso2: string): SoloRestaurant => ({
  id,
  seedId: null,
  name,
  countryIso2,
  address: null,
  lat: null,
  lon: null,
  createdAt: "2026-10-01T12:00:00.000Z",
});

const visit = (id: string, restaurantId: string, visitedOn: string, over: Partial<SoloVisit> = {}): SoloVisit => ({
  id,
  restaurantId,
  visitedOn,
  dishId: null,
  dishOther: null,
  rating: 4,
  note: null,
  photoId: null,
  createdAt: `${visitedOn}T19:00:00.000Z`,
  ...over,
});

const backfill = (countryIso2: string): Backfill => ({ countryIso2, createdAt: "2026-10-02T09:00:00.000Z" });

/** Two stamps from visits (Nigeria, France), two from before the app (Italy, Spain), and one photo. */
const PASSPORT = {
  restaurants: [restaurant("r-akoko", "Akoko", "NG"), restaurant("r-bistro", "Bistro", "FR")],
  visits: [
    visit("v1", "r-akoko", "2026-10-01", { photoId: "p1", note: "Worth the queue" }),
    visit("v2", "r-bistro", "2026-10-05", { dishOther: "Cassoulet", rating: null }),
    visit("v3", "r-akoko", "2026-10-08"),
  ],
  backfills: [backfill("IT"), backfill("ES")],
};

const headline = (page: Page) => page.getByRole("heading", { level: 1 });
const stamps = (page: Page) => page.getByRole("region", { name: "Your stamps" });
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const lastBackup = (page: Page) => page.getByTestId("last-backup");
const reminder = (page: Page) => page.getByRole("note", { name: "Backup reminder" });

type StoreName = "restaurants" | "visits" | "backfills" | "photos";

/** Opens the app once so it creates its database, writes the data, then opens `hash` on a fresh load. */
async function open(page: Page, hash: string, data: Parameters<typeof injectData>[1] = {}, photo = false) {
  await page.goto("./");
  await injectData(page, data);
  if (photo) await putPhoto(page, "p1");
  await page.goto(`./#${hash}`);
  await page.reload();
}

async function putPhoto(page: Page, id: string) {
  await page.evaluate(
    ({ dbName, id, base64 }) =>
      new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open(dbName);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const tx = db.transaction("photos", "readwrite");
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          tx.objectStore("photos").put(new Blob([bytes], { type: "image/png" }), id);
          tx.oncomplete = () => (db.close(), resolve());
          tx.onerror = () => reject(tx.error);
        };
      }),
    { dbName: DB_NAME, id, base64: PNG.toString("base64") },
  );
}

/** Every row in one store, read straight from IndexedDB. Photos come back as their id, type and bytes. */
async function rows(page: Page, store: StoreName): Promise<unknown[]> {
  return page.evaluate(
    ({ dbName, store }) =>
      new Promise<unknown[]>((resolve, reject) => {
        const opening = indexedDB.open(dbName);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const objects = db.transaction(store).objectStore(store);
          const keys = objects.getAllKeys();
          const values = objects.getAll();
          values.onerror = () => reject(values.error);
          values.onsuccess = async () => {
            const out = [];
            for (const [i, value] of (values.result as unknown[]).entries()) {
              if (value instanceof Blob) {
                out.push({ id: keys.result[i], type: value.type, bytes: [...new Uint8Array(await value.arrayBuffer())] });
              } else out.push(value);
            }
            db.close();
            resolve(out);
          };
        };
      }),
    { dbName: DB_NAME, store },
  );
}

/** Playwright's Chromium on Linux has no share sheet, a phone does: this makes the download path deliberate. */
async function noShareSheet(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: () => false, configurable: true });
  });
}

/** What a person reads off the passport: the headline and how many stamps are in the strip. */
async function passportFacts(page: Page) {
  await page.goto("./#/");
  await expect(headline(page)).toBeVisible();
  const stampCount = await stamps(page).getByRole("img", { name: /, (stamped|before the app)/ }).count();
  return { headline: await headline(page).textContent(), stampCount };
}

async function exportBackup(page: Page, testInfo: { outputPath: (name: string) => string }) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export backup" }).click(),
  ]);
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  return { name: download.suggestedFilename(), path };
}

test.describe("export and import", () => {
  test("a backup downloaded from one browser restores the same passport in a fresh one", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    await noShareSheet(page);
    await open(page, "/", PASSPORT, true);
    const before = await passportFacts(page);
    expect(before).toEqual({ headline: "2 / 249 countries", stampCount: 4 });

    await page.goto("./#/settings");
    await expect(lastBackup(page)).toHaveText("No backup yet.");
    const saved = await exportBackup(page, testInfo);

    expect(saved.name).toMatch(/^eat-the-world-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(readFileSync(saved.path, "utf8"));
    expect(file).toMatchObject({ app: "eat-the-world-solo", schemaVersion: 1 });
    expect(file.restaurants).toHaveLength(2);
    expect(file.visits).toHaveLength(3);
    expect(file.backfills).toHaveLength(2);
    expect(Object.keys(file.photos)).toEqual(["p1"]);
    expect(file.photos.p1).toEqual({ type: "image/png", base64: PNG.toString("base64") });
    await expect(toast(page, "Backup saved to your downloads.")).toBeVisible();
    await expect(lastBackup(page)).toHaveText(/^Last backup: .*\d{4}\.$/);

    // A browser with nothing in it, as a new phone would be.
    const fresh = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
    try {
      const phone = await fresh.newPage();
      await phone.goto("./#/settings");
      await expect(lastBackup(phone)).toHaveText("No backup yet.");
      await phone.getByLabel("Backup file").setInputFiles(saved.path);

      const sheet = phone.getByRole("dialog", { name: "Import this backup" });
      await expect(sheet).toContainText("3 new visits");
      await expect(sheet).toContainText("2 new restaurants");
      await expect(sheet).toContainText("2 new countries from before the app");
      await expect(sheet).toContainText("0 already on this phone");
      await expect(sheet).toContainText("The file includes 1 photo.");

      // Replace asks once more before it erases anything.
      await sheet.getByRole("button", { name: "Replace everything" }).click();
      const confirm = phone.getByRole("dialog", { name: "Replace everything?" });
      await expect(confirm).toContainText("It can't be undone");
      await confirm.getByRole("button", { name: "Back" }).click();
      await expect(phone.getByRole("dialog", { name: "Import this backup" })).toBeVisible();
      expect(await rows(phone, "visits")).toHaveLength(0);

      await sheet.getByRole("button", { name: "Replace everything" }).click();
      await phone.getByRole("button", { name: "Yes, replace everything" }).click();
      await expect(toast(phone, "Backup restored.")).toBeVisible();
      await expect(phone.getByRole("dialog")).toHaveCount(0);

      expect(await passportFacts(phone)).toEqual(before);
      expect(await rows(phone, "visits")).toHaveLength(3);
      expect(await rows(phone, "photos")).toEqual([{ id: "p1", type: "image/png", bytes: [...PNG] }]);
      expect(await rows(phone, "restaurants")).toEqual(await rows(page, "restaurants"));
      expect(await rows(phone, "backfills")).toEqual(await rows(page, "backfills"));

      // The same file again, merged: nothing in it is new.
      await phone.goto("./#/settings");
      await phone.getByLabel("Backup file").setInputFiles(saved.path);
      const again = phone.getByRole("dialog", { name: "Import this backup" });
      await expect(again).toContainText("0 new visits");
      await expect(again).toContainText("0 new restaurants");
      await expect(again).toContainText("0 new countries from before the app");
      await expect(again).toContainText("7 already on this phone");
      await expect(again).toContainText("Nothing new: everything in this file is already here.");
      await expect(again.getByRole("button", { name: "Merge" })).toBeDisabled();
    } finally {
      await fresh.close();
    }
  });

  test("merging adds only what is new and leaves what is here alone", async ({ page }, testInfo) => {
    await noShareSheet(page);
    await open(page, "/settings", PASSPORT);
    const saved = await exportBackup(page, testInfo);

    // Now this phone has its own idea of one visit, and has lost the rest.
    await injectData(page, {
      restaurants: [restaurant("r-akoko", "Akoko (my name)", "NG")],
      visits: [visit("v1", "r-akoko", "2026-10-01", { rating: 1 })],
      backfills: [],
    });
    await page.reload();
    await page.getByLabel("Backup file").setInputFiles(saved.path);

    const sheet = page.getByRole("dialog", { name: "Import this backup" });
    await expect(sheet).toContainText("2 new visits");
    await expect(sheet).toContainText("1 new restaurant");
    await expect(sheet).toContainText("2 new countries from before the app");
    await expect(sheet).toContainText("2 already on this phone");
    await sheet.getByRole("button", { name: "Merge" }).click();
    await expect(toast(page, "Added what was new.")).toBeVisible();

    const visits = (await rows(page, "visits")) as SoloVisit[];
    expect(visits.map((v) => [v.id, v.rating]).sort()).toEqual([["v1", 1], ["v2", null], ["v3", 4]]);
    expect(((await rows(page, "restaurants")) as SoloRestaurant[]).map((r) => r.name).sort()).toEqual([
      "Akoko (my name)",
      "Bistro",
    ]);
    expect(await rows(page, "backfills")).toHaveLength(2);
  });

  test("the same backup imported twice adds nothing the second time", async ({ page }, testInfo) => {
    await noShareSheet(page);
    await open(page, "/settings", PASSPORT);
    const saved = await exportBackup(page, testInfo);

    // A phone with nothing on it takes the whole file.
    await injectData(page, { restaurants: [], visits: [], backfills: [] });
    await page.reload();
    const sheet = page.getByRole("dialog", { name: "Import this backup" });
    await page.getByLabel("Backup file").setInputFiles(saved.path);
    await expect(sheet).toContainText("3 new visits");
    await sheet.getByRole("button", { name: "Merge" }).click();
    await expect(toast(page, "Added what was new.")).toBeVisible();
    expect(await rows(page, "visits")).toHaveLength(3);

    // The same file again has nothing to offer, and the phone is exactly as it was.
    const before = JSON.stringify([await rows(page, "restaurants"), await rows(page, "visits"), await rows(page, "backfills")]);
    await page.getByLabel("Backup file").setInputFiles(saved.path);
    await expect(sheet).toContainText("0 new visits");
    // Everything in the file is here already: 3 visits, 2 restaurants and 2 countries from before the app.
    await expect(sheet).toContainText("7 already on this phone");
    await expect(sheet).toContainText("Nothing new: everything in this file is already here.");
    await expect(sheet.getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(JSON.stringify([await rows(page, "restaurants"), await rows(page, "visits"), await rows(page, "backfills")])).toBe(before);
  });

  test("a file that is not a usable backup is refused, with the passport untouched", async ({ page }) => {
    await open(page, "/settings", PASSPORT);
    const spoiled = (over: Record<string, unknown>) =>
      JSON.stringify({ app: "eat-the-world-solo", schemaVersion: 1, exportedAt: "2026-10-20T10:00:00.000Z", ...PASSPORT, ...over });
    const pick = (name: string, text: string) =>
      page.getByLabel("Backup file").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });
    const problem = page.getByRole("alert");

    await pick("notes.txt", "hello");
    await expect(problem).toContainText("That file isn't a backup");
    await pick("other.json", JSON.stringify({ app: "some-other-app", schemaVersion: 1 }));
    await expect(problem).toContainText("isn't an Eat the World backup");
    await pick("future.json", spoiled({ schemaVersion: 2 }));
    await expect(problem).toContainText("newer version of the app");
    await pick("nine.json", spoiled({ visits: [visit("v1", "r-akoko", "2026-10-01", { rating: 9 as never })] }));
    await expect(problem).toContainText("rating outside 1 to 5");

    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await rows(page, "visits")).toHaveLength(3);
    expect(await rows(page, "restaurants")).toHaveLength(2);
    expect(await rows(page, "backfills")).toHaveLength(2);
    expect((await passportFacts(page)).headline).toBe("2 / 249 countries");

    // A good file clears the message.
    await page.goto("./#/settings");
    await pick("good.json", spoiled({}));
    await expect(page.getByRole("dialog", { name: "Import this backup" })).toBeVisible();
    await expect(problem).toHaveCount(0);
  });

  test("hands the file to the share sheet where there is one, and a closed sheet is not a backup", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared: { name: string; type: string }[]; __abort: boolean };
      w.__shared = [];
      w.__abort = true;
      Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: ShareData) => {
          if (w.__abort) throw new DOMException("closed", "AbortError");
          w.__shared.push({ name: data.files![0].name, type: data.files![0].type });
        },
      });
    });
    await open(page, "/settings", PASSPORT);

    await page.getByRole("button", { name: "Export backup" }).click();
    await expect(page.getByRole("button", { name: "Export backup" })).toBeEnabled();
    await expect(toast(page, /Backup/)).toHaveCount(0);
    await expect(lastBackup(page)).toHaveText("No backup yet.");

    await page.evaluate(() => ((window as unknown as { __abort: boolean }).__abort = false));
    await page.getByRole("button", { name: "Export backup" }).click();
    await expect(toast(page, "Backup shared.")).toBeVisible();
    await expect(lastBackup(page)).toHaveText(/^Last backup: /);
    const shared = await page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared);
    expect(shared).toEqual([{ name: expect.stringMatching(/^eat-the-world-\d{4}-\d{2}-\d{2}\.json$/), type: "application/json" }]);
  });

  test("leaves the photos out when asked", async ({ page }, testInfo) => {
    await noShareSheet(page);
    await open(page, "/settings", PASSPORT, true);

    const photos = page.getByRole("checkbox", { name: /Include photos/ });
    await expect(photos).toBeChecked();
    await expect(page.getByText("Photos make the file much larger")).toBeVisible();
    await photos.uncheck();
    const saved = await exportBackup(page, testInfo);

    const file = JSON.parse(readFileSync(saved.path, "utf8"));
    expect(file).not.toHaveProperty("photos");
    expect(file.visits).toHaveLength(3);
  });

  test("replacing with a backup made without photos keeps this phone's photos for the file's visits", async ({
    page,
  }, testInfo) => {
    await noShareSheet(page);
    await open(page, "/settings", PASSPORT, true);
    await putPhoto(page, "loose");

    await page.getByRole("checkbox", { name: /Include photos/ }).uncheck();
    const saved = await exportBackup(page, testInfo);
    expect(JSON.parse(readFileSync(saved.path, "utf8"))).not.toHaveProperty("photos");

    await page.getByLabel("Backup file").setInputFiles(saved.path);
    await page.getByRole("dialog", { name: "Import this backup" }).getByRole("button", { name: "Replace everything" }).click();
    const confirm = page.getByRole("dialog", { name: "Replace everything?" });
    await expect(confirm).toContainText(
      "Photos on this phone that the file's visits use are kept. Any other photos on this phone are removed.",
    );
    await confirm.getByRole("button", { name: "Yes, replace everything" }).click();
    await expect(toast(page, "Backup restored.")).toBeVisible();

    // p1 belongs to a visit in the file, so it stays; "loose" belongs to none, so Replace removes it.
    expect(await rows(page, "photos")).toEqual([{ id: "p1", type: "image/png", bytes: [...PNG] }]);
    expect(await rows(page, "visits")).toHaveLength(3);
  });

  test("offers no photo choice when there are no photos", async ({ page }) => {
    await open(page, "/settings", PASSPORT);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });
});

test.describe("storage", () => {
  test("shows whether the browser protects the data, asks it to, and shows the space used", async ({ page }) => {
    await page.addInitScript(() => {
      let persisted = false;
      Object.defineProperty(navigator.storage, "persisted", { configurable: true, value: async () => persisted });
      Object.defineProperty(navigator.storage, "persist", { configurable: true, value: async () => (persisted = true) });
      Object.defineProperty(navigator.storage, "estimate", {
        configurable: true,
        value: async () => ({ usage: 5 * 1024 * 1024, quota: 10 * 1024 ** 3 }),
      });
    });
    await open(page, "/settings", PASSPORT);

    const storage = page.getByRole("region", { name: "Storage" });
    await expect(storage).toContainText("Not protected yet.");
    await expect(storage).toContainText("Using 5 MB of the 10 GB this browser allows.");
    await storage.getByRole("button", { name: "Ask the browser to protect it" }).click();
    await expect(storage).toContainText("Protected. The browser won't clear your passport");
    await expect(storage.getByRole("button")).toHaveCount(0);
  });

  test("says so when the browser has no storage manager", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "storage", { configurable: true, value: undefined });
    });
    await open(page, "/settings", PASSPORT);

    const storage = page.getByRole("region", { name: "Storage" });
    await expect(storage).toContainText("This browser doesn't say whether your passport is protected.");
    await expect(storage).not.toContainText("Using");
  });
});

test.describe("your data", () => {
  test("links to the countries from before the app, which are not linked from anywhere else", async ({ page }) => {
    await open(page, "/settings", PASSPORT);

    const link = page.getByRole("link", { name: /Countries from before the app/ });
    await expect(link).toHaveAttribute("href", "#/backfill");
    await expect(link).toContainText("2 countries added");
    await link.click();
    await expect(page).toHaveURL(/#\/backfill$/);
    await expect(page.getByRole("heading", { name: "Countries before the app" })).toBeVisible();
  });

  test("deletes everything only after DELETE is typed", async ({ page }) => {
    await open(page, "/settings", PASSPORT, true);
    await page.getByRole("region", { name: "Your data" }).getByRole("button", { name: "Delete everything" }).click();

    const sheet = page.getByRole("dialog", { name: "Delete everything?" });
    const confirm = sheet.getByRole("button", { name: "Delete everything" });
    await expect(confirm).toBeDisabled();
    await sheet.getByLabel("Type DELETE to confirm").fill("delete");
    await expect(confirm).toBeDisabled();

    // Cancelling keeps everything.
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await rows(page, "visits")).toHaveLength(3);

    await page.getByRole("region", { name: "Your data" }).getByRole("button", { name: "Delete everything" }).click();
    await sheet.getByLabel("Type DELETE to confirm").fill("DELETE");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(toast(page, "Everything was deleted.")).toBeVisible();
    for (const store of ["restaurants", "visits", "backfills", "photos"] as const) {
      expect(await rows(page, store), store).toEqual([]);
    }
    await page.goto("./#/");
    await expect(page.getByRole("heading", { name: "Your passport is blank" })).toBeVisible();
    await expect(headline(page)).toHaveText("0 / 249 countries");
  });
});

test.describe("about", () => {
  test("credits the sources, with this year's postcodes.io lines, and calls out to no other site", async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const elsewhere: string[] = [];
    page.on("request", (request) => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith(origin)) elsewhere.push(request.url());
    });
    await open(page, "/settings");

    const about = page.getByRole("region", { name: "About" });
    await expect(about.getByRole("link", { name: "OpenStreetMap contributors" })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/copyright",
    );
    await expect(about).toContainText("flag-icons");
    await expect(about).toContainText("Natural Earth");
    await expect(about).toContainText("world-atlas");
    const year = new Date().getFullYear();
    for (const holder of ["Ordnance Survey data © Crown", "Royal Mail data © Royal Mail", "National Statistics data © Crown"]) {
      await expect(about.getByRole("listitem").filter({ hasText: `Contains ${holder} copyright and database right ${year}` })).toHaveCount(1);
    }
    expect(elsewhere).toEqual([]);
  });
});

test.describe("the backup reminder", () => {
  /** Ten visits made just now and never backed up. */
  function recentVisits(count: number) {
    const now = Date.now();
    return Array.from({ length: count }, (_, i) =>
      visit(`n${i}`, "r-akoko", "2026-10-01", { createdAt: new Date(now - i * 60_000).toISOString() }),
    );
  }

  test("stays away until there is enough to lose", async ({ page }) => {
    await open(page, "/", { restaurants: PASSPORT.restaurants, visits: recentVisits(9), backfills: [] });
    await expect(headline(page)).toBeVisible();
    await expect(reminder(page)).toHaveCount(0);
  });

  test("appears at ten new visits, takes one tap to Settings, and goes once a backup is made", async ({ page }, testInfo) => {
    await noShareSheet(page);
    await open(page, "/", { restaurants: PASSPORT.restaurants, visits: recentVisits(10), backfills: [] });

    await expect(reminder(page)).toBeVisible();
    const backUp = reminder(page).getByRole("link", { name: "Back up" });
    expect((await backUp.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await backUp.click();
    await expect(page).toHaveURL(/#\/settings$/);
    await exportBackup(page, testInfo);

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Passport" }).click();
    await expect(headline(page)).toBeVisible();
    await expect(reminder(page)).toHaveCount(0);
  });

  test("is dismissed for the session, and comes back in the next one", async ({ page }) => {
    await open(page, "/", { restaurants: PASSPORT.restaurants, visits: recentVisits(10), backfills: [] });
    await reminder(page).getByRole("button", { name: "Dismiss the backup reminder" }).click();
    await expect(reminder(page)).toHaveCount(0);

    // Moving about the app does not bring it back.
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("link", { name: "Settings" }).click();
    await nav.getByRole("link", { name: "Passport" }).click();
    await expect(headline(page)).toBeVisible();
    await expect(reminder(page)).toHaveCount(0);

    await page.reload();
    await expect(reminder(page)).toBeVisible();
  });
});
