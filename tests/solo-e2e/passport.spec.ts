import type { Backfill, SoloRestaurant, SoloVisit } from "../../solo/src/domain/types";
import { expect, injectData, test } from "./fixtures";

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

const visit = (id: string, restaurantId: string, visitedOn: string): SoloVisit => ({
  id,
  restaurantId,
  visitedOn,
  dishId: null,
  dishOther: null,
  rating: null,
  note: null,
  photoId: null,
  createdAt: `${visitedOn}T19:00:00.000Z`,
});

const backfill = (countryIso2: string): Backfill => ({ countryIso2, createdAt: "2026-10-02T09:00:00.000Z" });

test("a fresh passport is blank and offers both ways to start", async ({ page }) => {
  await page.goto("./");

  await expect(page.getByRole("heading", { name: "Your passport is blank" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log your first meal" })).toHaveAttribute("href", "#/check-in");
  await expect(page.getByRole("link", { name: /countries you.ve already eaten/ })).toHaveAttribute(
    "href",
    "#/backfill",
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("0 / 249 countries");
  await expect(page.getByRole("progressbar", { name: "0 / 39 London suggestions" })).toBeVisible();
});

test("backfilling two countries leaves two sepia stamps, and a reload keeps them", async ({ page }) => {
  await page.goto("./#/backfill");

  const popular = page.getByRole("region", { name: "Popular" });
  await popular.getByRole("button", { name: "Spain" }).click();
  await popular.getByRole("button", { name: "France" }).click();
  await expect(popular.getByRole("button", { name: "Spain, before the app" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Save" }).click();

  // Saving lands on the passport.
  await expect(page).toHaveURL(/#\/$/);
  const memories = page.getByRole("img", { name: /, before the app$/ });
  await expect(memories).toHaveCount(2);
  for (const stamp of await memories.all()) {
    await expect(stamp.locator("> div")).toHaveCSS("filter", /sepia\(/);
  }

  // No visit stamp yet, so the "anywhere" line leads and the country count stays honest at 0.
  const anywhere = page.getByText("stamps anywhere");
  await expect(anywhere).toContainText("2");
  const headline = page.getByRole("heading", { level: 1 });
  await expect(headline).toHaveText("0 / 249 countries");
  const [anywhereBox, headlineBox] = [await anywhere.boundingBox(), await headline.boundingBox()];
  expect(anywhereBox!.y).toBeLessThan(headlineBox!.y);
  await expect(page.getByRole("heading", { name: "Your passport is blank" })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("img", { name: /, before the app$/ })).toHaveCount(2);
  await expect(page.getByText("stamps anywhere")).toContainText("2");
});

test("a stamp inking in at the screen edge does not widen the page", async ({ page }) => {
  await page.goto("./#/backfill");
  await page.getByRole("region", { name: "Popular" }).getByRole("button", { name: "Italy" }).click();

  // Italy is in the right-hand column; its stamp-in animation scales it past the edge.
  const widest = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const start = performance.now();
        let max = 0;
        const sample = () => {
          max = Math.max(max, document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (performance.now() - start < 700) requestAnimationFrame(sample);
          else resolve(max);
        };
        sample();
      }),
  );
  expect(widest).toBe(0);
});

test("saving asks the browser to keep the data, once something is saved", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: number[] = [];
    Object.assign(window, { persistCalls: calls });
    navigator.storage.persist = async () => {
      calls.push(Date.now());
      return true;
    };
  });
  await page.goto("./#/backfill");
  const persistCalls = () => page.evaluate(() => (window as unknown as { persistCalls: number[] }).persistCalls.length);

  expect(await persistCalls()).toBe(0);
  await page.getByRole("region", { name: "Popular" }).getByRole("button", { name: "Spain" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect.poll(persistCalls).toBe(1);
});

test("un-picking a saved country and saving takes its stamp away", async ({ page }) => {
  await page.goto("./#/backfill");
  await injectData(page, { backfills: [backfill("ES"), backfill("FR")] });
  await page.reload();

  const popular = page.getByRole("region", { name: "Popular" });
  await expect(popular.getByRole("button", { name: "Spain, before the app" })).toHaveAttribute("aria-pressed", "true");
  await popular.getByRole("button", { name: "Spain" }).click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("img", { name: /, before the app$/ })).toHaveCount(1);
  await expect(page.getByRole("img", { name: "France, before the app" })).toBeVisible();
});

test("saving the picker does not undo a country added meanwhile in another window", async ({ page, context }) => {
  await page.goto("./");
  await page.goto("./#/backfill");
  await page.getByRole("region", { name: "Popular" }).getByRole("button", { name: "France" }).click();

  const other = await context.newPage();
  await other.goto("./");
  await injectData(other, { backfills: [backfill("ES")] });
  await other.close();

  // The first window sees the other one's write when it regains focus.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const popular = page.getByRole("region", { name: "Popular" });
  await expect(popular.getByRole("button", { name: "Spain, before the app" })).toBeVisible();

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("img", { name: /, before the app$/ })).toHaveCount(2);
});

test("backfill search narrows the list and finds a country by its short name", async ({ page }) => {
  await page.goto("./#/backfill");

  await page.getByRole("searchbox", { name: "Search countries" }).fill("turk");
  await expect(page.getByRole("button", { name: "Turkey" })).toBeVisible();
  await expect(page.getByRole("button", { name: "France" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Popular" })).toHaveCount(0);

  await page.getByRole("searchbox", { name: "Search countries" }).fill("zzzz");
  await expect(page.getByText("No country matches")).toBeVisible();
});

test("a populated passport counts visit stamps, London suggestions and stamps anywhere", async ({ page }) => {
  await page.goto("./");
  await injectData(page, {
    restaurants: [
      restaurant("r-ng", "Enish", "NG"),
      restaurant("r-et", "Zeret Kitchen", "ET"),
      restaurant("r-ng-2", "Another Nigerian place", "NG"),
    ],
    // Two visits in Nigeria are one stamp, dated by the earlier visit.
    visits: [
      visit("v-ng-2", "r-ng-2", "2026-10-09"),
      visit("v-ng", "r-ng", "2026-10-03"),
      visit("v-et", "r-et", "2026-10-05"),
    ],
    // Spain and France were eaten before the app; Nigeria also has a backfill, which the visit replaces.
    backfills: [backfill("ES"), backfill("FR"), backfill("NG")],
  });
  await page.reload();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2 / 249 countries");
  await expect(page.getByRole("progressbar", { name: "2 / 39 London suggestions" })).toBeVisible();
  // 2 visit stamps + 2 backfilled-only countries: Nigeria is not counted twice.
  await expect(page.getByText("stamps anywhere")).toContainText("4");
  await expect(page.getByRole("img", { name: "Nigeria, stamped, 03 OCT 2026" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Ethiopia, stamped, 05 OCT 2026" })).toBeVisible();
  await expect(page.getByRole("img", { name: /, before the app$/ })).toHaveCount(2);

  // With a visit stamp, the country count leads.
  const headlineBox = await page.getByRole("heading", { level: 1 }).boundingBox();
  const anywhereBox = await page.getByText("stamps anywhere").boundingBox();
  expect(headlineBox!.y).toBeLessThan(anywhereBox!.y);

  // The Stamped filter keeps the four stamps and drops the rest.
  await page.getByRole("link", { name: "Stamped", exact: true }).click();
  await expect(page).toHaveURL(/#\/\?show=stamped$/);
  await expect(page.getByRole("img", { name: /stamped|before the app/ })).toHaveCount(4);
});
