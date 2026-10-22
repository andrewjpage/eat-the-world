import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const DISMISSED_KEY = "eat-the-world-solo:install-dismissed-at";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Longer than the dialog's 1.5 second wait, so "it never came" has had its chance to be wrong. */
const WAIT_FOR_NOTHING_MS = 2500;

const headline = (page: Page) => page.getByRole("heading", { level: 1 });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Install Eat the World?" });
const settingsRow = (page: Page) => page.getByRole("button", { name: "Install app" });

/**
 * Hands the page a `beforeinstallprompt` the way Chrome does: cancelable, with `prompt()` and
 * `userChoice`. Playwright's Chromium never fires one itself (the suite blocks service workers, and
 * a phone is what decides installability). Returns whether the app called `preventDefault()`.
 */
async function fireInstallPrompt(page: Page, outcome: "accepted" | "dismissed" = "accepted"): Promise<boolean> {
  return page.evaluate((outcome) => {
    const w = window as unknown as { __installPromptCalls?: number };
    w.__installPromptCalls ??= 0;
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        w.__installPromptCalls = (w.__installPromptCalls ?? 0) + 1;
      },
      userChoice: Promise.resolve({ outcome }),
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, outcome);
}

const promptCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __installPromptCalls?: number }).__installPromptCalls ?? 0);

const storedDismissal = (page: Page) => page.evaluate((key) => localStorage.getItem(key), DISMISSED_KEY);

/** Opens the app on `hash` and waits for the screen, so the event that follows reaches a mounted page. */
async function open(page: Page, hash = "/") {
  await page.goto(`./#${hash}`);
  if (hash === "/") await expect(headline(page)).toBeVisible();
  else if (hash === "/settings") await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

async function reopen(page: Page) {
  await page.reload();
  await expect(headline(page)).toBeVisible();
}

test.describe("with no install on offer", () => {
  test("neither the dialog nor the Settings row ever appears", async ({ page }) => {
    await open(page);
    await page.waitForTimeout(WAIT_FOR_NOTHING_MS);
    await expect(dialog(page)).toHaveCount(0);

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(settingsRow(page)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Install" })).toHaveCount(0);
  });
});

test.describe("the install dialog", () => {
  test("asks on the passport once the browser offers an install, with a button each way", async ({ page }, testInfo) => {
    await open(page);
    expect(await fireInstallPrompt(page), "preventDefault() keeps Chrome's own mini-infobar away").toBe(true);

    const sheet = dialog(page);
    await expect(sheet).toBeVisible({ timeout: 5000 });
    await expect(sheet).toContainText("Add it to your home screen to open it like an app, even without a connection.");
    const install = sheet.getByRole("button", { name: "Install", exact: true });
    const notNow = sheet.getByRole("button", { name: "Not now" });
    await expect(install).toBeVisible();
    await expect(notNow).toBeVisible();
    for (const button of [install, notNow]) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Holding the event is not using it: only the tap shows the browser's prompt.
    expect(await promptCalls(page)).toBe(0);

    await page.screenshot({ path: testInfo.outputPath("install-dialog.png"), scale: "css", animations: "disabled" });
  });

  test("waits a moment after the passport appears, even when the event came before anything rendered", async ({ page }) => {
    // Chrome can fire the event as soon as the page has loaded, before a single component has mounted.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const event = new Event("beforeinstallprompt", { cancelable: true });
        Object.assign(event, { prompt: async () => {}, userChoice: Promise.resolve({ outcome: "accepted" }) });
        window.dispatchEvent(event);
      });
    });
    await page.goto("./");
    await expect(headline(page)).toBeVisible();
    const shown = Date.now();

    await expect(dialog(page)).toBeVisible({ timeout: 5000 });
    // 1.5 seconds after the passport, less the time it took this test to notice the passport.
    expect(Date.now() - shown).toBeGreaterThanOrEqual(1000);
  });

  test("Install shows the browser's prompt once, and the dialog closes", async ({ page }) => {
    await open(page);
    await fireInstallPrompt(page, "accepted");
    await dialog(page).getByRole("button", { name: "Install", exact: true }).click();

    await expect(dialog(page)).toHaveCount(0);
    expect(await promptCalls(page)).toBe(1);
    // Installed is the end of it: nothing to remember, and no second ask.
    expect(await storedDismissal(page)).toBeNull();
    await page.waitForTimeout(WAIT_FOR_NOTHING_MS);
    await expect(dialog(page)).toHaveCount(0);
    expect(await promptCalls(page)).toBe(1);
  });

  test("closing the browser's own prompt counts as Not now", async ({ page }) => {
    await open(page);
    await fireInstallPrompt(page, "dismissed");
    const before = Date.now();
    await dialog(page).getByRole("button", { name: "Install", exact: true }).click();

    await expect(dialog(page)).toHaveCount(0);
    expect(await promptCalls(page)).toBe(1);
    expect(Number(await storedDismissal(page))).toBeGreaterThanOrEqual(before);

    await reopen(page);
    await fireInstallPrompt(page);
    await page.waitForTimeout(WAIT_FOR_NOTHING_MS);
    await expect(dialog(page)).toHaveCount(0);
  });

  test("Not now closes it, and it asks again only after 14 days", async ({ page }) => {
    await open(page);
    await fireInstallPrompt(page);
    const before = Date.now();
    await dialog(page).getByRole("button", { name: "Not now" }).click();

    await expect(dialog(page)).toHaveCount(0);
    expect(await promptCalls(page)).toBe(0);
    const stored = Number(await storedDismissal(page));
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(Date.now());

    // The next visit, with the browser offering again: still quiet.
    await reopen(page);
    await fireInstallPrompt(page);
    await page.waitForTimeout(WAIT_FOR_NOTHING_MS);
    await expect(dialog(page)).toHaveCount(0);

    // Thirteen days on, still quiet; fifteen, and it asks.
    await page.evaluate(([key, at]) => localStorage.setItem(key, String(at)), [DISMISSED_KEY, String(Date.now() - 13 * DAY_MS)]);
    await reopen(page);
    await fireInstallPrompt(page);
    await page.waitForTimeout(WAIT_FOR_NOTHING_MS);
    await expect(dialog(page)).toHaveCount(0);

    await page.evaluate(([key, at]) => localStorage.setItem(key, String(at)), [DISMISSED_KEY, String(Date.now() - 15 * DAY_MS)]);
    await reopen(page);
    await fireInstallPrompt(page);
    await expect(dialog(page)).toBeVisible({ timeout: 5000 });
  });

  for (const way of ["Escape", "the backdrop", "the grab handle"] as const) {
    test(`closing it with ${way} is Not now`, async ({ page }) => {
      await open(page);
      await fireInstallPrompt(page);
      const sheet = dialog(page);
      await expect(sheet).toBeVisible({ timeout: 5000 });
      // The sheet takes focus when it opens, so Escape needs no click first.
      await expect(sheet).toBeFocused();
      const before = Date.now();

      if (way === "Escape") await page.keyboard.press("Escape");
      // The backdrop is the first "Close" button, behind the panel: click its top-left corner, clear of the sheet.
      else if (way === "the backdrop") await page.getByRole("button", { name: "Close" }).first().click({ position: { x: 10, y: 10 } });
      else await sheet.getByRole("button", { name: "Close" }).click();

      await expect(sheet).toHaveCount(0);
      expect(await promptCalls(page)).toBe(0);
      expect(Number(await storedDismissal(page))).toBeGreaterThanOrEqual(before);

      await reopen(page);
      await fireInstallPrompt(page);
      await page.waitForTimeout(WAIT_FOR_NOTHING_MS);
      await expect(sheet).toHaveCount(0);
    });
  }

  test("still does not ask twice in one visit when the browser will not store the answer", async ({ page }) => {
    await page.addInitScript(() => {
      const blocked = () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      };
      Object.defineProperty(window, "localStorage", { configurable: true, get: blocked });
    });
    await open(page);
    await fireInstallPrompt(page);
    await dialog(page).getByRole("button", { name: "Not now" }).click();
    await expect(dialog(page)).toHaveCount(0);

    // Away and back to the passport, and a second offer from the browser: still not asked again.
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("link", { name: "Settings" }).click();
    await nav.getByRole("link", { name: "Passport" }).click();
    await expect(headline(page)).toBeVisible();
    await fireInstallPrompt(page);
    await page.waitForTimeout(WAIT_FOR_NOTHING_MS);
    await expect(dialog(page)).toHaveCount(0);
  });

  test("asks at most once per visit, even if it was left open and the passport is visited again", async ({ page }) => {
    await open(page);
    await fireInstallPrompt(page);
    await expect(dialog(page)).toBeVisible({ timeout: 5000 });

    // Leaving by the address bar answers nothing: no snooze is stored, so only the once-a-visit rule is left.
    await page.goto("./#/world");
    await expect(page.getByRole("heading", { name: "World view" })).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    expect(await storedDismissal(page)).toBeNull();

    await page.goto("./#/");
    await expect(headline(page)).toBeVisible();
    await page.waitForTimeout(WAIT_FOR_NOTHING_MS);
    await expect(dialog(page)).toHaveCount(0);
  });

  test("is not shown on any screen but the passport, and shows when you get there", async ({ page }) => {
    await open(page, "/check-in");
    await expect(page.getByRole("heading", { name: "Where did you eat?" })).toBeVisible();
    await fireInstallPrompt(page);
    await page.waitForTimeout(WAIT_FOR_NOTHING_MS);
    await expect(dialog(page)).toHaveCount(0);

    await page.goto("./#/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.waitForTimeout(WAIT_FOR_NOTHING_MS);
    await expect(dialog(page)).toHaveCount(0);

    // The same held event, and the dialog is the passport's alone.
    await page.goto("./#/");
    await expect(headline(page)).toBeVisible();
    await expect(dialog(page)).toBeVisible({ timeout: 5000 });
  });

  test("is not shown when the app is already installed and running as an app", async ({ page }) => {
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (query: string) => {
        const list = real(query);
        if (query === "(display-mode: standalone)") Object.defineProperty(list, "matches", { value: true });
        return list;
      };
    });
    await open(page);
    expect(await page.evaluate(() => matchMedia("(display-mode: standalone)").matches)).toBe(true);
    await fireInstallPrompt(page);
    await page.waitForTimeout(WAIT_FOR_NOTHING_MS);
    await expect(dialog(page)).toHaveCount(0);
  });
});

test.describe("the Settings row", () => {
  test("appears once an install is on offer, and asks the browser when tapped", async ({ page }, testInfo) => {
    await open(page, "/settings");
    await expect(settingsRow(page)).toHaveCount(0);

    await fireInstallPrompt(page);
    await expect(settingsRow(page)).toBeVisible();
    expect((await settingsRow(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath("install-settings-row.png"), scale: "css", animations: "disabled" });
    // Settings is not the passport, so there is no dialog.
    await expect(dialog(page)).toHaveCount(0);

    await settingsRow(page).click();
    expect(await promptCalls(page)).toBe(1);
    // The event is spent, so the row goes.
    await expect(settingsRow(page)).toHaveCount(0);
  });

  test("ignores the 14 day snooze, because the person is asking", async ({ page }) => {
    await open(page, "/settings");
    await page.evaluate((key) => localStorage.setItem(key, String(Date.now())), DISMISSED_KEY);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    await fireInstallPrompt(page);
    await expect(settingsRow(page)).toBeVisible();
    await settingsRow(page).click();
    expect(await promptCalls(page)).toBe(1);
  });

  test("goes when the app gets installed", async ({ page }) => {
    await open(page, "/settings");
    await fireInstallPrompt(page);
    await expect(settingsRow(page)).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(settingsRow(page)).toHaveCount(0);
  });

  test("is not shown when the app is already installed and running as an app", async ({ page }) => {
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (query: string) => {
        const list = real(query);
        if (query === "(display-mode: standalone)") Object.defineProperty(list, "matches", { value: true });
        return list;
      };
    });
    await open(page, "/settings");
    await fireInstallPrompt(page);
    // Give a wrongly shown row the time to appear.
    await page.waitForTimeout(500);
    await expect(settingsRow(page)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Install" })).toHaveCount(0);
  });
});
