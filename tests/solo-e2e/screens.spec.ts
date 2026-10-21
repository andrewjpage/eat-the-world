import type { Page } from "@playwright/test";
import seed from "../../solo/src/data/seed.json";
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
    await expect.poll(() => tileRequests.length).toBeGreaterThan(0);
    expect(tileRequests.every((url) => url.startsWith("https://tile.openstreetmap.org/"))).toBe(true);

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
    // Only this app and OpenStreetMap's tiles were ever contacted.
    const hosts = new Set(requested.map((url) => new URL(url).host).filter(Boolean));
    expect([...hosts].filter((host) => host !== "localhost:4173" && host !== "tile.openstreetmap.org")).toEqual([]);
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
