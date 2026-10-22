import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { THEME_LIGHT } from "../../src/lib/app";
import seed from "../../solo/src/data/seed.json";
import { expect, test } from "./fixtures";

// The suite blocks service workers so that `page.route` keeps working; the offline app needs its own.
test.use({ serviceWorkers: "allow" });

const AKOKO = "seed:akoko-w1t-3lp";
const DIST = path.resolve(__dirname, "../../solo/dist");

const read = (file: string) => readFileSync(path.join(DIST, file), "utf8");
const headline = (page: Page) => page.getByRole("heading", { level: 1 });

/** Every file in the build, as the path the browser asks for it by, relative to the app's own folder. */
const builtFiles = () =>
  readdirSync(DIST, { recursive: true, encoding: "utf8" })
    .filter((file) => statSync(path.join(DIST, file)).isFile())
    .map((file) => file.split(path.sep).join("/"));

/** The files the service worker precaches: every `url` in the precache list written into `sw.js`. */
const precached = () => [...read("sw.js").matchAll(/url:"([^"]+)"/g)].map((match) => match[1]);

test.describe("the built files", () => {
  test("hold a service worker that takes over at once and never touches OpenStreetMap", () => {
    const sw = read("sw.js");

    expect(sw).toContain("skipWaiting");
    expect(sw).toContain("clientsClaim");
    // The tile policy forbids prefetching or offline tiles: no mention of the host, and no runtime caching.
    expect(sw.toLowerCase()).not.toContain("openstreetmap");
    expect(sw).not.toMatch(/CacheFirst|NetworkFirst|StaleWhileRevalidate|CacheOnly|NetworkOnly|ExpirationPlugin/);
    // The one route besides the precache is the fallback to index.html for page loads.
    expect(sw.match(/registerRoute\(/g)).toHaveLength(1);
    expect(sw).toContain("NavigationRoute");
    // An update replaces the cached app files and nothing else: the data lives in IndexedDB.
    expect(sw).not.toMatch(/indexedDB|deleteDatabase|Clear-Site-Data/i);
  });

  test("precache every file the app can ask for, and say which few it leaves out", () => {
    const cached = new Set(precached());
    const notCached = builtFiles().filter((file) => !cached.has(file));

    // Left out on purpose: the worker itself and its helper, and the .woff copies that sit behind the
    // .woff2 ones in each @font-face (every browser that runs a service worker takes the .woff2).
    expect(notCached.filter((file) => file !== "sw.js" && !/^workbox-[^/]+\.js$/.test(file) && !file.endsWith(".woff"))).toEqual(
      [],
    );
    expect(notCached.filter((file) => file.endsWith(".woff"))).toHaveLength(4);

    for (const needed of [
      "index.html",
      "manifest.webmanifest",
      "icons/icon-192.png",
      "icons/icon-512.png",
      "icons/icon-maskable-512.png",
    ]) {
      expect(cached, needed).toContain(needed);
    }
    const some = (pattern: RegExp) => [...cached].filter((file) => pattern.test(file));
    expect(some(/^assets\/countries-50m-.+\.js$/), "the world map data").toHaveLength(1);
    expect(some(/^assets\/World-.+\.js$/), "the World screen").toHaveLength(1);
    expect(some(/^assets\/[^/]+\.css$/).length, "style sheets").toBeGreaterThanOrEqual(2);
    expect(some(/^assets\/.+\.svg$/).length, "flags").toBeGreaterThan(100);
    // The on-demand font subsets are kept too, so text typed in any alphabet is drawn in the same face.
    expect(some(/^assets\/fraunces-latin-ext-.+\.woff2$/)).toHaveLength(1);
    expect(some(/^assets\/fraunces-vietnamese-.+\.woff2$/)).toHaveLength(1);
  });

  test("keep every address relative, so the app works under /eat-the-world/", () => {
    expect(read("index.html")).not.toMatch(/(?:src|href)="\//);
    for (const css of builtFiles().filter((file) => file.endsWith(".css"))) {
      expect(read(css), css).not.toMatch(/url\(\s*["']?\//);
    }
  });

  test("tell search engines to stay away, and send OpenStreetMap a referrer", () => {
    const html = read("index.html");

    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"\s*\/?>/);
    expect(html).toMatch(/<meta name="referrer" content="strict-origin-when-cross-origin"\s*\/?>/);
    // GitHub Pages cannot set headers, and a robots.txt under a project path is never read.
    expect(existsSync(path.join(DIST, "_headers"))).toBe(false);
    expect(existsSync(path.join(DIST, "robots.txt"))).toBe(false);
  });

  test("describe an installable app that starts and stays inside its own folder", () => {
    expect(read("index.html")).toMatch(/<link rel="manifest" href="\.\/manifest\.webmanifest">/);
    const manifest = JSON.parse(read("manifest.webmanifest"));

    expect(manifest).toMatchObject({
      id: "/eat-the-world-solo",
      name: "Eat the World Solo",
      short_name: "ETW Solo",
      start_url: "./",
      scope: "./",
      display: "standalone",
      orientation: "portrait",
      background_color: THEME_LIGHT,
      theme_color: THEME_LIGHT,
    });
    expect(manifest.icons).toEqual([
      { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
    for (const icon of manifest.icons) expect(existsSync(path.join(DIST, icon.src)), icon.src).toBe(true);
  });
});

/**
 * Loads the app online, waits until the service worker has precached it and controls the page, then
 * drops the network. The requests that fail from here on are collected, and the caller checks them.
 */
async function goOffline(page: Page, context: BrowserContext) {
  const failed: string[] = [];
  page.on("requestfailed", (request) => failed.push(request.url()));

  await page.goto("./");
  await expect(headline(page)).toHaveText("0 / 249 countries");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  return failed;
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

/** How many pixels of the map's canvas have been drawn on, by reading them back. */
const paintedPixels = (map: Locator) =>
  map.locator("canvas").first().evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    let painted = 0;
    for (let alpha = 3; alpha < data.length; alpha += 4) if (data[alpha] > 0) painted++;
    return painted;
  });

test.describe("with no connection at all", () => {
  test("the passport, the world map and a new visit all work, and the visit is still there on the next load", async ({
    page,
    context,
  }) => {
    const failed = await goOffline(page, context);

    // A cold load: the page, its scripts, styles, fonts and flags all come from the service worker.
    const response = await page.reload();
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(headline(page)).toHaveText("0 / 249 countries");
    await expect(page.getByRole("heading", { name: "Your passport is blank" })).toBeVisible();

    // The world map is a separate chunk with the 50m country outlines in it. It draws them on a canvas, so
    // there are no `path.leaflet-interactive` elements to count: the map lists the countries it drew a tap
    // dot for in `data-dots` once the outlines are parsed, and the canvas must hold pixels drawn from them.
    await nav(page).getByRole("link", { name: "World" }).click();
    const worldMap = page.locator('[role="application"][data-dots]');
    await expect(worldMap).toBeAttached();
    expect(((await worldMap.getAttribute("data-dots")) ?? "").split(",").length).toBeGreaterThanOrEqual(20);
    await expect.poll(() => paintedPixels(worldMap)).toBeGreaterThan(5_000);

    // Logging a meal needs no network, and the stamp survives a fresh load.
    await page.goto(`./#/check-in?restaurant=${AKOKO}`);
    await page.getByRole("button", { name: "Save visit" }).click();
    await expect(page.getByRole("heading", { name: "Nigeria, stamped!" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(headline(page)).toHaveText("1 / 249 countries");

    await page.reload();
    await expect(headline(page)).toHaveText("1 / 249 countries");
    await expect(page.getByRole("region", { name: "Your stamps" }).getByRole("img", { name: /^Nigeria, stamped/ })).toBeVisible();
    await page.goto("./#/country/NG");
    await expect(page.getByRole("heading", { level: 1, name: "Nigeria" })).toBeVisible();
    await page.goto("./#/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    expect(failed).toEqual([]);
  });

  test.describe("on the map", () => {
    // The tiles come from OpenStreetMap, which the app never caches, so they fail here and Chrome says so.
    // This is the only place that failure is expected; any other failed request still fails the test.
    test.use({ ignoreErrors: /tile\.openstreetmap\.org/ });

    test("the pins and the page are still there, with only the tiles missing", async ({ page, context }) => {
      const failed = await goOffline(page, context);
      // Let the tile requests reach the (absent) network instead of the suite's blank-tile stub.
      await context.unroute("https://tile.openstreetmap.org/**");

      await page.reload();
      await nav(page).getByRole("link", { name: "Map" }).click();

      await expect(page.getByRole("heading", { name: "Map" })).toBeVisible();
      await expect(page.locator(".leaflet-marker-icon")).toHaveCount(seed.restaurants.length);
      await expect(page.getByRole("link", { name: "OpenStreetMap" })).toBeVisible();
      await expect.poll(() => failed.some((url) => url.startsWith("https://tile.openstreetmap.org/"))).toBe(true);
      expect(failed.filter((url) => !url.startsWith("https://tile.openstreetmap.org/"))).toEqual([]);
      // The rest of the app is not taken down with it.
      await nav(page).getByRole("link", { name: "Passport" }).click();
      await expect(headline(page)).toHaveText("0 / 249 countries");
    });
  });
});

test.describe("a browser that refuses the service worker", () => {
  // The app logs why offline support did not start, so it can be diagnosed; expected here.
  test.use({ ignoreErrors: /Eat the World: offline support/ });

  test("still opens the app, and logs the reason", async ({ page }) => {
    const logged: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") logged.push(message.text());
    });
    await page.addInitScript(() => {
      navigator.serviceWorker.register = () => Promise.reject(new DOMException("Blocked for the test.", "SecurityError"));
    });
    await page.goto("./");

    await expect(headline(page)).toHaveText("0 / 249 countries");
    await expect.poll(() => logged.some((text) => /Eat the World: offline support[\s\S]*SecurityError/.test(text))).toBe(true);
  });
});

test.describe("installing", () => {
  // Whether Chrome would offer the install prompt is not checked here: headless Chrome reports no
  // installability errors even for a page with no manifest. This is what it makes of the manifest itself.
  test("Chrome reads the manifest without complaint, and gives the app an id of its own", async ({ page, context }) => {
    await page.goto("./");

    const chrome = await context.newCDPSession(page);
    const { errors, manifest } = await chrome.send("Page.getAppManifest");

    expect(errors).toEqual([]);
    // The relative start_url and scope land on the folder the app is served from.
    expect(manifest?.startUrl).toBe("http://localhost:4173/eat-the-world/");
    expect(manifest?.scope).toBe("http://localhost:4173/eat-the-world/");
    // The id is resolved against the origin, not the folder, so it stays the same if the app moves.
    expect(manifest?.id).toBe("http://localhost:4173/eat-the-world-solo");
  });
});
