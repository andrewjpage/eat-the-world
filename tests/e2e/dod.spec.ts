import { existsSync } from "node:fs";
import { serverRealtimeOptions } from "../../src/lib/supabase/node-realtime";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * The brief's section 13 definition of done, as one serial flow at 390x844. Runs against
 * E2E_BASE_URL (the deployed app) or the local server. The two throwaway users are made and signed
 * in with the service-role key (auth.admin.generateLink + /auth/confirm; there is no test-login
 * route) and are removed through account deletion, with a fallback clean-up if any step fails.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the project the app points at.
 */
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RUN = Date.now().toString(36);
const A_NAME = `DoD Alice ${RUN}`;
const B_NAME = `DoD Bob ${RUN}`;

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("dod needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    _admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: serverRealtimeOptions() });
  }
  return _admin;
}

type Who = { id: string; email: string; name: string };
const users: Who[] = [];
let groupId = "";
let joinPath = "";
let visitId = "";
let dishName = "";
let lao: { id: string; lat: number; lon: number };
let rarity = 0;
const contexts: BrowserContext[] = [];

async function makeUser(label: string, name: string): Promise<Who> {
  const email = `e2e-dod-${label}-${RUN}-${Math.random().toString(36).slice(2, 6)}@e2e.local`;
  const { data, error } = await admin().auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const who = { id: data.user.id, email, name };
  users.push(who);
  return who;
}

async function phone(browser: Browser, geo?: { lat: number; lon: number }): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    viewport: { width: 390, height: 844 },
    baseURL: BASE,
    ...(geo ? { geolocation: { latitude: geo.lat, longitude: geo.lon, accuracy: 20 }, permissions: ["geolocation" as const] } : {}),
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("etw:ios-install-hint-dismissed", "1");
    } catch {}
  });
  contexts.push(ctx);
  return { ctx, page: await ctx.newPage() };
}

async function setCurator(userId: string, on: boolean) {
  const { error } = await admin().from("profiles").update({ is_curator: on }).eq("user_id", userId);
  if (error) throw new Error(`setCurator: ${error.message}`);
}

/** Sign in the way a clicked email link does. */
async function signIn(page: Page, email: string, next: string) {
  const { data, error } = await admin().auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) throw new Error(`generateLink: ${error?.message}`);
  const q = new URLSearchParams({ token_hash: data.properties.hashed_token, type: "magiclink", next });
  await page.goto(`/auth/confirm?${q}`);
}

/** Rarity by the brief's table, from the live count of active or reported-closed restaurants. */
function rarityFor(n: number): number {
  return n <= 1 ? 15 : n <= 3 ? 10 : n <= 9 ? 5 : 0;
}

const leaderRow = (page: Page, name: string) =>
  page.getByTestId("leaderboard").getByRole("listitem").filter({ hasText: name });
const together = (page: Page) => page.getByTestId("together").getByRole("progressbar", { name: "Countries eaten in London" });

async function deleteViaSettings(page: Page, who: Who) {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete my account…" }).click();
  await page.getByRole("button", { name: "Yes, delete everything" }).click();
  await expect(page).toHaveURL(/\/privacy\/goodbye/, { timeout: 30_000 });
  await expect.poll(async () => (await admin().auth.admin.getUserById(who.id)).data.user, { timeout: 15_000 }).toBeNull();
}

test.describe.serial("definition of done (brief section 13)", () => {
  let A: { ctx: BrowserContext; page: Page };
  let B: { ctx: BrowserContext; page: Page };

  test.beforeAll(async ({ browser }) => {
    const { data: r } = await admin().from("restaurants").select("id, lat, lon, country_iso2").eq("name", "Lao Café").single();
    lao = { id: r!.id, lat: r!.lat, lon: r!.lon };
    const { count } = await admin()
      .from("restaurants")
      .select("id", { count: "exact", head: true })
      .eq("country_iso2", r!.country_iso2)
      .in("status", ["active", "reported_closed"]);
    rarity = rarityFor(count ?? 0);
    const { data: dish } = await admin()
      .from("signature_dishes")
      .select("name")
      .eq("country_iso2", r!.country_iso2)
      .eq("status", "approved")
      .order("name")
      .limit(1)
      .single();
    dishName = dish!.name as string;
    await makeUser("a", A_NAME);
    await makeUser("b", B_NAME);
    A = await phone(browser);
    B = await phone(browser, { lat: lao.lat, lon: lao.lon });
  });

  test.afterAll(async () => {
    // Whatever happened above, nothing of this run may stay behind.
    for (const c of contexts.splice(0)) await c.close().catch(() => {});
    if (groupId) {
      await admin().from("visits").delete().eq("group_id", groupId);
      await admin().from("groups").delete().eq("id", groupId);
    }
    for (const u of users.splice(0)) {
      await admin().from("groups").delete().eq("owner_id", u.id);
      await admin().auth.admin.deleteUser(u.id);
    }
  });

  test("A creates a group", async () => {
    const [a] = users;
    // Groups are invite-only: A stands in for Andrew, the curator who starts the first group.
    // The curator flag is lent for the one step and taken back straight after.
    await setCurator(a.id, true);
    await signIn(A.page, a.email, "/settings");
    await A.page.getByLabel("Group name").fill(`DoD Supper ${RUN}`);
    await A.page.getByRole("button", { name: "Create group" }).click();
    await expect(A.page).toHaveURL(new RegExp(`/group/(${UUID})`));
    await setCurator(a.id, false);
    groupId = A.page.url().match(new RegExp(`/group/(${UUID})`))![1];
    joinPath = new URL((await A.page.getByTestId("invite-url").innerText()).trim()).pathname;
    expect(joinPath).toMatch(/^\/join\/[A-Z0-9]{8}$/);
  });

  test("B opens the invite, backfills past countries and sees the London denominator", async () => {
    const b = users[1];
    // Signed out, the invite link sends B to sign in; signing in lands on backfill onboarding.
    await B.page.goto(joinPath);
    await expect(B.page).toHaveURL(/\/login/);
    await signIn(B.page, b.email, joinPath);
    // The invite shows the group; joining is the button (a POST), never the link itself.
    await expect(B.page.getByRole("heading", { name: `Join DoD Supper ${RUN}?` })).toBeVisible();
    await B.page.getByRole("button", { name: "Join the table" }).click();
    await expect(B.page).toHaveURL(/\/settings\/backfill\?onboarding=1/);

    await B.page.getByLabel("Search countries").fill("Spain");
    await B.page.getByRole("button", { name: /^Spain/ }).click();
    await B.page.getByLabel("Search countries").fill("Japan");
    await B.page.getByRole("button", { name: /^Japan/ }).click();
    await expect(B.page.getByText("2 memories")).toBeVisible();
    await expect
      .poll(async () => {
        const { count } = await admin()
          .from("stamps")
          .select("*", { count: "exact", head: true })
          .eq("user_id", b.id)
          .eq("backfilled", true);
        return count;
      })
      .toBe(2);

    await B.page.getByRole("link", { name: "See my passport" }).click();
    await expect(B.page).toHaveURL(/\/$/);
    const { count: listed } = await admin()
      .from("city_country_status")
      .select("country_iso2", { count: "exact", head: true })
      .eq("status", "listed");
    // Backfilled countries are stamps anywhere, never London progress: 0 of everything London lists.
    await expect(B.page.getByText(new RegExp(`0\\s*/\\s*${listed}\\b`)).first()).toBeVisible();
    for (const iso of ["ES", "JP"]) {
      await expect(B.page.locator(`a[href="/country/${iso}"] [role="img"]`).first()).toHaveAttribute("aria-label", /before the app/);
    }
    // B joined A's group, which has eaten nothing yet.
    await B.page.goto(`/group/${groupId}`);
    await expect(together(B.page)).toHaveAttribute("aria-valuenow", "0");
    await expect(together(B.page)).toHaveAttribute("aria-valuemax", String(listed));
  });

  test("B checks in at Lao Café with A as co-diner, at the restaurant", async () => {
    test.setTimeout(90_000);
    const p = B.page;
    await p.goto(`/check-in/${lao.id}`);
    await p.getByRole("button", { name: "Share my location" }).click();
    await expect(p.getByRole("heading", { name: "Who's at the table?" })).toBeVisible();
    await p.getByRole("checkbox", { name: new RegExp(A_NAME) }).click();
    await p.getByRole("button", { name: /Next, 1 tagged/ }).click();
    await p.getByRole("radio", { name: dishName, exact: true }).click();
    await p.getByRole("radio", { name: "5 stars" }).click();
    await p.getByRole("button", { name: "Get my stamp" }).click();
    await expect(p.getByRole("heading", { name: "Stamped!" })).toBeVisible();
    await expect(p).toHaveURL(new RegExp(`/visit/(${UUID})$`));
    visitId = p.url().match(new RegExp(`/visit/(${UUID})$`))![1];

    // New country 10 + rarity + signature dish 2; the table bonus needs three confirmed, so not yet.
    const total = 10 + rarity + 2;
    const points = p.getByLabel("Points");
    await expect(points).toContainText(/Total\s*\d+/);
    await expect(p.locator("main")).toContainText(new RegExp(`Total\\s*${total}`));
    await expect(points).toContainText(/New country\s*\+10/);
    await expect(points).toContainText(new RegExp(`Rarity\\s*\\+${rarity}`));
    await expect(points).toContainText(/Signature dish\s*\+2/);
    // Step 5, first half: the recap share button is on the stamp moment.
    await expect(p.getByTestId("share-recap")).toBeVisible();
    await expect(p.getByRole("button", { name: /Share recap/ })).toBeVisible();

    const { data: v } = await admin().from("visits").select("verification").eq("id", visitId).single();
    expect(v!.verification).toBe("geo_verified");
  });

  test("A confirms from the nudge link; both stamps show the right breakdown", async () => {
    test.setTimeout(90_000);
    const [a, b] = users;
    const href = await B.page.getByRole("link", { name: /Nudge the table/ }).getAttribute("href");
    const nudged = new URL(decodeURIComponent(href!).match(new RegExp(`https?://[^\\s]*/visit/${UUID}`))![0]);
    expect(nudged.pathname).toBe(`/visit/${visitId}`);

    await signIn(A.page, a.email, nudged.pathname);
    const sheet = A.page.getByRole("dialog", { name: "Confirm you were there" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("radio", { name: dishName, exact: true }).click();
    await sheet.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(A.page.getByRole("heading", { name: "Stamped!" })).toBeVisible();

    const total = 10 + rarity + 2;
    await expect(A.page.locator("main")).toContainText(new RegExp(`Total\\s*${total}`));
    await expect(A.page.getByLabel("Points")).toContainText(/New country\s*\+10/);

    const { data: stamps } = await admin()
      .from("stamps")
      .select("user_id, base, rarity_bonus, table_bonus, dish_bonus, backfilled")
      .eq("visit_id", visitId);
    expect(stamps).toHaveLength(2);
    for (const s of stamps!) {
      expect([a.id, b.id]).toContain(s.user_id);
      expect(s).toMatchObject({ base: 10, rarity_bonus: rarity, table_bonus: 0, dish_bonus: 2, backfilled: false });
    }
    const { data: totals } = await admin().from("stamp_totals").select("user_id, points").eq("visit_id", visitId);
    expect(totals!.map((t) => t.points)).toEqual([total, total]);

    // B's own view of the same visit.
    await B.page.goto(`/visit/${visitId}`);
    await expect(B.page.locator("main")).toContainText(new RegExp(`${total}`));
  });

  test("B's recap PNG is fetchable", async () => {
    const res = await B.ctx.request.get(`/api/visits/${visitId}/recap`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    const png = await res.body();
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.length).toBeGreaterThan(5_000);
  });

  test("B spins the globe and proposes the next dinner", async () => {
    test.setTimeout(90_000);
    const p = B.page;
    await p.goto(`/group/${groupId}`);
    await p.getByTestId("spin-button").click();
    await expect(p.getByTestId("spin-result")).toBeVisible({ timeout: 20_000 });
    await p.getByRole("link", { name: "Propose a dinner" }).click();
    await expect(p).toHaveURL(new RegExp(`/group/${groupId}/plan/new\\?restaurant=${UUID}`));
    const when = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await p.locator("#plan-date").fill(when);
    await p.locator("#plan-time").fill("19:30");
    await p.getByRole("button", { name: "Plan the dinner" }).click();
    await expect(p).toHaveURL(new RegExp(`/group/${groupId}$`));
    await expect(p.getByTestId("plan-card")).toHaveCount(1);
    const { count } = await admin().from("plans").select("id", { count: "exact", head: true }).eq("group_id", groupId);
    expect(count).toBe(1);
  });

  test("the Together bar and the leaderboard update", async () => {
    const { count: listed } = await admin()
      .from("city_country_status")
      .select("country_iso2", { count: "exact", head: true })
      .eq("status", "listed");
    const total = 10 + rarity + 2;
    for (const page of [A.page, B.page]) {
      await page.goto(`/group/${groupId}`);
      await expect(together(page)).toHaveAttribute("aria-valuenow", "1");
      await expect(together(page)).toHaveAttribute("aria-valuemax", String(listed));
      for (const name of [A_NAME, B_NAME]) {
        await expect(leaderRow(page, name)).toContainText(new RegExp(`${total}\\s*pts`));
        await expect(leaderRow(page, name)).toContainText(/1\s*country/);
      }
    }
  });

  test("no raw location is stored on the visit", async () => {
    const { data: v } = await admin().from("visits").select("*").eq("id", visitId).single();
    for (const col of Object.keys(v!)) expect(col).not.toMatch(/^(lat|lon|lng|latitude|longitude|coords?|location)/i);
    expect(JSON.stringify(v)).not.toContain(lao.lat.toFixed(4));
    expect(JSON.stringify(v)).not.toContain(lao.lon.toFixed(4));
  });

  test("both users delete their accounts", async () => {
    test.setTimeout(90_000);
    const [a, b] = users;
    await deleteViaSettings(A.page, a);
    await deleteViaSettings(B.page, b);
    for (const u of users) expect((await admin().auth.admin.getUserById(u.id)).data.user).toBeNull();
  });
});
