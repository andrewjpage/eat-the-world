import { expect, test, type Page } from "@playwright/test";
import { admin, cleanupUsers, createUser } from "./helpers";
import { table } from "./m4-helpers";
import { phone, shot } from "./phone";

const OUT = "docs/screens/M6";
const RESTAURANT = `E2E Ramen ${Date.now()}`;
const POSTCODE = "N1 9AB";

/** Take back everything the suggestion flow and the status toggle changed. */
async function undo() {
  const a = admin();
  await a.from("submissions").delete().like("name", "E2E Ramen%");
  await a.from("restaurants").delete().like("name", "E2E Ramen%");
  const { data: city } = await a.from("cities").select("id").eq("slug", "london").single();
  await a
    .from("city_countries")
    .update({ status: "unlisted" })
    .eq("city_id", city!.id)
    .in("country_iso2", ["GL", "JP"])
    .eq("status", "uncharted");
}

test.beforeAll(undo);
test.afterAll(async () => {
  await undo();
  await cleanupUsers();
});

async function curatorUser(label: string) {
  const u = await createUser(label, "Curator Cass");
  const { error } = await admin().from("profiles").update({ is_curator: true }).eq("user_id", u.id);
  if (error) throw new Error(`make curator: ${error.message}`);
  return u;
}

async function suggest(page: Page, name: string, postcode = POSTCODE) {
  await page.getByRole("button", { name: "Suggest a restaurant" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name", { exact: true }).fill(name);
  await sheet.getByLabel("Address").fill("1 Test Street");
  await sheet.getByLabel("Postcode").fill(postcode);
  await sheet.getByLabel("Note").fill("Ramen specialists, order the tonkotsu.");
  await sheet.getByRole("button", { name: "Send suggestion" }).click();
}

const jpCell = (page: Page) => page.locator('a[href="/country/JP"] [role="img"]').first();

test("curator flow: suggest JP, approve, JP is listed; non-curator 404; uncharted section", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const { people } = await table("Cur", 1, "Curator Supper");
  const member = people[1];
  const cur = await curatorUser("cur");

  const { count: before } = await admin()
    .from("city_country_status")
    .select("country_iso2", { count: "exact", head: true })
    .eq("country_iso2", "JP")
    .eq("status", "listed");
  expect(before).toBe(0);

  // The member's passport: Japan has no London restaurant yet.
  const M = await phone(browser, baseURL!, member.email);
  await expect(jpCell(M.page)).toHaveAttribute("aria-label", /no London restaurant listed yet/);

  // A member suggests a Japanese restaurant from the Country page; a bad postcode is a friendly error.
  await M.page.goto("/country/JP");
  await suggest(M.page, RESTAURANT, "ZZ99 9ZZ");
  await expect(M.page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await M.page.getByRole("dialog").getByLabel("Postcode").fill(POSTCODE);
  await M.page.getByRole("dialog").getByRole("button", { name: "Send suggestion" }).click();
  await expect(M.page.getByText(/Thanks! A curator will check it/)).toBeVisible({ timeout: 15_000 });
  const { data: sub } = await admin().from("submissions").select("id, status, lat, lon").eq("name", RESTAURANT).single();
  expect(sub!.status).toBe("pending");
  // No coordinates on the suggestion: the curator geocodes the postcode on approval.
  expect(sub!.lat).toBeNull();
  expect(sub!.lon).toBeNull();

  // A non-curator gets a real 404 on /curator.
  const res = await M.page.goto("/curator");
  expect(res!.status()).toBe(404);
  const res2 = await M.page.goto("/curator?tab=status");
  expect(res2!.status()).toBe(404);

  // The curator sees the suggestion and what approving does, then approves it.
  const C = await phone(browser, baseURL!, cur.email, null, "/curator");
  const card = C.page
    .getByText(RESTAURANT, { exact: true })
    .locator("xpath=ancestor::div[.//button[normalize-space()='Approve']][1]");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/Approving makes Japan listed in London/);
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card).toHaveCount(0, { timeout: 15_000 });

  // JP is listed in the database, on the country page, and on the member's passport.
  const { data: st } = await admin().from("city_country_status").select("status, restaurant_count").eq("country_iso2", "JP").single();
  expect(st).toEqual({ status: "listed", restaurant_count: 1 });
  const { data: approved } = await admin().from("restaurants").select("lat, lon, postcode").eq("name", RESTAURANT).single();
  expect(approved!.lat).toEqual(expect.any(Number));
  expect(approved!.lon).toEqual(expect.any(Number));
  await M.page.goto("/country/JP");
  await expect(M.page.getByText("On the London list")).toBeVisible();
  await M.page.goto("/");
  await expect(jpCell(M.page)).toHaveAttribute("aria-label", /not stamped yet/);

  // Marking an unlisted country uncharted moves it to the passport's Uncharted section.
  await C.page.goto("/curator?tab=status");
  await C.page.getByLabel("Find a country").fill("Greenland");
  await C.page.getByRole("button", { name: "Mark uncharted: Greenland" }).click();
  await expect(C.page.getByRole("button", { name: "Set unlisted: Greenland" })).toBeVisible({ timeout: 15_000 });
  const { data: gl } = await admin().from("city_country_status").select("status").eq("country_iso2", "GL").single();
  expect(gl!.status).toBe("uncharted");
  await M.page.goto("/");
  const section = M.page.getByRole("region", { name: "Uncharted" });
  await expect(section.locator('a[href="/country/GL"]')).toBeVisible();
  await expect(M.page.getByRole("region", { name: "Uncharted" }).locator('a[href="/country/JP"]')).toHaveCount(0);
  // ...and back again.
  await C.page.getByRole("button", { name: "Set unlisted: Greenland" }).click();
  await expect(C.page.getByRole("button", { name: "Mark uncharted: Greenland" })).toBeVisible({ timeout: 15_000 });

  await M.ctx.close();
  await C.ctx.close();
});

test("M6 screenshots @screens", async ({ browser, baseURL }) => {
  test.skip(!process.env.SCREENS, "set SCREENS=1 to regenerate docs/screens/M6 (after npm run dev:fixtures)");
  test.setTimeout(150_000);
  const { people } = await table("Shot6", 1, "Suggest Table");
  const M = await phone(browser, baseURL!, people[1].email, null, "/country/JP");
  await M.page.getByRole("button", { name: "Suggest a restaurant" }).click();
  await M.page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Shoryu Test");
  await M.page.getByRole("dialog").getByLabel("Postcode").fill(POSTCODE);
  await shot(M.page, OUT, "suggest-form");
  await M.page.keyboard.press("Escape");
  await M.page.getByRole("dialog").waitFor({ state: "hidden" }).catch(() => {});
  await suggest(M.page, `E2E Ramen shot ${Date.now()}`);
  await expect(M.page.getByText(/Thanks! A curator will check it/)).toBeVisible({ timeout: 15_000 });

  const A = await phone(browser, baseURL!, "andrew@demo.local", null, "/curator");
  await expect(A.page.getByRole("button", { name: "Approve" }).first()).toBeVisible();
  await shot(A.page, OUT, "curator-submissions", { fullPage: true });
  await A.page.goto("/curator?tab=restaurants&q=Lao");
  await A.page.getByRole("button", { name: /Lao Café/ }).first().click();
  await expect(A.page.getByRole("dialog")).toBeVisible();
  await shot(A.page, OUT, "restaurant-edit");
  await A.page.keyboard.press("Escape");
  await A.page.goto("/curator?tab=status");
  await shot(A.page, OUT, "city-country-status", { fullPage: true });
  await A.page.goto("/curator?tab=dishes&country=LA");
  await shot(A.page, OUT, "dishes", { fullPage: true });
  await A.ctx.close();
  await M.ctx.close();
});
