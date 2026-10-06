import { expect, test } from "@playwright/test";
import {
  admin,
  cleanupUsers,
  countryWithStatus,
  createGroup,
  createUser,
  latestSignInLink,
  makeCurator,
  markUncharted,
  restaurantId,
  signIn,
  trackUserByEmail,
} from "./helpers";

test.afterAll(cleanupUsers);

test("signed-out visitors are redirected to /login", async ({ page }) => {
  for (const path of ["/", "/settings", "/group", "/country/LA"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("proxy redirects are relative, so they keep the host (and its cookies)", async ({ page, request, baseURL }) => {
  const signedOut = await request.get("/settings", { maxRedirects: 0 });
  expect(signedOut.status()).toBe(307);
  expect(signedOut.headers()["location"]).toBe("/login?next=%2Fsettings");

  const u = await createUser("proxyhost");
  await signIn(page, u.email, "/");
  const signedIn = await page.request.get("/login?next=%2Fcountry%2FLA", { maxRedirects: 0 });
  expect(signedIn.status()).toBe(307);
  expect(signedIn.headers()["location"]).toBe("/country/LA");
  await page.goto("/login?next=%2Fcountry%2FLA");
  await expect(page).toHaveURL(`${new URL(baseURL!).origin}/country/LA`);
});

test("passport shows listed, unlisted and uncharted for a fresh user", async ({ page }) => {
  const u = await createUser("fresh", "Fresh Tester");
  const listed = await countryWithStatus("listed");
  const unlisted = await countryWithStatus("unlisted");
  const uncharted = await countryWithStatus("unlisted", 1);
  await markUncharted(uncharted);
  await signIn(page, u.email, "/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Your passport is blank")).toBeVisible();
  await expect(page.getByText(/0\s*\/\s*39/).first()).toBeVisible();

  const label = (iso2: string) =>
    page.locator(`a[href="/country/${iso2}"] [role="img"]`).first().getAttribute("aria-label");
  expect(await label(listed)).toContain("not stamped yet");
  expect(await label(unlisted)).toContain("no London restaurant listed yet");
  expect(await label(uncharted)).toContain("uncharted in London");
});

test("country and restaurant pages render", async ({ page }) => {
  const u = await createUser("browse");
  await signIn(page, u.email, "/country/LA");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Laos");
  await expect(page.getByText("Lao Café").first()).toBeVisible();

  const id = await restaurantId("Lao Café");
  await page.goto(`/restaurant/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Lao Café" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in Google Maps" })).toHaveAttribute(
    "href",
    /google\.com\/maps/,
  );
  // Check-in is live (M3): the button is a link to the stepper.
  await expect(page.getByRole("link", { name: "Check in here" })).toHaveAttribute("href", `/check-in/${id}`);
  await expect(page).toHaveTitle(/^Lao Café · /);
});

test("bottom tabs and unknown pages never dead-end", async ({ page }) => {
  const u = await createUser("tabs");
  await signIn(page, u.email, "/map");
  await expect(page.getByRole("button", { name: "Nearest unstamped" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "World" }).click();
  await expect(page).toHaveURL(/\/world$/);
  await expect(page.getByRole("application", { name: /World map/ })).toBeVisible();
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: "Off the map" })).toBeVisible();
});

test("a non-member gets the not-found page for someone else's group", async ({ page }) => {
  const owner = await createUser("gowner", "Group Owner");
  const outsider = await createUser("outsider", "Outsider C");
  const g = await createGroup(owner.id, "Private Supper");
  await signIn(page, outsider.email, `/group/${g.id}`);
  await expect(page).toHaveURL(new RegExp(`/group/${g.id}$`));
  await expect(page.getByRole("heading", { name: "Off the map" })).toBeVisible();
  await expect(page.getByText("Private Supper")).toHaveCount(0);
  await expect(page).not.toHaveTitle(/Private Supper/);
});

test("the emailed sign-in link keeps the invite", async ({ page }) => {
  test.skip(!!process.env.E2E_BASE_URL, "reads the local Supabase mail catcher");
  const owner = await createUser("mailowner", "Mail Owner");
  const g = await createGroup(owner.id, "Email Supper");
  const email = `e2e-mail-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.local`;

  await page.goto(`/join/${g.inviteCode}`);
  await expect(page).toHaveURL(/\/login\?next=%2Fjoin%2F/);
  await page.getByLabel("Your email").fill(email);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByText(/We sent a 6-digit code/)).toBeVisible();

  // Tap the link in the email instead of typing the code.
  await page.goto(await latestSignInLink(email));
  // Back on the invite: it shows the group and joins only on the button (a POST).
  await expect(page.getByRole("heading", { name: "Join Email Supper?" })).toBeVisible();
  await page.getByRole("button", { name: "Join the table" }).click();
  await expect(page).toHaveURL(/\/settings\/backfill\?onboarding=1/);
  const userId = await trackUserByEmail(email);
  const { count } = await admin()
    .from("group_members")
    .select("*", { count: "exact", head: true })
    .eq("group_id", g.id)
    .eq("user_id", userId!);
  expect(count).toBe(1);
});

test("invite flow: create group, join, backfill, passport", async ({ page, browser }) => {
  const a = await createUser("owner", "Owner A");
  const b = await createUser("joiner", "Joiner B");

  // A creates a group in Settings. Groups are invite-only, so A is the curator (as Andrew is).
  await makeCurator(a.id);
  await signIn(page, a.email, "/settings");
  await page.getByLabel("Group name").fill("E2E Supper");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page).toHaveURL(/\/group\/[0-9a-f-]{36}/);
  const inviteUrl = (await page.getByTestId("invite-url").innerText()).trim();
  const joinPath = new URL(inviteUrl).pathname;
  expect(joinPath).toMatch(/^\/join\//);

  // B opens the link signed out, is sent to login, then signs in.
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    baseURL: new URL(page.url()).origin,
  });
  const pb = await ctx.newPage();
  await pb.goto(joinPath);
  await expect(pb).toHaveURL(/\/login/);
  await signIn(pb, b.email, joinPath);
  await expect(pb.getByRole("heading", { name: "Join E2E Supper?" })).toBeVisible();
  // Opening the link (a GET) joins nobody: only the button does.
  const { count: before } = await admin()
    .from("group_members")
    .select("*", { count: "exact", head: true })
    .eq("user_id", b.id);
  expect(before).toBe(0);
  await pb.getByRole("button", { name: "Join the table" }).click();
  await expect(pb).toHaveURL(/\/settings\/backfill\?onboarding=1/);

  // Backfill two countries.
  await pb.getByLabel("Search countries").fill("Spain");
  await pb.getByRole("button", { name: /^Spain/ }).click();
  await pb.getByLabel("Search countries").fill("Japan");
  await pb.getByRole("button", { name: /^Japan/ }).click();
  await expect(pb.getByText("2 memories")).toBeVisible();
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

  await pb.getByRole("link", { name: "See my passport" }).click();
  await expect(pb).toHaveURL(/\/$/);
  for (const iso of ["ES", "JP"]) {
    await expect(pb.locator(`a[href="/country/${iso}"] [role="img"]`).first()).toHaveAttribute(
      "aria-label",
      /before the app/,
    );
  }
  await expect(pb.getByText(/0\s*\/\s*39/).first()).toBeVisible();
  await ctx.close();

  // Group page lists both members.
  await page.reload();
  await expect(page.getByTestId("member-list").getByText("Joiner B")).toBeVisible();
});
