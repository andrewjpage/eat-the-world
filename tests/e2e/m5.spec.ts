import { expect, test } from "@playwright/test";
import { admin, cleanupUsers, createGroup, createUser } from "./helpers";
import { dinner, restaurantRow, table } from "./m4-helpers";
import { phone, shot } from "./phone";

const OUT = "docs/screens/M5";

test.afterAll(cleanupUsers);

/** Pins on the map = restaurants that are active or reported closed. */
async function mapRestaurantCount() {
  const { count } = await admin()
    .from("restaurants")
    .select("id", { count: "exact", head: true })
    .in("status", ["active", "reported_closed"]);
  return count ?? 0;
}

async function lone(label: string) {
  const u = await createUser(label, "Map Mo");
  await createGroup(u.id, "Map Supper");
  return u;
}

test("map: one pin per active restaurant; nearest unstamped flies to Lao Café", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const lao = await restaurantRow("Lao Café");
  const u = await lone("map");
  const { ctx, page } = await phone(browser, baseURL!, u.email, { lat: lao.lat, lon: lao.lon }, "/map");
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));

  const pins = page.locator(".leaflet-marker-icon.etw-pin");
  await expect(pins.first()).toBeVisible({ timeout: 20_000 });
  expect(await pins.count()).toBe(await mapRestaurantCount());
  await expect(page.getByText("OpenStreetMap contributors")).toBeVisible();

  // A new user has no stamps, so Lao Café (Laos) is the nearest unstamped pin: well under 1 km away.
  await page.getByRole("button", { name: "Nearest unstamped" }).click();
  const card = page.getByRole("region", { name: "Lao Café, Laos" });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText(/\b\d+ ?m away/);
  await expect(card.getByRole("link", { name: "Check in" })).toHaveAttribute("href", `/check-in/${lao.id}`);
  await expect(card.getByRole("link", { name: "Details" })).toHaveAttribute("href", `/restaurant/${lao.id}`);
  // The position never leaves the browser.
  expect(urls.some((x) => /lat=|lon=|latitude|longitude|51\.\d{4,}/.test(decodeURIComponent(x)))).toBe(false);
  await ctx.close();
});

test("map: a stamped country is skipped by Nearest unstamped", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const lao = await restaurantRow("Lao Café");
  const { people, group } = await table("MapSk", 1, "Skip Supper");
  await dinner(people[0], [people[1]], group.id, "Lao Café", true);
  const { ctx, page } = await phone(browser, baseURL!, people[0].email, { lat: lao.lat, lon: lao.lon }, "/map");
  await expect(page.locator(".leaflet-marker-icon.etw-pin").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Nearest unstamped" }).click();
  const check = page.getByRole("region").getByRole("link", { name: "Check in" });
  await expect(check).toBeVisible({ timeout: 15_000 });
  const href = await check.getAttribute("href");
  expect(href).toMatch(/^\/check-in\//);
  expect(href).not.toBe(`/check-in/${lao.id}`);
  await expect(page.getByRole("region", { name: /^Lao Café/ })).toHaveCount(0);
  await ctx.close();
});

test("map: with location denied the map and pins still work", async ({ browser, baseURL }) => {
  const u = await lone("mapd");
  const { ctx, page } = await phone(browser, baseURL!, u.email, "denied", "/map");
  const pins = page.locator(".leaflet-marker-icon.etw-pin");
  await expect(pins.first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Nearest unstamped" }).click();
  await expect(page.getByRole("status")).toContainText(/Location is off/);
  expect(await pins.count()).toBe(await mapRestaurantCount());
  // Tapping a pin still opens its card.
  await pins.first().click({ force: true });
  await expect(page.getByRole("region").getByRole("link", { name: "Check in" })).toBeVisible();
  await ctx.close();
});

test("world: renders, toggles me/group, small-country dots exist for MU", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const { people, group } = await table("World", 1, "World Supper");
  await dinner(people[0], [people[1]], group.id, "Lao Café", true);
  const { ctx, page } = await phone(browser, baseURL!, people[0].email, null, "/world");
  const map = page.getByRole("application", { name: /World map/ });
  await expect(map).toBeVisible();
  await expect(map.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
  // Dots live on the canvas, so the map lists the countries that drew one.
  await expect(map).toHaveAttribute("data-dots", /(^|,)MU(,|$)/, { timeout: 20_000 });

  const counts = page.getByRole("list", { name: "Counts" });
  await expect(page.getByRole("button", { name: "My stamps" })).toHaveAttribute("aria-pressed", "true");
  await expect(counts).toContainText(/1\s*stamped/);
  const { count: listed } = await admin()
    .from("city_country_status")
    .select("country_iso2", { count: "exact", head: true })
    .eq("status", "listed");
  await expect(counts).toContainText(new RegExp(`${(listed ?? 0) - 1}\\s*to go in London`));
  // Tap targets for tiny countries: Mauritius is listed, so it is a chip as well as a dot.
  await expect(page.getByRole("link", { name: "Mauritius" })).toHaveAttribute("href", "/country/MU");
  await expect(page.getByRole("link", { name: "Laos" })).toHaveAttribute("href", "/country/LA");

  await page.getByRole("button", { name: "My group" }).click();
  await expect(page.getByRole("button", { name: "My group" })).toHaveAttribute("aria-pressed", "true");
  await expect(counts).toContainText(/1\s*country as a table/);
  await expect(page.getByText("World Supper")).toBeVisible();
  await page.getByRole("button", { name: "My stamps" }).click();
  await expect(counts).toContainText(/1\s*stamped/);
  await ctx.close();
});

test("M5 screenshots @screens", async ({ browser, baseURL }) => {
  test.skip(!process.env.SCREENS, "set SCREENS=1 to regenerate docs/screens/M5 (after npm run dev:fixtures)");
  test.setTimeout(120_000);
  const lao = await restaurantRow("Lao Café");
  const A = await phone(browser, baseURL!, "andrew@demo.local", { lat: lao.lat, lon: lao.lon }, "/map");
  const p = A.page;
  await expect(p.locator(".leaflet-marker-icon.etw-pin").first()).toBeVisible({ timeout: 20_000 });
  await shot(p, OUT, "map-pins");
  await p.getByRole("button", { name: "Nearest unstamped" }).click();
  await expect(p.getByRole("region").getByRole("link", { name: "Check in" })).toBeVisible({ timeout: 15_000 });
  await p.waitForTimeout(1600);
  await shot(p, OUT, "map-nearest");
  await p.goto("/world");
  await expect(p.getByRole("application", { name: /World map/ })).toHaveAttribute("data-dots", /MU/, { timeout: 20_000 });
  await shot(p, OUT, "world-me", { fullPage: true });
  await p.getByRole("button", { name: "My group" }).click();
  await shot(p, OUT, "world-group", { fullPage: true });
  await A.ctx.close();
});
