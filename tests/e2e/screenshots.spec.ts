import { test, type Page } from "@playwright/test";
import { admin, cleanupUsers, createUser, restaurantId, signIn } from "./helpers";

// Skipped in normal runs. Re-run after `npm run dev:fixtures`:  SCREENS=1 npx playwright test screenshots --grep @screens
const OUT = "docs/screens/M2";

test.afterAll(cleanupUsers);

async function shot(page: Page, name: string) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

test("M2 screenshots @screens", async ({ page }) => {
  test.skip(!process.env.SCREENS, "set SCREENS=1 to regenerate docs/screens/M2");
  test.setTimeout(180_000);
  await page.goto("/login");
  await shot(page, "login");

  const fresh = await createUser("shot", "New Friend");
  await signIn(page, fresh.email, "/");
  await shot(page, "passport-new-user");

  await signIn(page, "andrew@demo.local", "/");
  await shot(page, "passport-andrew");

  await page.goto("/country/LA");
  await shot(page, "country-LA");
  await page.goto(`/restaurant/${await restaurantId("Lao Café")}`);
  await shot(page, "restaurant-lao-cafe");
  await page.goto(`/restaurant/${await restaurantId("High Timber")}`);
  await shot(page, "restaurant-flagged-high-timber");

  const { data: g } = await admin().from("groups").select("id").eq("name", "Supper Club").single();
  await page.goto(`/group/${g!.id}`);
  await shot(page, "group-invite");
  await page.goto("/settings");
  await shot(page, "settings");

  await signIn(page, fresh.email, "/settings/backfill?onboarding=1");
  await shot(page, "backfill-onboarding");
});
