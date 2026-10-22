import type { Page } from "@playwright/test";
import seed from "../../solo/src/data/seed.json";
import { expect, test } from "./fixtures";

// Where I am is optional. A place added without a fix is still a visit and a stamp; it is just not on the
// map, which only pins what has a position. These follow one new place from the "I'm here" button to the map.

const markers = (page: Page) => page.locator(".leaflet-marker-icon");
const marker = (page: Page, title: string) => page.locator(`.leaflet-marker-icon[title="${title}"]`);

/** Adds Maison Bertaux in France by hand, taps "I'm here", saves the visit and lands on the passport. */
async function addMaisonBertaux(page: Page) {
  await page.goto("./#/check-in");
  await page.getByRole("button", { name: "Add a place" }).click();
  await page.getByLabel("Name of the place").fill("Maison Bertaux");
  await page.getByRole("radio", { name: "France" }).click();
  await page.getByRole("button", { name: "I'm here" }).click();
}

async function saveAndOpenMap(page: Page) {
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Save visit" }).click();
  await expect(page.getByRole("heading", { name: "France, stamped!" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("1 / 249 countries");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Map" }).click();
  await expect(markers(page).first()).toBeVisible();
}

test("with location refused, the place is saved and stamped but is not on the map", async ({ page }) => {
  await addMaisonBertaux(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Couldn't get your location; you can still save" }),
  ).toBeVisible();
  await expect(page.getByText("Pin set")).toHaveCount(0);

  await saveAndOpenMap(page);

  // Only the London suggestions are pinned; the new place has no position to pin.
  await expect(markers(page)).toHaveCount(seed.restaurants.length);
  await expect(marker(page, "Maison Bertaux (France)")).toHaveCount(0);

  // It is not lost: the stamp and the visit are there.
  await page.goto("./#/country/FR");
  await expect(page.getByRole("heading", { level: 1, name: "France" })).toBeVisible();
  await expect(page.getByText(/^Stamped \d{1,2} \w+ \d{4}$/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Your visits" })).toContainText("Maison Bertaux");
});

test("with a fix near London, the new place is pinned on the map as somewhere I have been", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5133, longitude: -0.1318, accuracy: 10 });
  await addMaisonBertaux(page);
  await expect(page.getByText("Pin set")).toBeVisible();

  await saveAndOpenMap(page);

  await expect(markers(page)).toHaveCount(seed.restaurants.length + 1);
  const pin = marker(page, "Maison Bertaux (France)");
  await expect(pin).toBeVisible();
  await expect(pin.locator(".etw-ring")).toHaveCount(1);
  await expect(pin.locator(".etw-pin-stamped")).toHaveCount(1);
});
