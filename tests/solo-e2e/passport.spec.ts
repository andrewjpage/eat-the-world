import type { Locator, Page } from "@playwright/test";
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

/** The "Your stamps" strip above the region grid; the grid repeats every stamp, so counts are scoped to it. */
const stripOf = (page: Page) => page.getByRole("region", { name: "Your stamps" });

/** The tile for a country in the region grid below the strip (the strip's own tile comes first in the DOM). */
const gridTile = (page: Page, iso2: string) => page.locator(`a[href="#/country/${iso2}"]`).nth(1);

const labels = (list: Locator) => list.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));

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
  // Nothing to show yet, so no strip.
  await expect(stripOf(page)).toHaveCount(0);
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
  const memories = stripOf(page).getByRole("img", { name: /, before the app$/ });
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
  await expect(stripOf(page).getByRole("img", { name: /, before the app$/ })).toHaveCount(2);
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
  await expect(stripOf(page).getByRole("img", { name: /, before the app$/ })).toHaveCount(1);
  await expect(stripOf(page).getByRole("img", { name: "France, before the app" })).toBeVisible();
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
  await expect(stripOf(page).getByRole("img", { name: /, before the app$/ })).toHaveCount(2);
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

  // The strip lists the visit stamps newest first, then the memories A to Z; Nigeria's backfill is superseded.
  expect(await labels(stripOf(page).getByRole("img"))).toEqual([
    "Ethiopia, stamped",
    "Nigeria, stamped",
    "France, before the app",
    "Spain, before the app",
  ]);
  await expect(stripOf(page).getByRole("link", { name: /See all/ })).toHaveCount(0);

  // With a visit stamp, the country count leads.
  const headlineBox = await page.getByRole("heading", { level: 1 }).boundingBox();
  const anywhereBox = await page.getByText("stamps anywhere").boundingBox();
  expect(headlineBox!.y).toBeLessThan(anywhereBox!.y);

  // The Stamped filter keeps the four stamps and drops the rest; the grid is then the list, so the strip goes.
  await page.getByRole("link", { name: "Stamped", exact: true }).click();
  await expect(page).toHaveURL(/#\/\?show=stamped$/);
  await expect(page.getByRole("img", { name: /stamped|before the app/ })).toHaveCount(4);
  await expect(stripOf(page)).toHaveCount(0);
});

test("memories in a quiet region are on the first screen, not far down the grid", async ({ page }) => {
  await page.goto("./");
  await injectData(page, { backfills: [backfill("ES"), backfill("FR")] });
  await page.reload();

  for (const name of ["Spain, before the app", "France, before the app"]) {
    await expect(stripOf(page).getByRole("img", { name })).toBeInViewport({ ratio: 1 });
  }
  // The premise: the region grid alone buries them below regions with more London listings.
  await expect(gridTile(page, "ES")).not.toBeInViewport();
  await expect(gridTile(page, "FR")).not.toBeInViewport();
});

test("a lone visit stamp in a region with few listings is on the first screen", async ({ page }) => {
  await page.goto("./");
  await injectData(page, {
    restaurants: [restaurant("r-is", "Matur og drykkur", "IS")],
    visits: [visit("v-is", "r-is", "2026-10-11")],
  });
  await page.reload();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("1 / 249 countries");
  await expect(stripOf(page).getByRole("img", { name: "Iceland, stamped" })).toBeInViewport({ ratio: 1 });
  await expect(gridTile(page, "IS")).not.toBeInViewport();
  // The strip's tile opens the country, like the grid's.
  await expect(stripOf(page).getByRole("link", { name: "Iceland, stamped" })).toHaveAttribute(
    "href",
    "#/country/IS",
  );
});

test("with more than twelve stamps the strip shows twelve and See all opens the Stamped filter", async ({ page }) => {
  await page.goto("./");
  const visited = [
    ["NG", "10-01"],
    ["ET", "10-02"],
    ["MM", "10-03"],
    ["PE", "10-04"],
    ["GH", "10-05"],
  ];
  await injectData(page, {
    restaurants: visited.map(([iso2]) => restaurant(`r-${iso2}`, `Place in ${iso2}`, iso2)),
    visits: visited.map(([iso2, day]) => visit(`v-${iso2}`, `r-${iso2}`, `2026-${day}`)),
    backfills: ["ES", "FR", "IT", "TR", "CN", "JP", "TH", "MX", "GR", "LB"].map(backfill),
  });
  await page.reload();

  const strip = stripOf(page);
  await expect(page.getByText("stamps anywhere")).toContainText("15");
  await expect(strip.getByRole("img")).toHaveCount(12);
  // The five visit stamps, newest first, then the first seven memories A to Z.
  expect(await labels(strip.getByRole("img"))).toEqual([
    "Ghana, stamped",
    "Peru, stamped",
    "Myanmar, stamped",
    "Ethiopia, stamped",
    "Nigeria, stamped",
    "China, before the app",
    "France, before the app",
    "Greece, before the app",
    "Italy, before the app",
    "Japan, before the app",
    "Lebanon, before the app",
    "Mexico, before the app",
  ]);
  // Twelve small stamps still fit the phone: no sideways scroll, and the last row is on the first screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await expect(strip.getByRole("img", { name: "Mexico, before the app" })).toBeInViewport({ ratio: 1 });

  await strip.getByRole("link", { name: "See all 15" }).click();
  await expect(page).toHaveURL(/#\/\?show=stamped$/);
  await expect(page.getByRole("link", { name: "Stamped", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(stripOf(page)).toHaveCount(0);
  await expect(page.getByRole("img", { name: /stamped|before the app/ })).toHaveCount(15);
});
