import type { Locator, Page } from "@playwright/test";
import { DB_NAME } from "../../solo/src/db/schema";
import type { Backfill, SoloRestaurant, SoloVisit } from "../../solo/src/domain/types";
import { expect, injectData, test } from "./fixtures";

const AKOKO = "seed:akoko-w1t-3lp";

/** A 1x1 PNG: a real image the page can decode, so the photo path runs for real. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==",
  "base64",
);

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

const AKOKO_COPY = restaurant("r-akoko", "Akoko", "NG", {
  seedId: AKOKO,
  address: "21 Berners St, London",
  lat: 51.517912,
  lon: -0.136752,
});

/** Opens the app once so it creates its database, writes the data, then opens `hash` on a fresh load. */
async function open(page: Page, hash: string, data: Parameters<typeof injectData>[1] = {}) {
  await page.goto("./");
  await injectData(page, data);
  await page.goto(`./#${hash}`);
  await page.reload();
}

/** Every record in one of the app's stores, read straight from IndexedDB. */
async function records<T>(page: Page, store: "restaurants" | "visits"): Promise<T[]> {
  return page.evaluate(
    ({ dbName, store }) =>
      new Promise<T[]>((resolve, reject) => {
        const opening = indexedDB.open(dbName);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const request = db.transaction(store).objectStore(store).getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result as T[]);
          };
        };
      }),
    { dbName: DB_NAME, store },
  );
}

async function photoCount(page: Page): Promise<number> {
  return page.evaluate(
    (dbName) =>
      new Promise<number>((resolve, reject) => {
        const opening = indexedDB.open(dbName);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const request = db.transaction("photos").objectStore("photos").count();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
        };
      }),
    DB_NAME,
  );
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const stamps = (page: Page) => page.getByRole("region", { name: "Your stamps" });
const headline = (page: Page) => page.getByRole("heading", { level: 1 });
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const alertToast = (page: Page, text: string | RegExp) => page.getByRole("alert").filter({ hasText: text });

/** Records every call to navigator.vibrate and navigator.storage.persist, which the real ones hide. */
async function spyOnDevice(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __vibrations: unknown[]; __persists: number };
    w.__vibrations = [];
    w.__persists = 0;
    navigator.vibrate = (pattern) => (w.__vibrations.push(pattern), true);
    navigator.storage.persist = async () => (w.__persists++, true);
  });
  return {
    vibrations: () => page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations),
    persists: () => page.evaluate(() => (window as unknown as { __persists: number }).__persists),
  };
}

test.describe("logging a visit at a London suggestion", () => {
  test("takes four taps from the passport to the stamp, which is then there after a reload", async ({ page }) => {
    const device = await spyOnDevice(page);
    await page.goto("./");
    let taps = 0;
    const tap = async (target: Locator) => {
      taps++;
      await target.click();
    };

    await tap(nav(page).getByRole("link", { name: "Check in" }));
    await expect(page.getByRole("heading", { name: "Where did you eat?" })).toBeVisible();
    // The suggestions are listed without typing, and no nav is there for a stray thumb to leave by.
    await expect(nav(page)).toHaveCount(0);
    await tap(page.getByRole("button", { name: /^Akoko/ }));
    await expect(page.getByRole("heading", { name: "How was it?" })).toBeVisible();
    await tap(page.getByRole("button", { name: "Save visit" }));

    // The stamp moment: the country, the copy, a buzz.
    await expect(page.getByRole("heading", { name: "Nigeria, stamped!" })).toBeVisible();
    await expect(page.getByText("Your first meal from here is in your passport.")).toBeVisible();
    await expect(page.getByRole("img", { name: /^Nigeria, stamped/ })).toBeVisible();
    expect(await device.vibrations()).toEqual([40]);
    await tap(page.getByRole("button", { name: "Done" }));

    expect(taps).toBe(4);
    await expect(page).toHaveURL(/#\/$/);
    await expect(headline(page)).toHaveText("1 / 249 countries");
    await expect(stamps(page).getByRole("img", { name: /^Nigeria, stamped/ })).toBeVisible();

    await page.reload();
    await expect(stamps(page).getByRole("img", { name: /^Nigeria, stamped/ })).toBeVisible();
    // The suggestion was copied into my restaurants, with its place in the world.
    expect(await records<SoloRestaurant>(page, "restaurants")).toEqual([
      expect.objectContaining({ seedId: AKOKO, name: "Akoko", countryIso2: "NG", lat: 51.517912, lon: -0.136752 }),
    ]);
  });

  test("asks the browser to keep the data once, after the first visit only", async ({ page }) => {
    const device = await spyOnDevice(page);
    await page.goto("./#/check-in?restaurant=" + AKOKO);
    expect(await device.persists()).toBe(0);

    await page.getByRole("button", { name: "Save visit" }).click();
    await expect(page.getByRole("heading", { name: "Nigeria, stamped!" })).toBeVisible();
    await expect.poll(device.persists).toBe(1);

    await page.getByRole("button", { name: "Done" }).click();
    // Wait for the passport to be drawn, not just for the URL, before opening the flow again.
    await expect(headline(page)).toHaveText("1 / 249 countries");
    await page.goto("./#/check-in?restaurant=" + AKOKO);
    await page.getByRole("button", { name: "Save visit" }).click();
    await expect(page.getByRole("heading", { name: "More Nigeria" })).toBeVisible();
    expect(await device.persists()).toBe(1);
  });

  test("a second visit is a repeat, and the buzz is shorter", async ({ page }) => {
    const device = await spyOnDevice(page);
    await open(page, "/check-in?restaurant=r-akoko", {
      restaurants: [AKOKO_COPY],
      visits: [visit("v-old", "r-akoko", "2026-10-03")],
    });

    await page.getByRole("button", { name: "Save visit" }).click();

    await expect(page.getByRole("heading", { name: "More Nigeria" })).toBeVisible();
    await expect(page.getByText("The stamp was already yours.")).toBeVisible();
    expect(await device.vibrations()).toEqual([15]);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(headline(page)).toHaveText("1 / 249 countries");
  });

  test("a before-the-app memory becomes a full stamp", async ({ page }) => {
    await open(page, "/check-in?restaurant=" + AKOKO, {
      backfills: [{ countryIso2: "NG", createdAt: "2026-10-02T09:00:00.000Z" } satisfies Backfill],
    });

    await page.getByRole("button", { name: "Save visit" }).click();

    await expect(page.getByRole("heading", { name: "Nigeria upgraded!" })).toBeVisible();
    await expect(page.getByText("Your before-the-app memory is now a full stamp.")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(headline(page)).toHaveText("1 / 249 countries");
  });

  test("records the dish, rating, note and date I gave it", async ({ page }) => {
    await page.goto("./#/check-in?restaurant=" + AKOKO);

    await page.getByRole("radio", { name: "Suya" }).click();
    await page.getByRole("radio", { name: "4 stars" }).click();
    await page.getByLabel(/A note/).fill("Smoky, sit by the window");
    await page.getByRole("button", { name: "Save visit" }).click();
    await page.getByRole("button", { name: "View this visit" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Akoko" })).toBeVisible();
    await expect(page.getByText("Suya")).toBeVisible();
    await expect(page.getByText("Smoky, sit by the window")).toBeVisible();
    await expect(page.getByRole("img", { name: "4.0 out of 5" })).toBeVisible();
    const [saved] = await records<SoloVisit>(page, "visits");
    expect(saved).toMatchObject({ dishId: expect.stringContaining("suya"), rating: 4, note: "Smoky, sit by the window" });
  });

  test("a link by suggestion id, by my copy's id or by country all reach the same place without a second copy", async ({ page }) => {
    await open(page, "/", { restaurants: [AKOKO_COPY], visits: [visit("v-old", "r-akoko", "2026-10-03")] });

    for (const link of [`restaurant=${AKOKO}`, "restaurant=r-akoko"]) {
      await page.goto(`./#/check-in?${link}`);
      await expect(page.getByRole("heading", { name: "How was it?" })).toBeVisible();
      await expect(page.getByText("Akoko", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Save visit" }).click();
      await expect(page.getByRole("heading", { name: "More Nigeria" })).toBeVisible();
      await page.getByRole("button", { name: "Done" }).click();
    }

    expect(await records<SoloRestaurant>(page, "restaurants")).toHaveLength(1);
    expect(await records<SoloVisit>(page, "visits")).toHaveLength(3);

    // From the Where step, the copy is listed once, as mine, marked as somewhere I have been.
    await page.goto("./#/check-in");
    await expect(page.getByRole("button", { name: /^Akoko/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Akoko.*Been here/ })).toHaveCount(1);
  });

  test("a country link lists only that country's places, with a way back to all of them", async ({ page }) => {
    await page.goto("./#/check-in?country=NG");

    await expect(page.getByText("Showing places in Nigeria.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Akoko/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Zeret Kitchen/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Show all" }).click();
    await page.getByLabel("Search places").fill("zeret");
    await expect(page.getByRole("button", { name: /^Zeret Kitchen/ })).toBeVisible();
  });

  test("searches by name, country or postcode", async ({ page }) => {
    await page.goto("./#/check-in");
    const search = page.getByLabel("Search places");

    await search.fill("zeret");
    await expect(page.getByRole("button", { name: /Zeret Kitchen/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Akoko/ })).toHaveCount(0);

    await search.fill("w1t 3lp");
    await expect(page.getByRole("button", { name: /^Akoko/ })).toBeVisible();

    await search.fill("ghana");
    await expect(page.getByRole("button", { name: /^Asafo/ })).toBeVisible();
  });
});

test.describe("the date", () => {
  test("a backdated visit puts the earlier date on the stamp", async ({ page }) => {
    await page.goto("./#/check-in?restaurant=" + AKOKO);

    await page.getByLabel("When").fill("2020-03-05");
    await expect(page.getByText("Writing it up afterwards is fine.")).toBeVisible();
    await page.getByRole("button", { name: "Save visit" }).click();

    await expect(page.getByRole("img", { name: /05 MAR 2020/ })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page).toHaveURL(/#\/$/);
    await page.goto("./#/country/NG");
    await expect(page.getByText("Stamped 5 Mar 2020")).toBeVisible();
    const [saved] = await records<SoloVisit>(page, "visits");
    expect(saved.visitedOn).toBe("2020-03-05");
  });

  test("a date in the future is refused in plain words, and nothing is saved", async ({ page }) => {
    await page.goto("./#/check-in?restaurant=" + AKOKO);

    await page.getByLabel("When").fill("2999-01-01");
    await page.getByRole("button", { name: "Save visit" }).click();

    await expect(alertToast(page, "That date is in the future. Pick today or earlier.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "How was it?" })).toBeVisible();
    expect(await records<SoloVisit>(page, "visits")).toEqual([]);
    expect(await records<SoloRestaurant>(page, "restaurants")).toEqual([]);

    // Fixing the date and saving again works.
    await page.getByLabel("When").fill("2020-03-05");
    await page.getByRole("button", { name: "Save visit" }).click();
    await expect(page.getByRole("heading", { name: "Nigeria, stamped!" })).toBeVisible();
  });
});

test.describe("adding a place that is not on the list", () => {
  test("takes a name, a chosen country and an address, and stamps that country", async ({ page }) => {
    await page.goto("./#/check-in");

    await page.getByRole("button", { name: "Add a place" }).click();
    await expect(page.getByRole("heading", { name: "Add a place" })).toBeVisible();
    await expect(page.getByText("The bulk of the menu should be this country's cuisine.")).toBeVisible();
    const next = page.getByRole("button", { name: "Next" });
    await expect(next).toBeDisabled();

    await page.getByLabel("Name of the place").fill("Bar Tomás");
    await expect(next).toBeDisabled(); // a country is needed too
    await page.getByRole("radio", { name: "Spain" }).click();
    await page.getByLabel(/Address/).fill("12 Calle Mayor");
    await next.click();

    // The details step shows the place and Spain's own (empty) dish list.
    await expect(page.getByText("Bar Tomás")).toBeVisible();
    await expect(page.getByText("No signature dishes listed for Spain yet.")).toBeVisible();
    await page.getByRole("button", { name: "Save visit" }).click();

    await expect(page.getByRole("heading", { name: "Spain, stamped!" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(stamps(page).getByRole("img", { name: /^Spain, stamped/ })).toBeVisible();
    // Not on the London list, so the "N / 39 London" bar stays at nothing.
    await expect(page.getByRole("progressbar", { name: "0 / 39 London suggestions" })).toBeVisible();

    expect(await records<SoloRestaurant>(page, "restaurants")).toEqual([
      expect.objectContaining({ seedId: null, name: "Bar Tomás", countryIso2: "ES", address: "12 Calle Mayor", lat: null, lon: null }),
    ]);
  });

  test("if the visit does not save, trying again reuses the place that was written instead of adding it twice", async ({ page }) => {
    // The browser refuses the first write to the visits store; the restaurant went in just before it.
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      let refused = false;
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
        if (this.name === "visits" && !refused) {
          refused = true;
          throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        }
        return put.apply(this, args);
      };
    });
    await page.goto("./#/check-in");
    await page.getByRole("button", { name: "Add a place" }).click();
    await page.getByLabel("Name of the place").fill("Bar Tomás");
    await page.getByRole("radio", { name: "Spain" }).click();
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByRole("button", { name: "Save visit" }).click();
    await expect(alertToast(page, "Couldn't save the visit. Try again.")).toBeVisible();
    expect(await records<SoloVisit>(page, "visits")).toEqual([]);
    expect(await records<SoloRestaurant>(page, "restaurants")).toHaveLength(1);

    await page.getByRole("button", { name: "Save visit" }).click();
    await expect(page.getByRole("heading", { name: "Spain, stamped!" })).toBeVisible();

    const places = await records<SoloRestaurant>(page, "restaurants");
    expect(places.map((r) => r.name)).toEqual(["Bar Tomás"]);
    expect(await records<SoloVisit>(page, "visits")).toEqual([expect.objectContaining({ restaurantId: places[0].id })]);
  });

  test("starts from what was typed in the search, and from the country in the link", async ({ page }) => {
    await page.goto("./#/check-in?country=TR");
    await page.getByLabel("Search places").fill("Kebab Corner");
    await page.getByRole("button", { name: "Add a place" }).click();

    await expect(page.getByLabel("Name of the place")).toHaveValue("Kebab Corner");
    // The country from the link is already chosen, so it shows as a single row rather than a list to pick from.
    await expect(page.getByRole("radiogroup", { name: "Country" })).toHaveCount(0);
    await expect(page.getByText("Turkey", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  test("'I'm here' pins the new place and nothing else", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 51.5133, longitude: -0.1318, accuracy: 10 });
    await page.goto("./#/check-in");
    await page.getByRole("button", { name: "Add a place" }).click();
    await page.getByLabel("Name of the place").fill("Maison Bertaux");
    await page.getByRole("radio", { name: "France" }).click();

    await page.getByRole("button", { name: "I'm here" }).click();
    await expect(page.getByText("Pin set")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Save visit" }).click();
    await expect(page.getByRole("heading", { name: "France, stamped!" })).toBeVisible();

    const [saved] = await records<SoloRestaurant>(page, "restaurants");
    expect(saved).toMatchObject({ name: "Maison Bertaux", countryIso2: "FR" });
    expect(saved.lat).toBeCloseTo(51.5133, 3);
    expect(saved.lon).toBeCloseTo(-0.1318, 3);
    // The visit itself carries no position.
    expect(Object.keys((await records<SoloVisit>(page, "visits"))[0]).sort()).toEqual(
      ["createdAt", "dishId", "dishOther", "id", "note", "photoId", "rating", "restaurantId", "visitedOn"],
    );
  });

  test("if location is refused, a toast says so and the form carries on without a pin", async ({ page }) => {
    await page.goto("./#/check-in");
    await page.getByRole("button", { name: "Add a place" }).click();
    await page.getByLabel("Name of the place").fill("Maison Bertaux");
    await page.getByRole("radio", { name: "France" }).click();

    await page.getByRole("button", { name: "I'm here" }).click();

    await expect(toast(page, "Couldn't get your location; you can still save")).toBeVisible();
    await expect(page.getByText("Pin set")).toHaveCount(0);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Save visit" }).click();
    await expect(page.getByRole("heading", { name: "France, stamped!" })).toBeVisible();
    expect(await records<SoloRestaurant>(page, "restaurants")).toEqual([
      expect.objectContaining({ name: "Maison Bertaux", lat: null, lon: null }),
    ]);
  });

  test("if location never answers, it gives up after eight seconds and the form is still usable", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = () => {}; // a phone that never answers
    });
    await page.clock.install();
    await page.goto("./#/check-in");
    await page.getByRole("button", { name: "Add a place" }).click();
    await page.getByLabel("Name of the place").fill("Maison Bertaux");
    await page.getByRole("radio", { name: "France" }).click();

    await page.getByRole("button", { name: "I'm here" }).click();
    await expect(page.getByRole("button", { name: "I'm here" })).toBeDisabled();
    await page.clock.fastForward(7_900);
    await expect(toast(page, "Couldn't get your location")).toHaveCount(0);
    await page.clock.fastForward(200);

    await expect(toast(page, "Couldn't get your location; you can still save")).toBeVisible();
    await expect(page.getByRole("button", { name: "I'm here" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  test("typing while the location is being found is not undone when it arrives", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
    await page.goto("./#/check-in");
    await page.getByRole("button", { name: "Add a place" }).click();
    await page.getByRole("radio", { name: "France" }).click();

    await page.getByRole("button", { name: "I'm here" }).click();
    await page.getByLabel("Name of the place").fill("Typed straight after the tap");

    await expect(page.getByText("Pin set")).toBeVisible();
    await expect(page.getByLabel("Name of the place")).toHaveValue("Typed straight after the tap");
  });
});

test.describe("Near me", () => {
  test("puts the closest place first with its distance, and keeps nothing else", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    // A few metres from Zeret Kitchen in Camberwell.
    await context.setGeolocation({ latitude: 51.4785, longitude: -0.0949, accuracy: 10 });
    await page.goto("./#/check-in");

    await page.getByRole("button", { name: "Near me" }).click();

    const first = page.getByRole("list", { name: "Places" }).getByRole("button").first();
    await expect(first).toContainText("Zeret Kitchen");
    await expect(first).toContainText(/\d+ m/);
    await first.click();
    await expect(page.getByRole("heading", { name: "How was it?" })).toBeVisible();
    await expect(page.getByText("Zeret Kitchen")).toBeVisible();
  });

  test("if location is refused, a toast points to search", async ({ page }) => {
    await page.goto("./#/check-in");

    await page.getByRole("button", { name: "Near me" }).click();

    await expect(toast(page, "Couldn't get your location. Search for the place instead.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Akoko/ })).toBeVisible();
  });
});

test.describe("photos", () => {
  test("a photo is shrunk, saved with the visit and shown on the visit page", async ({ page }) => {
    await page.goto("./#/check-in?restaurant=" + AKOKO);

    await page.getByTestId("photo-input").setInputFiles({ name: "plate.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("Photo ready")).toBeVisible();
    await page.getByRole("button", { name: "Save visit" }).click();
    await page.getByRole("button", { name: "View this visit" }).click();

    const image = page.getByRole("img", { name: "The meal at Akoko" });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    expect(await photoCount(page)).toBe(1);
    const [saved] = await records<SoloVisit>(page, "visits");
    expect(saved.photoId).toEqual(expect.any(String));
  });

  test("a file that is not a picture is a toast, and the visit still saves without it", async ({ page }) => {
    await page.goto("./#/check-in?restaurant=" + AKOKO);

    await page.getByTestId("photo-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });

    await expect(alertToast(page, "That doesn't look like a photo.")).toBeVisible();
    await expect(page.getByText("Snap the plate")).toBeVisible();
    await page.getByRole("button", { name: "Save visit" }).click();
    await expect(page.getByRole("heading", { name: "Nigeria, stamped!" })).toBeVisible();
    expect(await photoCount(page)).toBe(0);
    expect(await records<SoloVisit>(page, "visits")).toHaveLength(1);
  });

  test("a photo the phone has no room for is a toast, and the visit still saves without it", async ({ page }) => {
    // What a full phone does: the browser refuses the write to the photos store, and only that one.
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
        if (this.name === "photos") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        return put.apply(this, args);
      };
    });
    await page.goto("./#/check-in?restaurant=" + AKOKO);
    await page.getByTestId("photo-input").setInputFiles({ name: "plate.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("Photo ready")).toBeVisible();

    await page.getByRole("button", { name: "Save visit" }).click();

    await expect(alertToast(page, "Visit saved, but the photo wouldn't fit on this phone")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nigeria, stamped!" })).toBeVisible();
    expect(await photoCount(page)).toBe(0);
    const [saved] = await records<SoloVisit>(page, "visits");
    expect(saved.photoId).toBeNull();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(headline(page)).toHaveText("1 / 249 countries");
  });

  test("a photo can be taken back out before saving", async ({ page }) => {
    await page.goto("./#/check-in?restaurant=" + AKOKO);
    await page.getByTestId("photo-input").setInputFiles({ name: "plate.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("Photo ready")).toBeVisible();

    await page.getByRole("button", { name: "Remove" }).click();

    await expect(page.getByText("Snap the plate")).toBeVisible();
    await page.getByRole("button", { name: "Save visit" }).click();
    await expect(page.getByRole("heading", { name: "Nigeria, stamped!" })).toBeVisible();
    expect(await photoCount(page)).toBe(0);
  });
});

test.describe("the flow's own navigation", () => {
  test("Back steps through the flow and then leaves it", async ({ page }) => {
    await page.goto("./#/world");
    await nav(page).getByRole("link", { name: "Check in" }).click();
    await page.getByRole("button", { name: /^Akoko/ }).click();
    await expect(page.getByRole("heading", { name: "How was it?" })).toBeVisible();

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Where did you eat?" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/#\/world$/);
    await expect(nav(page)).toBeVisible();
  });

  test("Change on the details goes back to the list and a different place can be picked", async ({ page }) => {
    await page.goto("./#/check-in?restaurant=" + AKOKO);

    await page.getByRole("button", { name: "Change" }).click();
    await page.getByRole("button", { name: /^Asafo/ }).click();

    await expect(page.getByText("Asafo")).toBeVisible();
    await page.getByRole("button", { name: "Save visit" }).click();
    await expect(page.getByRole("heading", { name: "Ghana, stamped!" })).toBeVisible();
  });

  test("the details start at the top, even when the list was scrolled to pick the place", async ({ page }) => {
    await page.goto("./#/check-in");
    await expect(page.getByRole("button", { name: /^Bali Bali/ })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

    await page.getByRole("button", { name: /^Bali Bali/ }).click();

    await expect(page.getByRole("heading", { name: "How was it?" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("a different place in another country drops the dish, which belonged to the first country's list", async ({ page }) => {
    await page.goto("./#/check-in?restaurant=" + AKOKO);
    await page.getByRole("radio", { name: "Suya" }).click();
    await page.getByRole("radio", { name: "5 stars" }).click();

    await page.getByRole("button", { name: "Change" }).click();
    await page.getByRole("button", { name: /^Asafo/ }).click();

    await expect(page.getByRole("radio", { name: "Suya" })).toHaveCount(0);
    await expect(page.getByRole("radio", { checked: true, name: "Something else" })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "5 stars" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Save visit" }).click();
    await expect(page.getByRole("heading", { name: "Ghana, stamped!" })).toBeVisible();
    const [saved] = await records<SoloVisit>(page, "visits");
    expect(saved).toMatchObject({ dishId: null, dishOther: null, rating: 5 });
  });

  test("Back from the details of a place picked on its own page returns to that page", async ({ page }) => {
    await page.goto("./#/restaurant/" + AKOKO);

    await page.getByRole("link", { name: "Log a visit" }).click();
    await expect(page.getByRole("heading", { name: "How was it?" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();

    await expect(page).toHaveURL(/#\/restaurant\/seed:akoko/);
    await expect(page.getByRole("heading", { level: 1, name: "Akoko" })).toBeVisible();
  });

  test("viewing the saved visit and going Back does not return to a blank check-in", async ({ page }) => {
    await page.goto("./");
    await nav(page).getByRole("link", { name: "Check in" }).click();
    await page.getByRole("button", { name: /^Akoko/ }).click();
    await page.getByRole("button", { name: "Save visit" }).click();
    await page.getByRole("button", { name: "View this visit" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Akoko" })).toBeVisible();

    await page.goBack();

    // Back to where the check-in was started: the passport, not the form.
    await expect(headline(page)).toHaveText("1 / 249 countries");
    await expect(page.getByRole("heading", { name: "Where did you eat?" })).toHaveCount(0);
  });

  test("an unknown restaurant link starts at the list instead of failing", async ({ page }) => {
    await page.goto("./#/check-in?restaurant=nope");
    await expect(page.getByRole("heading", { name: "Where did you eat?" })).toBeVisible();
  });

  test("a double tap on Save makes one visit", async ({ page }) => {
    await page.goto("./#/check-in?restaurant=" + AKOKO);

    await page.getByRole("button", { name: "Save visit" }).dblclick();

    await expect(page.getByRole("heading", { name: "Nigeria, stamped!" })).toBeVisible();
    expect(await records<SoloVisit>(page, "visits")).toHaveLength(1);
  });
});

test.describe("the visit page", () => {
  const POPULATED = {
    restaurants: [AKOKO_COPY],
    visits: [visit("v-akoko", "r-akoko", "2026-10-03", { rating: 4, dishId: "seed:dish:NG:jollof-rice", note: "First time" })],
  };

  test("shows the restaurant, country, date, dish, rating and note", async ({ page }) => {
    await open(page, "/visit/v-akoko", POPULATED);

    await expect(page.getByRole("heading", { level: 1, name: "Akoko" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Nigeria" })).toHaveAttribute("href", "#/country/NG");
    await expect(page.getByText("3 Oct 2026")).toBeVisible();
    await expect(page.getByText("Jollof Rice")).toBeVisible();
    await expect(page.getByText("First time")).toBeVisible();
    await expect(page.getByRole("img", { name: "4.0 out of 5" })).toBeVisible();
    await expect(page.getByText("Earned your Nigeria stamp")).toBeVisible();
  });

  test("an unknown visit is a quiet 'No such visit', not a crash", async ({ page }) => {
    await page.goto("./#/visit/nope");

    await expect(page.getByRole("heading", { name: "No such visit" })).toBeVisible();
    await page.getByRole("link", { name: "Back to my passport" }).click();
    await expect(page).toHaveURL(/#\/$/);
  });

  test("edits the date, dish, rating, note and photo; the stamp date follows", async ({ page }) => {
    await open(page, "/visit/v-akoko", POPULATED);

    await page.getByRole("button", { name: "Edit visit" }).click();
    await page.getByLabel("When").fill("2026-10-01");
    await page.getByRole("radio", { name: "Suya" }).click();
    await page.getByRole("radio", { name: "5 stars" }).click();
    await page.getByLabel(/A note/).fill("Even better the second time");
    await page.getByTestId("photo-input").setInputFiles({ name: "plate.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("Photo ready")).toBeVisible();
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(toast(page, "Saved")).toBeVisible();
    await expect(page.getByText("1 Oct 2026")).toBeVisible();
    await expect(page.getByText("Suya")).toBeVisible();
    await expect(page.getByText("Even better the second time")).toBeVisible();
    await expect(page.getByRole("img", { name: "5.0 out of 5" })).toBeVisible();
    const image = page.getByRole("img", { name: "The meal at Akoko" });
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    expect(await photoCount(page)).toBe(1);

    // Stamps are derived, so the country page already shows the earlier date.
    await page.goto("./#/country/NG");
    await expect(page.getByText("Stamped 1 Oct 2026")).toBeVisible();
  });

  test("a bad edit is refused with a reason and changes nothing", async ({ page }) => {
    await open(page, "/visit/v-akoko", POPULATED);

    await page.getByRole("button", { name: "Edit visit" }).click();
    await page.getByLabel("When").fill("2999-01-01");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(alertToast(page, "That date is in the future. Pick today or earlier.")).toBeVisible();
    expect((await records<SoloVisit>(page, "visits"))[0].visitedOn).toBe("2026-10-03");
    // Still editing, so the person can fix it.
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("3 Oct 2026")).toBeVisible();
  });

  test("a photo can be removed, which also removes it from the phone", async ({ page }) => {
    await open(page, "/visit/v-akoko", POPULATED);
    await page.getByRole("button", { name: "Edit visit" }).click();
    await page.getByTestId("photo-input").setInputFiles({ name: "plate.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page, "Saved")).toBeVisible();
    expect(await photoCount(page)).toBe(1);

    await page.getByRole("button", { name: "Edit visit" }).click();
    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByRole("img", { name: "The meal at Akoko" })).toHaveCount(0);
    await expect.poll(() => photoCount(page)).toBe(0);
    expect((await records<SoloVisit>(page, "visits"))[0].photoId).toBeNull();
  });

  test("changing the place's country moves the stamp with it", async ({ page }) => {
    await open(page, "/visit/v-akoko", POPULATED);

    await page.getByRole("button", { name: "Change place details" }).click();
    const sheet = page.getByRole("dialog", { name: "Change place details" });
    await sheet.getByLabel("Name of the place").fill("Akoko Berners Street");
    await sheet.getByRole("button", { name: "Change" }).click();
    await sheet.getByLabel("Search countries").fill("ghana");
    await sheet.getByRole("radio", { name: "Ghana" }).click();
    await sheet.getByRole("button", { name: "Save place" }).click();

    await expect(toast(page, "Place updated")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Akoko Berners Street" })).toBeVisible();
    await expect(page.getByText("Earned your Ghana stamp")).toBeVisible();
    await page.goto("./#/");
    await expect(stamps(page).getByRole("img", { name: /^Ghana, stamped/ })).toBeVisible();
    await expect(stamps(page).getByRole("img", { name: /^Nigeria/ })).toHaveCount(0);
  });

  test("deleting asks first, says what happens to the stamp, then removes the visit and its photo", async ({ page }) => {
    await open(page, "/visit/v-akoko", POPULATED);
    await page.getByRole("button", { name: "Edit visit" }).click();
    await page.getByTestId("photo-input").setInputFiles({ name: "plate.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page, "Saved")).toBeVisible();

    await page.getByRole("button", { name: "Delete visit" }).click();
    const sheet = page.getByRole("dialog", { name: "Delete this visit?" });
    await expect(sheet.getByText("Nigeria will lose its stamp.")).toBeVisible();
    await sheet.getByRole("button", { name: "Keep it" }).click();
    await expect(sheet).toBeHidden();
    expect(await records<SoloVisit>(page, "visits")).toHaveLength(1);

    await page.getByRole("button", { name: "Delete visit" }).click();
    await page.getByRole("dialog", { name: "Delete this visit?" }).getByRole("button", { name: "Delete visit" }).click();

    await expect(page).toHaveURL(/#\/$/);
    await expect(toast(page, "Visit deleted")).toBeVisible();
    await expect(headline(page)).toHaveText("0 / 249 countries");
    expect(await records<SoloVisit>(page, "visits")).toEqual([]);
    expect(await photoCount(page)).toBe(0);
    await page.goto("./#/visit/v-akoko");
    await expect(page.getByRole("heading", { name: "No such visit" })).toBeVisible();
  });

  test("deleting the visit that holds the stamp hands it to the next visit in the country", async ({ page }) => {
    await open(page, "/visit/v-first", {
      restaurants: [AKOKO_COPY],
      visits: [visit("v-first", "r-akoko", "2026-10-01"), visit("v-later", "r-akoko", "2026-10-09")],
    });

    await page.getByRole("button", { name: "Delete visit" }).click();
    const sheet = page.getByRole("dialog", { name: "Delete this visit?" });
    await expect(sheet.getByText("The Nigeria stamp moves to 9 Oct 2026.")).toBeVisible();
    await sheet.getByRole("button", { name: "Delete visit" }).click();

    await expect(page).toHaveURL(/#\/$/);
    await expect(headline(page)).toHaveText("1 / 249 countries");
    await page.goto("./#/country/NG");
    await expect(page.getByText("Stamped 9 Oct 2026")).toBeVisible();
  });

  test("deleting the only visit to a country eaten before the app turns its stamp back into a memory", async ({ page }) => {
    await open(page, "/visit/v-akoko", {
      restaurants: [AKOKO_COPY],
      visits: [visit("v-akoko", "r-akoko", "2026-10-03")],
      backfills: [{ countryIso2: "NG", createdAt: "2026-10-02T09:00:00.000Z" } satisfies Backfill],
    });

    await page.getByRole("button", { name: "Delete visit" }).click();
    const sheet = page.getByRole("dialog", { name: "Delete this visit?" });
    await expect(sheet.getByText("Nigeria goes back to a faded before-the-app memory.")).toBeVisible();
    await sheet.getByRole("button", { name: "Delete visit" }).click();

    await expect(headline(page)).toHaveText("0 / 249 countries");
    await expect(stamps(page).getByRole("img", { name: "Nigeria, before the app" })).toBeVisible();
  });

  test("a visit to a place with no known position still opens", async ({ page }) => {
    await open(page, "/visit/v-mums", {
      restaurants: [restaurant("r-mums", "Mum's Kitchen", "NG")],
      visits: [visit("v-mums", "r-mums", "2026-10-09", { dishOther: "Pepper soup" })],
    });

    await expect(page.getByRole("heading", { level: 1, name: "Mum's Kitchen" })).toBeVisible();
    await expect(page.getByText("Pepper soup")).toBeVisible();
  });
});
