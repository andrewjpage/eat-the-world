import { expect, test } from "@playwright/test";
import { admin, cleanupUsers } from "./helpers";
import { dinner, table } from "./m4-helpers";
import { phone, shot } from "./phone";

const OUT = "docs/screens/M7";

test.afterAll(cleanupUsers);

async function points(userId: string): Promise<number> {
  const { data, error } = await admin().from("stamp_totals").select("points").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((n, r) => n + (r.points as number), 0);
}

test("delete account: after the worked example, Bob and Cara keep 32 each", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const { people, group } = await table("Del", 2, "Delete Supper");
  const [alice, bob, cara] = people;
  const visit = await dinner(alice, [bob, cara], group.id, "Lao Café", true);
  for (const p of people) expect(await points(p.id)).toBe(32);

  const A = await phone(browser, baseURL!, alice.email, null, "/settings");
  await A.page.getByRole("button", { name: "Delete my account…" }).click();
  const sheet = A.page.getByRole("dialog", { name: "Delete your account?" });
  await expect(sheet).toBeVisible();
  // Keeping the account closes the sheet and changes nothing.
  await sheet.getByRole("button", { name: "Keep my account" }).click();
  await expect(sheet).toBeHidden();
  expect((await admin().auth.admin.getUserById(alice.id)).data.user).not.toBeNull();

  await A.page.getByRole("button", { name: "Delete my account…" }).click();
  await A.page.getByRole("button", { name: "Yes, delete everything" }).click();
  await expect(A.page).toHaveURL(/\/privacy\/goodbye/, { timeout: 30_000 });
  // The session is gone.
  await A.page.goto("/settings");
  await expect(A.page).toHaveURL(/\/login/);

  expect((await admin().auth.admin.getUserById(alice.id)).data.user).toBeNull();
  const { data: prof } = await admin().from("profiles").select("user_id").eq("user_id", alice.id);
  expect(prof).toHaveLength(0);
  // Stamps stand for the others; their stored points are not recomputed.
  expect(await points(bob.id)).toBe(32);
  expect(await points(cara.id)).toBe(32);
  const { data: v } = await admin().from("visits").select("id, created_by").eq("id", visit).single();
  expect(v!.created_by).toBeNull();

  const B = await phone(browser, baseURL!, bob.email, null, `/visit/${visit}`);
  await expect(B.page.locator("main")).toContainText("32");
  await B.page.goto("/");
  await expect(B.page.getByText(/1\s*\/\s*\d+/).first()).toBeVisible();
  await A.ctx.close();
  await B.ctx.close();
});

test("privacy and credits render, with the postcodes.io attribution lines", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("main")).toContainText(/location/i);

  const year = new Date().getFullYear();
  await page.goto("/credits");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const main = page.locator("main");
  await expect(main.getByRole("link", { name: "postcodes.io" })).toHaveAttribute("href", "https://postcodes.io");
  await expect(main).toContainText(`Contains Ordnance Survey data © Crown copyright and database right ${year}`);
  await expect(main).toContainText(`Contains Royal Mail data © Royal Mail copyright and database right ${year}`);
  await expect(main).toContainText(`Contains National Statistics data © Crown copyright and database right ${year}`);
  await expect(main).toContainText("OpenStreetMap contributors");
  // Signed-out visitors can read both, and the login page links to them.
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Credits" })).toBeVisible();
});

test("keepalive: 401 without the bearer, 401 with a wrong one, 200 with it", async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  test.skip(!secret, "CRON_SECRET is not set for this run");
  expect((await request.get("/api/keepalive")).status()).toBe(401);
  expect((await request.get("/api/keepalive", { headers: { Authorization: "Bearer not-the-secret" } })).status()).toBe(401);
  const ok = await request.get("/api/keepalive", { headers: { Authorization: `Bearer ${secret}` } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toEqual({ ok: true });
});

test("M7 screenshots @screens", async ({ browser, baseURL, page }) => {
  test.skip(!process.env.SCREENS, "set SCREENS=1 to regenerate docs/screens/M7 (after npm run dev:fixtures)");
  test.setTimeout(90_000);
  await page.goto("/privacy");
  await shot(page, OUT, "privacy", { fullPage: true });
  await page.goto("/credits");
  await shot(page, OUT, "credits", { fullPage: true });
  // A throwaway user, so the demo account is never touched.
  const { people } = await table("Shot7", 0, "Settings Table");
  const U = await phone(browser, baseURL!, people[0].email, null, "/settings");
  await U.page.getByRole("button", { name: "Delete my account…" }).click();
  await expect(U.page.getByRole("dialog", { name: "Delete your account?" })).toBeVisible();
  await shot(U.page, OUT, "delete-account-sheet");
  await U.ctx.close();
});
