import type { Page } from "@playwright/test";
import { DB_NAME } from "../../solo/src/db/schema";
import type { SoloVisit } from "../../solo/src/domain/types";
import { expect, test } from "./fixtures";

// The installed app and a Chrome tab are two windows on one IndexedDB, and neither hears about the other's
// writes. A window re-reads storage whenever it regains focus, and a save re-reads it first.

const AKOKO = "seed:akoko-w1t-3lp";
const ENISH = "seed:enish-oxford-street-w1t-3ld";
const ZERET = "seed:zeret-kitchen-se5-0ed";

const headline = (page: Page) => page.getByRole("heading", { level: 1 });
const stamps = (page: Page) => page.getByRole("region", { name: "Your stamps" });

/** Logs a visit to a London suggestion through the screens, as a thumb would, and returns to the passport. */
async function logVisit(page: Page, seedId: string, stampHeading: string) {
  await page.goto(`./#/check-in?restaurant=${seedId}`);
  await page.getByRole("button", { name: "Save visit" }).click();
  await expect(page.getByRole("heading", { name: stampHeading })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/#\/$/);
}

/** The visits in the shared database, read straight from IndexedDB. */
function savedVisits(page: Page): Promise<SoloVisit[]> {
  return page.evaluate(
    (dbName) =>
      new Promise<SoloVisit[]>((resolve, reject) => {
        const opening = indexedDB.open(dbName);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const request = db.transaction("visits").objectStore("visits").getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result as SoloVisit[]);
          };
        };
      }),
    DB_NAME,
  );
}

/** What a window does when it is brought back to the front. */
const regainFocus = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

test("a visit logged in one window shows in the other when it regains focus", async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto("./");
  await b.goto("./");
  await expect(headline(b)).toHaveText("0 / 249 countries");

  await logVisit(a, AKOKO, "Nigeria, stamped!");
  await expect(headline(a)).toHaveText("1 / 249 countries");

  // The other window does not change by itself, then catches up the moment it is brought back.
  await expect(headline(b)).toHaveText("0 / 249 countries");
  await regainFocus(b);
  await expect(headline(b)).toHaveText("1 / 249 countries");
  await expect(stamps(b).getByRole("img", { name: /^Nigeria, stamped/ })).toBeVisible();
  await expect(b.getByRole("heading", { name: "Your passport is blank" })).toHaveCount(0);
});

test("a window that has not caught up saves on top of the other's visit, not over it", async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto("./");
  await b.goto("./");

  await logVisit(a, AKOKO, "Nigeria, stamped!");

  // B still believes the passport is blank. It saves a second Nigerian meal anyway, without catching up.
  await expect(headline(b)).toHaveText("0 / 249 countries");
  await b.goto(`./#/check-in?restaurant=${ENISH}`);
  await b.getByRole("button", { name: "Save visit" }).click();
  // B read the device just before saving, so it knows Nigeria was already stamped.
  await expect(b.getByRole("heading", { name: "More Nigeria" })).toBeVisible();
  await expect(b.getByText("The stamp was already yours.")).toBeVisible();
  await b.getByRole("button", { name: "Done" }).click();

  // And a third meal from a different country, in A, which has not seen B's visit yet.
  await logVisit(a, ZERET, "Ethiopia, stamped!");
  await expect(headline(a)).toHaveText("2 / 249 countries");

  // Both visits to Nigeria and the Ethiopian one are on the device; none was lost.
  const visits = await savedVisits(a);
  expect(visits).toHaveLength(3);
  await expect(headline(b)).toHaveText("1 / 249 countries");
  await regainFocus(b);
  await expect(headline(b)).toHaveText("2 / 249 countries");
  await expect(stamps(b).getByRole("img", { name: /^Ethiopia, stamped/ })).toBeVisible();
  await expect(stamps(b).getByRole("img", { name: /^Nigeria, stamped/ })).toBeVisible();
});
