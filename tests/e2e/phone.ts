import { mkdir } from "node:fs/promises";
import { devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { signIn } from "./helpers";

export type Geo = { lat: number; lon: number } | "denied" | null;

/** A 390x844 phone context signed in as `email`. `geo`: a position to grant, "denied", or none. */
export async function phone(
  browser: Browser,
  baseURL: string,
  email: string,
  geo: Geo = null,
  next = "/",
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    viewport: { width: 390, height: 844 },
    baseURL,
    ...(geo && geo !== "denied"
      ? { geolocation: { latitude: geo.lat, longitude: geo.lon, accuracy: 20 }, permissions: ["geolocation" as const] }
      : {}),
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("etw:ios-install-hint-dismissed", "1");
    } catch {}
  });
  if (geo === "denied") {
    await ctx.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, err) =>
        err?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
    });
  }
  // OpenStreetMap tiles are not under test and the sandbox may be offline.
  if (!process.env.SCREENS) await ctx.route(/tile\.openstreetmap\.org/, (r) => r.abort());
  const page = await ctx.newPage();
  await signIn(page, email, next);
  return { ctx, page };
}

/** Screenshot after the page settles; hides the Next dev indicator. */
export async function shot(page: Page, dir: string, name: string, opts: { fullPage?: boolean } = {}) {
  await mkdir(dir, { recursive: true });
  await page.waitForLoadState("load");
  await page.waitForTimeout(900);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: `${dir}/${name}.png`, ...opts });
}
