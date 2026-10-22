import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import sharp from "sharp";
import seed from "../../solo/src/data/seed.json";
import { DB_NAME } from "../../solo/src/db/schema";
import type { Backfill, SoloRestaurant, SoloVisit } from "../../solo/src/domain/types";
import { expect, injectData, test } from "./fixtures";

const ENISH = "seed:enish-oxford-street-w1t-3ld";
const AKOKO = "seed:akoko-w1t-3lp";
const ZERET = "seed:zeret-kitchen-se5-0ed";

const restaurant = (id: string, name: string, countryIso2: string, over: Partial<SoloRestaurant> = {}): SoloRestaurant => ({
  id,
  seedId: null,
  name,
  countryIso2,
  address: null,
  lat: null,
  lon: null,
  createdAt: "2026-10-01T12:00:00.000Z",
  ...over,
});

const visit = (id: string, restaurantId: string, visitedOn: string, over: Partial<SoloVisit> = {}): SoloVisit => ({
  id,
  restaurantId,
  visitedOn,
  dishId: null,
  dishOther: null,
  rating: null,
  note: null,
  photoId: null,
  createdAt: `${visitedOn}T19:00:00.000Z`,
  ...over,
});

const backfill = (countryIso2: string): Backfill => ({ countryIso2, createdAt: "2026-10-02T09:00:00.000Z" });

/**
 * A realistic passport. Nigeria is stamped through a copy of the flagged London pick Akoko, and has
 * a second, hand-added place with no position. France is stamped through a hand-added Soho cafe
 * that has one. Spain was eaten before the app.
 */
const AKOKO_COPY = restaurant("r-akoko", "Akoko", "NG", {
  seedId: AKOKO,
  address: "21 Berners St, London",
  lat: 51.517912,
  lon: -0.136752,
});
const MUMS_KITCHEN = restaurant("r-mums", "Mum's Kitchen", "NG");
const MAISON = restaurant("r-maison", "Maison Bertaux", "FR", { address: "28 Greek St, London", lat: 51.5133, lon: -0.1318 });

const POPULATED = {
  restaurants: [AKOKO_COPY, MUMS_KITCHEN, MAISON],
  visits: [
    visit("v-akoko", "r-akoko", "2026-10-03", { rating: 4, dishId: "seed:dish:NG:jollof-rice" }),
    visit("v-mums", "r-mums", "2026-10-09", { rating: 5, dishOther: "Pepper soup" }),
    visit("v-maison", "r-maison", "2026-10-12"),
  ],
  backfills: [backfill("ES")],
};

/** Opens the app once so it creates its database, writes the data, then opens `hash` on a fresh load. */
async function open(page: Page, hash: string, data: Parameters<typeof injectData>[1] = {}) {
  await page.goto("./");
  await injectData(page, data);
  await page.goto(`./#${hash}`);
  await page.reload();
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test.describe("country page", () => {
  test("a stamped country lists its dishes, London suggestions and my own visits", async ({ page }) => {
    await open(page, "/country/NG", POPULATED);

    await expect(page.getByRole("heading", { level: 1, name: "Nigeria" })).toBeVisible();
    await expect(page.getByText("Stamped 3 Oct 2026")).toBeVisible();
    await expect(page.getByText("On the London list")).toBeVisible();

    // The approved dishes for Nigeria, as the seed CSV has them.
    const dishes = page.getByRole("region", { name: "Signature dishes" });
    for (const d of seed.dishes.filter((d) => d.countryIso2 === "NG")) await expect(dishes).toContainText(d.name);

    // Both Nigerian suggestions; each offers a visit, linked by its seed id.
    const london = page.getByRole("region", { name: "Where to eat in London" });
    const enish = london.getByRole("listitem").filter({ hasText: "Enish (Oxford Street)" });
    const akoko = london.getByRole("listitem").filter({ hasText: "Akoko" });
    await expect(london.getByRole("listitem")).toHaveCount(2);
    await expect(enish.getByRole("link", { name: "Log a visit" })).toHaveAttribute("href", `#/check-in?restaurant=${ENISH}`);
    await expect(akoko.getByRole("link", { name: "Log a visit" })).toHaveAttribute("href", `#/check-in?restaurant=${AKOKO}`);
    await expect(enish.getByRole("link", { name: /Enish/ })).toHaveAttribute("href", `#/restaurant/${ENISH}`);

    // The flagged one says so, with the curator's reason on the page (a hover title is no use on a phone).
    const akokoSeed = seed.restaurants.find((r) => r.id === AKOKO)!;
    await expect(akoko.getByText("Contested pick")).toHaveAttribute("title", akokoSeed.curatorNote!);
    await expect(akoko).toContainText(akokoSeed.curatorNote!);
    await expect(enish.getByText("Contested pick")).toHaveCount(0);
    await expect(akoko.getByText("You've been here")).toBeVisible();
    await expect(enish.getByText("You've been here")).toHaveCount(0);

    // Google Maps opens by the seed's place id.
    const maps = akoko.getByRole("link", { name: "Open in Google Maps" });
    await expect(maps).toHaveAttribute("href", new RegExp(`query_place_id=${akokoSeed.googlePlaceId}`));
    await expect(maps).toHaveAttribute("target", "_blank");
    await expect(maps).toHaveAttribute("rel", /noopener/);

    // My visits here, newest first, each opening its visit page.
    const mine = page.getByRole("region", { name: "Your visits" });
    await expect(mine.getByRole("listitem")).toHaveCount(2);
    const first = mine.getByRole("listitem").first();
    await expect(first).toContainText("Mum's Kitchen");
    await expect(first).toContainText("9 Oct 2026");
    await expect(first.getByRole("img", { name: "5.0 out of 5" })).toBeVisible();
    await expect(first.getByRole("link")).toHaveAttribute("href", "#/visit/v-mums");
    const second = mine.getByRole("listitem").nth(1);
    await expect(second).toContainText("Akoko");
    await expect(second).toContainText("3 Oct 2026");
    await expect(second.getByRole("img", { name: "4.0 out of 5" })).toBeVisible();
    await expect(second.getByRole("link")).toHaveAttribute("href", "#/visit/v-akoko");

    await expect(page.getByRole("link", { name: "Log a visit here" })).toHaveAttribute("href", "#/check-in?country=NG");

    // This is one person's passport: nothing about friends, groups or suggesting places to a curator.
    await expect(page.getByText(/eaten by|friend|suggest a|curator will/i)).toHaveCount(0);
    // France's visit is not Nigeria's.
    await expect(page.getByText("Maison Bertaux")).toHaveCount(0);
  });

  test("a country London has no pick for says so, and still lets me log a visit", async ({ page }) => {
    // France: no London suggestion and no approved dishes in the seed.
    expect(seed.restaurants.some((r) => r.countryIso2 === "FR")).toBe(false);
    expect(seed.dishes.some((d) => d.countryIso2 === "FR")).toBe(false);
    await open(page, "/country/fr");

    await expect(page.getByRole("heading", { level: 1, name: "France" })).toBeVisible();
    await expect(page.getByText("Not on the London list")).toBeVisible();
    await expect(page.getByText("Not stamped yet")).toBeVisible();
    await expect(page.getByRole("region", { name: "Signature dishes" })).toHaveCount(0);
    await expect(page.getByText("No London picks yet")).toBeVisible();
    await expect(page.getByText("No visits here yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Log a visit here" })).toHaveAttribute("href", "#/check-in?country=FR");
  });

  test("a country eaten before the app is marked as a memory", async ({ page }) => {
    await open(page, "/country/ES", { backfills: [backfill("ES")] });

    await expect(page.getByRole("heading", { level: 1, name: "Spain" })).toBeVisible();
    await expect(page.getByText("Before the app")).toBeVisible();
    await expect(page.getByText("Not stamped yet")).toHaveCount(0);
  });

  test("a code that is no country says so and leads back", async ({ page }) => {
    await page.goto("./#/country/ZZ");

    await expect(page.getByRole("heading", { name: "No such country" })).toBeVisible();
    await page.getByRole("link", { name: "Back to my passport" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("0 / 249 countries");
  });
});

test.describe("restaurant page", () => {
  test("a London suggestion nobody has visited opens, with its note and a way to log a visit", async ({ page }) => {
    await open(page, `/restaurant/${AKOKO}`);

    const akoko = seed.restaurants.find((r) => r.id === AKOKO)!;
    await expect(page.getByRole("heading", { level: 1, name: "Akoko" })).toBeVisible();
    await expect(page.getByText("21 Berners St, London, W1T 3LP")).toBeVisible();
    await expect(page.getByRole("link", { name: "Nigeria" })).toHaveAttribute("href", "#/country/NG");
    await expect(page.getByText("Contested pick")).toBeVisible();
    await expect(page.getByText(akoko.curatorNote!)).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Google Maps" })).toHaveAttribute(
      "href",
      new RegExp(`query_place_id=${akoko.googlePlaceId}`),
    );
    await expect(page.getByText("No visits yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Log a visit", exact: true })).toHaveAttribute(
      "href",
      `#/check-in?restaurant=${AKOKO}`,
    );
    // Single player: no closure reports, no friends.
    await expect(page.getByText(/report|friend/i)).toHaveCount(0);
  });

  test("my copy of a suggestion keeps its curator note, and shows my visits with their ratings", async ({ page }) => {
    await open(page, "/restaurant/r-akoko", POPULATED);

    await expect(page.getByRole("heading", { level: 1, name: "Akoko" })).toBeVisible();
    await expect(page.getByText("Contested pick")).toBeVisible();
    await expect(page.getByText(seed.restaurants.find((r) => r.id === AKOKO)!.curatorNote!)).toBeVisible();

    const mine = page.getByRole("region", { name: "Your visits" });
    await expect(mine.getByRole("listitem")).toHaveCount(1);
    await expect(mine).toContainText("3 Oct 2026");
    await expect(mine).toContainText("Jollof Rice");
    await expect(mine.getByRole("img", { name: "4.0 out of 5" })).toBeVisible();
    await expect(mine.getByRole("link")).toHaveAttribute("href", "#/visit/v-akoko");
    await expect(page.getByText("No visits yet")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Log a visit", exact: true })).toHaveAttribute(
      "href",
      "#/check-in?restaurant=r-akoko",
    );
  });

  test("the suggestion's own link shows the visits logged against my copy of it", async ({ page }) => {
    await open(page, `/restaurant/${AKOKO}`, POPULATED);

    await expect(page.getByRole("region", { name: "Your visits" }).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("No visits yet")).toHaveCount(0);
  });

  test("a place I added myself opens without a curator note, and searches Google Maps by name", async ({ page }) => {
    await open(page, "/restaurant/r-mums", POPULATED);

    await expect(page.getByRole("heading", { level: 1, name: "Mum's Kitchen" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Nigeria" })).toHaveAttribute("href", "#/country/NG");
    await expect(page.getByText("Contested pick")).toHaveCount(0);
    await expect(page.getByText("Curator's note")).toHaveCount(0);
    const maps = page.getByRole("link", { name: "Open in Google Maps" });
    await expect(maps).toHaveAttribute("href", /query=Mum's%20Kitchen|query=Mum%27s%20Kitchen/);
    await expect(maps).not.toHaveAttribute("href", /query_place_id/);
    await expect(page.getByRole("region", { name: "Your visits" })).toContainText("Pepper soup");
  });

  test("an id that is nothing I know says so", async ({ page }) => {
    await page.goto("./#/restaurant/not-a-restaurant");

    await expect(page.getByRole("heading", { name: "No such restaurant" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to my passport" })).toBeVisible();
  });
});

test.describe("map", () => {
  const markers = (page: Page) => page.locator(".leaflet-marker-icon");
  const marker = (page: Page, title: string) => page.locator(`.leaflet-marker-icon[title="${title}"]`);

  test("a fresh passport shows every London suggestion, with OpenStreetMap credit", async ({ page, tileRequests }) => {
    await page.goto("./#/map");

    await expect(markers(page)).toHaveCount(seed.restaurants.length);
    await expect(marker(page, "Enish (Oxford Street) (Nigeria)")).toBeVisible();
    // Nothing visited yet, so every country is new and nothing is ringed.
    await expect(page.locator(".leaflet-marker-icon .etw-pin-stamped")).toHaveCount(0);
    await expect(page.locator(".leaflet-marker-icon .etw-ring")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "OpenStreetMap" })).toBeVisible();
    // The map asked OpenStreetMap for tiles, and only for well-formed `/{z}/{x}/{y}.png` ones.
    await expect.poll(() => tileRequests.length).toBeGreaterThan(0);
    for (const url of tileRequests) expect(url).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/);

    const legend = page.getByRole("group", { name: "Legend" });
    await expect(legend).toContainText("New country");
    await expect(legend).toContainText("Stamped");
    await expect(legend).toContainText("You've been here");
    await expect(page.getByText(/friend/i)).toHaveCount(0);
  });

  test("my places are pinned: stamped countries go quiet, places I have been are ringed, ones with no position stay off", async ({
    page,
  }) => {
    await open(page, "/map", POPULATED);

    // 68 suggestions, my copy of one replacing its suggestion, plus the Soho cafe. Mum's Kitchen has no position.
    await expect(markers(page)).toHaveCount(seed.restaurants.length + 1);
    await expect(marker(page, "Mum's Kitchen (Nigeria)")).toHaveCount(0);
    await expect(marker(page, "Maison Bertaux (France)")).toBeVisible();

    // Nigeria and France have visit stamps; Ethiopia does not.
    await expect(marker(page, "Akoko (Nigeria)").locator(".etw-pin-stamped")).toHaveCount(1);
    await expect(marker(page, "Enish (Oxford Street) (Nigeria)").locator(".etw-pin-stamped")).toHaveCount(1);
    await expect(marker(page, "Zeret Kitchen (Ethiopia)").locator(".etw-pin-new")).toHaveCount(1);

    // Ringed means I have been: Akoko and the cafe, not Enish.
    await expect(page.locator(".leaflet-marker-icon .etw-ring")).toHaveCount(2);
    await expect(marker(page, "Akoko (Nigeria)").locator(".etw-ring")).toHaveCount(1);
    await expect(marker(page, "Maison Bertaux (France)").locator(".etw-ring")).toHaveCount(1);
    await expect(marker(page, "Enish (Oxford Street) (Nigeria)").locator(".etw-ring")).toHaveCount(0);
  });

  test("a pin opens a card in the first person, with the curator's flag, a visit link and details", async ({ page }) => {
    await open(page, "/map", POPULATED);

    await marker(page, "Akoko (Nigeria)").dispatchEvent("click");
    const card = page.getByRole("region", { name: "Akoko, Nigeria" });
    await expect(card).toBeVisible();
    await expect(card.getByText("You've been here")).toBeVisible();
    await expect(card.getByText("Already stamped")).toBeVisible();
    await expect(card.getByText("Contested pick")).toBeVisible();
    await expect(card.getByRole("link", { name: "Log a visit" })).toHaveAttribute("href", "#/check-in?restaurant=r-akoko");
    await expect(card.getByRole("link", { name: "Details" })).toHaveAttribute("href", "#/restaurant/r-akoko");

    // A suggestion I have not visited is logged against its seed id.
    await card.getByRole("button", { name: "Close" }).click();
    await marker(page, "Zeret Kitchen (Ethiopia)").dispatchEvent("click");
    const zeret = page.getByRole("region", { name: "Zeret Kitchen, Ethiopia" });
    await expect(zeret.getByText("New stamp for you")).toBeVisible();
    await expect(zeret.getByText("You've been here")).toHaveCount(0);
    await expect(zeret.getByRole("link", { name: "Log a visit" })).toHaveAttribute("href", `#/check-in?restaurant=${ZERET}`);
    await expect(zeret.getByRole("link", { name: "Details" })).toHaveAttribute("href", `#/restaurant/${ZERET}`);
    await expect(page.getByText(/friend/i)).toHaveCount(0);
  });

  test("the map fills the screen between the top bar and the bottom nav, and nothing scrolls", async ({ page }) => {
    await page.goto("./#/map");
    await expect(markers(page)).toHaveCount(seed.restaurants.length);

    const viewport = page.viewportSize()!;
    const map = await page.locator(".leaflet-container").boundingBox();
    const bar = await nav(page).boundingBox();
    const button = await page.getByRole("button", { name: "Nearest unstamped" }).boundingBox();
    expect(map!.y + map!.height).toBeCloseTo(bar!.y, 0);
    expect(button!.y + button!.height).toBeLessThanOrEqual(bar!.y);
    expect(button!.y).toBeGreaterThanOrEqual(map!.y);
    expect(bar!.y + bar!.height).toBeLessThanOrEqual(viewport.height + 0.5);

    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    expect(overflow).toEqual({ x: 0, y: 0 });
    // The nav still works over it.
    await nav(page).getByRole("link", { name: "World" }).click();
    await expect(page).toHaveURL(/#\/world$/);
  });

  test("Nearest unstamped finds the closest new country from where the phone is, and keeps the position to itself", async ({
    page,
    context,
  }) => {
    // Brixton. Nigeria and France are stamped, so the nearest new country is the nearest pin outside them.
    const here = { latitude: 51.4613, longitude: -0.1156 };
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(here);
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));

    await open(page, "/map", POPULATED);
    await expect(markers(page)).toHaveCount(seed.restaurants.length + 1);

    // Independent of the app: flat-earth distance is plenty at the scale of one city.
    const km = (lat: number, lon: number) =>
      Math.hypot((lat - here.latitude) * 111.2, (lon - here.longitude) * 111.2 * Math.cos((here.latitude * Math.PI) / 180));
    const nearest = seed.restaurants
      .filter((r) => !["NG", "FR"].includes(r.countryIso2))
      .sort((a, b) => km(a.lat, a.lon) - km(b.lat, b.lon))[0];

    await page.getByRole("button", { name: "Nearest unstamped" }).click();
    const country = seed.countries.find((c) => c.iso2 === nearest.countryIso2)!.name;
    const card = page.getByRole("region", { name: `${nearest.name}, ${country}` });
    await expect(card).toBeVisible();
    await expect(card).toContainText("away");
    await expect(card.getByText("New stamp for you")).toBeVisible();

    // The position was used to pick a pin and then dropped: not stored, not in any URL.
    const stored = await page.evaluate(async () => {
      const dump: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })];
      for (const { name } of await indexedDB.databases()) {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const request = indexedDB.open(name!);
          request.onsuccess = () => resolve(request.result);
        });
        for (const store of Array.from(db.objectStoreNames)) {
          const rows = await new Promise<unknown[]>((resolve) => {
            const request = db.transaction(store).objectStore(store).getAll();
            request.onsuccess = () => resolve(request.result);
          });
          dump.push(JSON.stringify(rows));
        }
        db.close();
      }
      return dump.join("\n");
    });
    for (const needle of ["51.4613", "-0.1156"]) {
      expect(stored).not.toContain(needle);
      expect(requested.filter((url) => url.includes(needle))).toEqual([]);
    }
    // Only this app and OpenStreetMap's tiles were ever contacted (every spec also checks this, in fixtures.ts).
    const appHost = new URL(page.url()).host;
    const hosts = new Set(requested.map((url) => new URL(url).host).filter(Boolean));
    expect([...hosts].filter((host) => host !== appHost && host !== "tile.openstreetmap.org")).toEqual([]);
  });

  test("with location refused, Nearest unstamped says what to do instead", async ({ page }) => {
    await page.goto("./#/map");
    await expect(markers(page)).toHaveCount(seed.restaurants.length);

    await page.getByRole("button", { name: "Nearest unstamped" }).click();
    await expect(page.getByText("Location is off")).toBeVisible();
    // Still a working map.
    await marker(page, "Zeret Kitchen (Ethiopia)").dispatchEvent("click");
    await expect(page.getByRole("region", { name: "Zeret Kitchen, Ethiopia" })).toBeVisible();
  });
});

test.describe("world", () => {
  const counts = (page: Page) => page.getByRole("list", { name: "Counts" });
  const section = (page: Page, name: string) => page.getByRole("region", { name });
  const mapReady = (page: Page) => page.locator('[role="application"][data-dots]');

  test("a fresh passport outlines the London list and marks nothing", async ({ page }) => {
    await page.goto("./#/world");

    await expect(page.getByRole("heading", { name: "World view" })).toBeAttached();
    await expect(mapReady(page)).toBeAttached();
    await expect(counts(page)).toContainText("0 stamped");
    await expect(counts(page)).toContainText(`${new Set(seed.restaurants.map((r) => r.countryIso2)).size} to go in London`);
    await expect(section(page, "Stamped")).toHaveCount(0);
    await expect(section(page, "To go in London").getByRole("listitem")).toHaveCount(39);
    await expect(page.getByText("No stamps yet")).toBeVisible();
  });

  test("stamped countries and memories are marked, and each opens its country page", async ({ page }) => {
    await open(page, "/world", POPULATED);

    await expect(mapReady(page)).toBeAttached();
    // Nigeria and France have visit stamps, Spain is a memory. Only Nigeria was also on the London list.
    await expect(counts(page)).toContainText("2 stamped");
    await expect(counts(page)).toContainText("1 before the app");
    await expect(counts(page)).toContainText("38 to go in London");

    const stamped = section(page, "Stamped");
    await expect(stamped.getByRole("link")).toHaveText(["France", "Nigeria"]);
    await expect(section(page, "Before the app").getByRole("link")).toHaveText(["Spain"]);
    const toGo = section(page, "To go in London");
    await expect(toGo.getByRole("listitem")).toHaveCount(38);
    await expect(toGo.getByRole("link", { name: "Nigeria" })).toHaveCount(0);
    await expect(toGo.getByRole("link", { name: "Ethiopia" })).toHaveAttribute("href", "#/country/ET");

    await stamped.getByRole("link", { name: "Nigeria" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Nigeria" })).toBeVisible();
  });

  test("small countries get a tap dot, and there is no group switcher in a one-person app", async ({ page }) => {
    await open(page, "/world", POPULATED);

    await expect(mapReady(page)).toBeAttached();
    const dots = (await mapReady(page).getAttribute("data-dots"))!.split(",");
    // Mauritius is on the London list and far too small to tap as a shape.
    expect(dots).toContain("MU");
    expect(dots).not.toContain("NG");

    await expect(page.getByRole("button", { name: "My stamps" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "My group" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Whose stamps" })).toBeHidden();
  });
});

// Every screen, as a phone shows it. Each test opens one at 390x844 from a populated passport, and a
// failure here is a blank, overflowing or erroring screen (the suite's fixtures fail any console error).
// The pictures go to docs/screens/solo/ so a person can read them against docs/design.md.
test.describe("every screen on a phone", () => {
  const SHOTS = path.resolve(__dirname, "../../docs/screens/solo");
  /** The day the pictures are taken on, so the dates and the 30-day backup reminder do not drift. */
  const TODAY = new Date("2026-10-22T10:00:00");

  const seedCopy = (id: string, seedId: string): SoloRestaurant => {
    const s = seed.restaurants.find((r) => r.id === seedId)!;
    return restaurant(id, s.name, s.countryIso2, { seedId, address: s.address, lat: s.lat, lon: s.lon });
  };
  const dishOf = (iso2: string, slug: string) => `seed:dish:${iso2}:${slug}`;

  /**
   * A passport a few weeks in. Six visit stamps: Nigeria (two places, one with no position), Ethiopia,
   * Somalia and Mauritius from copies of London suggestions, France and Japan from places added by hand.
   * Two countries were eaten before the app (Spain, Italy). Counted by hand: 6 / 249 countries, 4 / 39
   * London suggestions (Nigeria, Ethiopia, Somalia, Mauritius), 8 stamps anywhere. Fewer than ten new
   * records and none older than 30 days, so the backup reminder stays away.
   */
  const GALLERY = {
    restaurants: [
      seedCopy("r-akoko", AKOKO),
      restaurant("r-mums", "Mum's Kitchen", "NG"),
      seedCopy("r-zeret", ZERET),
      seedCopy("r-sabiib", "seed:sabiib-harringay-n4-1jx"),
      seedCopy("r-devi", "seed:devi-deluxe-n13-4sp"),
      restaurant("r-maison", "Maison Bertaux", "FR", { address: "28 Greek St, London", lat: 51.5133, lon: -0.1318 }),
      restaurant("r-koya", "Koya Soho", "JP", { address: "49 Frith St, London", lat: 51.5139, lon: -0.1319 }),
    ],
    visits: [
      visit("v-akoko", "r-akoko", "2026-09-28", { rating: 4, dishId: dishOf("NG", "jollof-rice"), note: "First time, and the jollof was smoky" }),
      visit("v-zeret", "r-zeret", "2026-10-01", { rating: 5, dishId: dishOf("ET", "kitfo") }),
      visit("v-sabiib", "r-sabiib", "2026-10-05", { rating: 3, dishId: dishOf("SO", "suqaar") }),
      visit("v-devi", "r-devi", "2026-10-08", { rating: 4, dishId: dishOf("MU", "dholl-puri") }),
      visit("v-mums", "r-mums", "2026-10-09", { rating: 5, dishOther: "Pepper soup" }),
      visit("v-maison", "r-maison", "2026-10-12", { dishOther: "Croque monsieur" }),
      visit("v-koya", "r-koya", "2026-10-15", { rating: 5, dishOther: "Udon", note: "Chewy, cold, perfect" }),
    ],
    backfills: [backfill("ES"), backfill("IT")],
  };

  const shoot = async (page: Page, name: string) => {
    await page.evaluate(() => document.fonts.ready);
    // A screen that is wider than the phone is a broken screen, even if nothing errors.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${name} is wider than the screen`).toBeLessThanOrEqual(0);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), scale: "css", animations: "disabled" });
  };

  /** Opens `hash` with the gallery passport in the phone, on the day the pictures are taken. */
  const show = async (page: Page, hash: string, data: Parameters<typeof injectData>[1] = GALLERY) => {
    await page.clock.setFixedTime(TODAY);
    await open(page, hash, data);
  };

  test("the passport, blank and with six stamps, and the numbers are the ones in the data", async ({ page }) => {
    await page.clock.setFixedTime(TODAY);
    await page.goto("./");
    await expect(page.getByRole("heading", { name: "Your passport is blank" })).toBeVisible();
    await shoot(page, "passport-blank");

    await show(page, "/");
    // The headline, counted from the rows in the browser's own database by plain loops, not by the app.
    const rows = await page.evaluate(
      (dbName) =>
        new Promise<{ restaurants: SoloRestaurant[]; visits: SoloVisit[]; backfills: Backfill[] }>((resolve, reject) => {
          const opening = indexedDB.open(dbName);
          opening.onerror = () => reject(opening.error);
          opening.onsuccess = () => {
            const db = opening.result;
            const out: Record<string, unknown[]> = {};
            const tx = db.transaction(["restaurants", "visits", "backfills"]);
            for (const store of ["restaurants", "visits", "backfills"]) {
              tx.objectStore(store).getAll().onsuccess = (e) => (out[store] = (e.target as IDBRequest).result);
            }
            tx.oncomplete = () => (db.close(), resolve(out as never));
          };
        }),
      DB_NAME,
    );
    const visited = new Set<string>();
    for (const v of rows.visits) for (const r of rows.restaurants) if (r.id === v.restaurantId) visited.add(r.countryIso2);
    const londonCountries = new Set<string>();
    for (const r of seed.restaurants) londonCountries.add(r.countryIso2);
    let london = 0;
    for (const iso2 of visited) if (londonCountries.has(iso2)) london++;
    const anywhere = new Set([...visited, ...rows.backfills.map((b) => b.countryIso2)]);
    // The same numbers, written down from reading the fixture above.
    expect([visited.size, london, anywhere.size, londonCountries.size, seed.countries.length]).toEqual([6, 4, 8, 39, 249]);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${visited.size} / ${seed.countries.length} countries`);
    await expect(page.getByRole("progressbar", { name: `${london} / ${londonCountries.size} London suggestions` })).toBeVisible();
    await expect(page.getByText("stamps anywhere")).toContainText(String(anywhere.size));
    await expect(page.getByRole("region", { name: "Your stamps" }).getByRole("img")).toHaveCount(anywhere.size);
    await expect(page.getByRole("note", { name: "Backup reminder" })).toHaveCount(0);
    await shoot(page, "passport");

    // Further down, where the region grid marks the stamped, remembered and London-listed countries.
    await page.getByRole("link", { name: "Stamped", exact: true }).click();
    await expect(page.getByRole("img", { name: /stamped|before the app/ })).toHaveCount(anywhere.size);
    await shoot(page, "passport-stamped-filter");
  });

  test("the backup reminder, once ten things are unsaved", async ({ page }) => {
    const extra = ["2026-10-16", "2026-10-17", "2026-10-18"].map((day, i) => visit(`v-more-${i}`, "r-akoko", day, { rating: 4 }));
    await show(page, "/", { ...GALLERY, visits: [...GALLERY.visits, ...extra] });

    await expect(page.getByRole("note", { name: "Backup reminder" })).toBeVisible();
    await shoot(page, "passport-backup-reminder");
  });

  test("backfill", async ({ page }) => {
    await show(page, "/backfill");
    await expect(page.getByRole("region", { name: "Popular" })).toBeVisible();
    await shoot(page, "backfill");
  });

  test("a country with a stamp, and one with London picks and nothing yet", async ({ page }) => {
    await show(page, "/country/NG");
    await expect(page.getByRole("heading", { level: 1, name: "Nigeria" })).toBeVisible();
    await shoot(page, "country-stamped");

    await show(page, "/country/ER");
    await expect(page.getByRole("heading", { level: 1, name: "Eritrea" })).toBeVisible();
    await shoot(page, "country-unvisited");
  });

  test("a restaurant I have been to, one I have not, and one I added with no position", async ({ page }) => {
    await show(page, "/restaurant/r-akoko");
    await expect(page.getByRole("heading", { level: 1, name: "Akoko" })).toBeVisible();
    await shoot(page, "restaurant-visited");

    await show(page, "/restaurant/seed:mosob-w9-3rb");
    await expect(page.getByRole("heading", { level: 1, name: "Mosob" })).toBeVisible();
    await shoot(page, "restaurant-unvisited");

    await show(page, "/restaurant/r-mums");
    await expect(page.getByRole("heading", { level: 1, name: "Mum's Kitchen" })).toBeVisible();
    await shoot(page, "restaurant-added-by-hand");
  });

  test("the map, and a pin's card", async ({ page }) => {
    await show(page, "/map");
    // The 68 suggestions, with my copies of four replacing theirs, plus the two places I added with a position.
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(seed.restaurants.length + 2);
    await shoot(page, "map");

    await page.locator('.leaflet-marker-icon[title="Zeret Kitchen (Ethiopia)"]').dispatchEvent("click");
    await expect(page.getByRole("region", { name: "Zeret Kitchen, Ethiopia" })).toBeVisible();
    await shoot(page, "map-card");
  });

  test("the world", async ({ page }) => {
    await show(page, "/world");
    await expect(page.locator('[role="application"][data-dots]')).toBeAttached();
    await expect(page.getByRole("region", { name: "Stamped" })).toBeVisible();
    await shoot(page, "world");
  });

  test("checking in: the list, a new place, the details, the stamp and the visit", async ({ page }) => {
    await show(page, "/check-in");
    await expect(page.getByRole("heading", { name: "Where did you eat?" })).toBeVisible();
    await shoot(page, "check-in-list");

    await page.getByRole("button", { name: "Add a place" }).click();
    await page.getByLabel("Name of the place").fill("Kiln");
    await page.getByRole("radio", { name: "Thailand" }).click();
    await shoot(page, "check-in-new-place");

    // The details of a suggestion, with a rating and a photo filled in.
    await page.goto("./#/check-in?restaurant=seed:mosob-w9-3rb");
    await expect(page.getByRole("heading", { name: "How was it?" })).toBeVisible();
    const plate = await sharp({ create: { width: 900, height: 675, channels: 3, background: "#b5835a" } }).jpeg().toBuffer();
    await page.getByTestId("photo-input").setInputFiles({ name: "plate.jpg", mimeType: "image/jpeg", buffer: plate });
    await expect(page.getByText("Photo ready")).toBeVisible();
    await page.getByRole("radio", { name: "4 stars" }).click();
    await shoot(page, "check-in-details");

    await page.getByRole("button", { name: "Save visit" }).click();
    await expect(page.getByRole("heading", { name: "Eritrea, stamped!" })).toBeVisible();
    await shoot(page, "stamp-moment");

    await page.getByRole("button", { name: "View this visit" }).click();
    await expect(page.getByRole("img", { name: /^The meal at / })).toBeVisible();
    await shoot(page, "visit");

    await page.getByRole("button", { name: "Edit visit" }).click();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
    await shoot(page, "visit-edit");
  });

  test("settings, and the import sheet", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "canShare", { value: () => false, configurable: true });
    });
    await show(page, "/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await shoot(page, "settings");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await shoot(page, "settings-about");
    await page.evaluate(() => window.scrollTo(0, 0));

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export backup" }).click(),
    ]);
    const saved = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(saved);
    await page.getByLabel("Backup file").setInputFiles(saved);
    await expect(page.getByRole("dialog", { name: "Import this backup" })).toBeVisible();
    await shoot(page, "settings-import");
  });

  test("a route that is nothing", async ({ page }) => {
    await page.goto("./#/nope");
    await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();
    await shoot(page, "not-found");
  });

  test.describe("a window that cannot store anything", () => {
    test.use({ ignoreErrors: /Eat the World: storage/ });

    test("says so, instead of opening a blank app", async ({ page }) => {
      await page.addInitScript(() => {
        indexedDB.open = () => {
          throw new DOMException("The operation is insecure.", "SecurityError");
        };
      });
      await page.goto("./");
      await expect(page.getByRole("heading", { name: "Storage is unavailable in this window" })).toBeVisible();
      await shoot(page, "storage-unavailable");
    });
  });
});
