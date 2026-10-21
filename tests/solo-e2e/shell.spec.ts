import type { Backfill } from "../../solo/src/domain/types";
import { expect, injectData, test } from "./fixtures";

const backfill = (countryIso2: string): Backfill => ({ countryIso2, createdAt: "2026-10-02T09:00:00.000Z" });

test("the bottom bar reaches every tab and lights the one you are on", async ({ page }) => {
  await page.goto("./");
  const nav = page.getByRole("navigation", { name: "Main" });

  for (const [tab, screen] of [
    ["Map", "Map"],
    ["World", "World"],
    ["Settings", "Settings"],
    ["Check in", "Check in"],
  ]) {
    await nav.getByRole("link", { name: tab }).click();
    await expect(page.getByRole("heading", { name: screen })).toBeVisible();
    await expect(nav.getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator("[aria-current]")).toHaveCount(1);
  }

  await nav.getByRole("link", { name: "Passport" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("0 / 249 countries");
  await expect(nav.getByRole("link", { name: "Passport" })).toHaveAttribute("aria-current", "page");
});

test("the parameterised routes open their screens, under the Passport tab", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Main" });

  for (const [hash, screen] of [
    ["#/country/FR", "Country"],
    ["#/restaurant/seed:enish-oxford-street-w1t-3ld", "Restaurant"],
    ["#/visit/abc", "Visit"],
  ]) {
    await page.goto(`./${hash}`);
    await expect(page.getByRole("heading", { name: screen })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Passport" })).toHaveAttribute("aria-current", "page");
  }
});

test("an unknown route says so and leads back to the passport", async ({ page }) => {
  await page.goto("./#/nope");
  await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();

  await page.getByRole("link", { name: "Back to my passport" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("0 / 249 countries");
});

test("a new screen starts at the top of the page", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 1500));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Map" }).click();
  await expect(page.getByRole("heading", { name: "Map" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test.describe("a window that cannot store anything", () => {
  // The app logs why it gave up, so a blocked window or a corrupt row can be diagnosed; expected here.
  test.use({ ignoreErrors: /Eat the World: storage/ });

  test("says so instead of opening the app, and logs the reason", async ({ page }) => {
    const logged: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") logged.push(message.text());
    });
    await page.addInitScript(() => {
      indexedDB.open = () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      };
    });
    await page.goto("./");

    await expect(page.getByRole("heading", { name: "Storage is unavailable in this window" })).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect.poll(() => logged.some((text) => /Eat the World: storage[\s\S]*StoreUnavailableError/.test(text))).toBe(true);
  });
});

test.describe("a screen whose code cannot be fetched", () => {
  // Chrome reports the failed request and React reports the failed import; both are the point here.
  test.use({ ignoreErrors: /Failed to load resource|dynamically imported module|Failed to fetch/ });

  test("shows a friendly message, and Retry opens it once the connection is back", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.route("**/assets/Settings-*.js", (route) => route.abort());
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("link", { name: "Settings" }).click();

    await expect(page.getByRole("heading", { name: "This page didn't open" })).toBeVisible();
    // The page around it is still there.
    await expect(nav).toBeVisible();

    await page.unroute("**/assets/Settings-*.js");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "This page didn't open" })).toHaveCount(0);
  });

  test("moving to another tab leaves the failure behind", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.route("**/assets/Settings-*.js", (route) => route.abort());
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "This page didn't open" })).toBeVisible();

    await nav.getByRole("link", { name: "Map" }).click();
    await expect(page.getByRole("heading", { name: "Map" })).toBeVisible();
  });
});

test.describe("two windows on the same data", () => {
  for (const regained of ["visibilitychange", "focus"] as const) {
    test(`a stamp saved in one shows in the other when it fires ${regained}`, async ({ page, context }) => {
      await page.goto("./");
      await expect(page.getByRole("heading", { name: "Your passport is blank" })).toBeVisible();

      const other = await context.newPage();
      await other.goto("./");
      await injectData(other, { backfills: [backfill("ES")] });
      await other.close();

      // Nothing changes by itself; the window reads storage again when it is brought back.
      await expect(page.getByRole("heading", { name: "Your passport is blank" })).toBeVisible();
      await page.evaluate((type) => {
        (type === "focus" ? window : document).dispatchEvent(new Event(type));
      }, regained);

      await expect(
        page.getByRole("region", { name: "Your stamps" }).getByRole("img", { name: "Spain, before the app" }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "Your passport is blank" })).toHaveCount(0);
    });
  }
});
