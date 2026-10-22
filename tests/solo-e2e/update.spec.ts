import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "./fixtures";

// A second server, on its own port, so that the folder it serves can be swapped while a page has the app
// open: the suite's own server serves one build for the whole run.
const ORIGIN = "http://localhost:4174";
test.use({ baseURL: `${ORIGIN}/eat-the-world/`, serviceWorkers: "allow" });

const AKOKO = "seed:akoko-w1t-3lp";
const ASAFO = "seed:asafo-sw2-4eg";
const VITE = path.resolve(__dirname, "../../node_modules/vite/bin/vite.js");
const BUILD_CONFIG = path.resolve(__dirname, "support/marked-build.config.ts");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

let builds: string;
let live: string;
let server: Server;

/** The production build, with `marker` shown on the page, written to `<builds>/<marker>`. */
function build(marker: string): string {
  const outDir = path.join(builds, marker);
  execFileSync(process.execPath, [VITE, "build", "--config", BUILD_CONFIG, "--outDir", outDir, "--emptyOutDir"], {
    env: { ...process.env, ETW_BUILD_MARKER: marker, VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" },
    stdio: "pipe",
  });
  return outDir;
}

/** The names of a build's entry script, which change with the source, as `index.html` lists it. */
const entryScript = (dir: string) => /assets\/(index-[\w-]+\.js)/.exec(readFileSync(path.join(dir, "index.html"), "utf8"))![1];

/** Serves `live` under /eat-the-world/ the way GitHub Pages would, with the same cache lifetime. */
function startServer(): Promise<Server> {
  const app = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", ORIGIN);
    const file = path.join(live, pathname.replace(/^\/eat-the-world\//, "") || "index.html");
    const found = pathname.startsWith("/eat-the-world/") && file.startsWith(live) && existsSync(file) && statSync(file).isFile();
    if (!found) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "max-age=600",
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => app.listen(4174, () => resolve(app)));
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  builds = mkdtempSync(path.join(tmpdir(), "etw-update-"));
  // The same two folders the whole run: v1 is what the phone installed, v2 is the next release.
  build("build v1");
  build("build v2");
  live = path.join(builds, "build v1");
  server = await startServer();
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(builds, { recursive: true, force: true });
});

test("an open, installed page takes a new release at its next move, and keeps what it saved", async ({ page, context }) => {
  const marker = page.locator("#build-marker");
  const headline = page.getByRole("heading", { level: 1 });

  // The page registers its worker a moment after it loads; this says when that call has finished.
  await page.addInitScript(() => {
    const worker = navigator.serviceWorker;
    const register = worker.register.bind(worker);
    (window as unknown as { registered: Promise<void> }).registered = new Promise((resolve) => {
      worker.register = (...args) => register(...args).finally(resolve);
    });
  });

  // Release one, installed: the page is controlled by the service worker, and holds a saved visit.
  await page.goto("./");
  await expect(marker).toHaveText("build v1");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.goto(`./#/check-in?restaurant=${AKOKO}`);
  await page.getByRole("button", { name: "Save visit" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(headline).toHaveText("1 / 249 countries");

  // The next time the app is opened, the worker is already in charge when the page starts: that is how
  // it knows a later worker is an update.
  await page.reload();
  await page.evaluate(() => (window as unknown as { registered: Promise<void> }).registered);

  // A second visit is half written when the next release goes live and the browser finds it.
  await page.goto(`./#/check-in?restaurant=${ASAFO}`);
  const note = page.getByLabel(/A note/);
  await note.fill("Typed before the update");
  live = path.join(builds, "build v2");
  // The new worker claims the page, and only then finishes activating.
  const takenOver = page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const { serviceWorker } = navigator;
        serviceWorker.addEventListener(
          "controllerchange",
          () => {
            const worker = serviceWorker.controller!;
            const settled = () => worker.state === "activated" && resolve();
            worker.addEventListener("statechange", settled);
            settled();
          },
          { once: true },
        );
      }),
  );
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
  await takenOver;

  // The new worker is in charge, but the page has not been pulled out from under the visit being written.
  await expect(marker).toHaveText("build v1");
  await expect(note).toHaveValue("Typed before the update");

  // The next move to another screen reloads onto the new release.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(marker).toHaveText("build v2");
  await expect(headline).toHaveText("1 / 249 countries");
  await expect(page.getByRole("region", { name: "Your stamps" }).getByRole("img", { name: /^Nigeria, stamped/ })).toBeVisible();

  // The cache now holds the new release's files, not the old ones, so it works with no connection too.
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    return urls;
  });
  expect(cached.some((url) => url.endsWith(entryScript(path.join(builds, "build v2"))))).toBe(true);
  expect(cached.some((url) => url.endsWith(entryScript(path.join(builds, "build v1"))))).toBe(false);

  await context.setOffline(true);
  const response = await page.reload();
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(marker).toHaveText("build v2");
  await expect(headline).toHaveText("1 / 249 countries");
});
