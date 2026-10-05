import { expect, test, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { admin, cleanupUsers, createGroup, createUser, signIn } from "./helpers";

test.afterAll(cleanupUsers);

const OUT = "docs/screens/M3";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

type Geo = { lat: number; lon: number } | null;

async function phone(
  browser: Browser,
  baseURL: string,
  email: string,
  geo: Geo,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    viewport: { width: 390, height: 844 },
    baseURL,
    ...(geo ? { geolocation: { latitude: geo.lat, longitude: geo.lon, accuracy: 20 }, permissions: ["geolocation"] } : {}),
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("etw:ios-install-hint-dismissed", "1");
    } catch {}
  });
  const page = await ctx.newPage();
  await signIn(page, email);
  return { ctx, page };
}

async function lao() {
  const { data } = await admin().from("restaurants").select("id, lat, lon").eq("name", "Lao Café").single();
  const { data: dish } = await admin()
    .from("signature_dishes")
    .select("name")
    .eq("country_iso2", "LA")
    .eq("status", "approved")
    .order("name")
    .limit(1)
    .single();
  return { id: data!.id as string, lat: data!.lat as number, lon: data!.lon as number, dish: dish!.name as string };
}

async function trio(prefix: string) {
  const a = await createUser(`${prefix}a`, "Trio A");
  const b = await createUser(`${prefix}b`, "Trio B");
  const c = await createUser(`${prefix}c`, "Trio C");
  const g = await createGroup(a.id, "Trio Supper");
  for (const u of [b, c]) {
    const { error } = await admin().from("group_members").insert({ group_id: g.id, user_id: u.id, role: "member" });
    if (error) throw new Error(error.message);
  }
  return { a, b, c, g };
}

async function shot(page: Page, name: string, on: boolean) {
  if (!on) return;
  await page.waitForLoadState("load");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

function visitIdFrom(href: string) {
  return decodeURIComponent(href).match(new RegExp(`/visit/(${UUID})`))![1];
}

/** The stamp shows at once; the save is done when the URL becomes the visit's. */
async function saved(page: Page): Promise<string> {
  await expect(page).toHaveURL(new RegExp(`/visit/${UUID}$`));
  return visitIdFrom(page.url());
}

async function happyPath(browser: Browser, baseURL: string, screens: boolean) {
  const place = await lao();
  const { a, b, c } = await trio(screens ? "sh" : "hp");
  const urls: string[] = [];
  const A = await phone(browser, baseURL, a.email, { lat: place.lat, lon: place.lon });
  A.page.on("request", (r) => urls.push(r.url()));
  const p = A.page;

  await p.goto("/check-in");
  await p.getByRole("button", { name: "Find restaurants near me" }).click();
  const nearby = p.getByRole("list", { name: "Nearest restaurants" });
  await expect(nearby.getByRole("link").first()).toContainText("Lao Café");
  await shot(p, "checkin-nearby", screens);
  await nearby.getByRole("link").first().click();
  await expect(p).toHaveURL(new RegExp(`/check-in/${UUID}$`));
  // The stepper is full screen: no bottom nav to tap by mistake.
  await expect(p.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await shot(p, "step-1-location", screens);
  await p.getByRole("button", { name: "Share my location" }).click();
  await expect(p.getByRole("heading", { name: "Who's at the table?" })).toBeVisible();
  await p.getByRole("checkbox", { name: /Trio B/ }).click();
  await p.getByRole("checkbox", { name: /Trio C/ }).click();
  await shot(p, "step-2-who", screens);
  await p.getByRole("button", { name: /Next, 2 tagged/ }).click();
  await p.getByRole("radio", { name: place.dish, exact: true }).click();
  await p.getByRole("radio", { name: "5 stars" }).click();
  await shot(p, "step-3-dish-rating", screens);
  await p.getByRole("button", { name: "Get my stamp" }).click();
  await expect(p.getByRole("heading", { name: "Stamped!" })).toBeVisible();
  await p.waitForTimeout(700);
  const body = p.locator("main");
  await expect(body).toContainText(/Total\s*27/);
  await expect(body).toContainText("+5 when 2 more confirm");
  const visitId = await saved(p);
  await shot(p, "stamp-moment-pending-bonus", screens);
  expect(visitIdFrom((await p.getByRole("link", { name: /Nudge the table/ }).getAttribute("href"))!)).toBe(visitId);

  // B confirms with Larb.
  const B = await phone(browser, baseURL, b.email, null);
  await B.page.goto(`/visit/${visitId}`);
  await expect(B.page.getByRole("dialog", { name: "Confirm you were there" })).toBeVisible();
  await shot(B.page, "visit-confirm-sheet", screens);
  await B.page.getByRole("radio", { name: place.dish, exact: true }).click();
  await B.page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(B.page.getByRole("heading", { name: "Stamped!" })).toBeVisible();
  await expect(B.page.locator("body")).toContainText("+5 when 1 more confirm");

  // C confirms from the passport banner.
  const C = await phone(browser, baseURL, c.email, null);
  await C.page.goto("/");
  await shot(C.page, "passport-pending-banner", screens);
  await C.page.getByRole("link", { name: /Were you at this dinner/ }).click();
  await C.page.getByRole("dialog").waitFor();
  await C.page.getByRole("radio", { name: place.dish, exact: true }).click();
  await C.page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(C.page.getByRole("heading", { name: "Stamped!" })).toBeVisible();
  await expect(C.page.locator("body")).toContainText(/Total\s*32/);

  // Database truth.
  const { data: stamps } = await admin().from("stamp_totals").select("user_id, points").eq("visit_id", visitId);
  expect(stamps).toHaveLength(3);
  expect(stamps!.every((s) => s.points === 32)).toBe(true);
  const { data: visit } = await admin().from("visits").select("verification").eq("id", visitId).single();
  expect(visit!.verification).toBe("geo_verified");

  // A sees 32 on the visit page, and the passport.
  await p.goto(`/visit/${visitId}`);
  await expect(p.locator("main")).toContainText("32");
  await p.goto("/");
  await expect(p.getByText(/1\s*\/\s*39/).first()).toBeVisible();
  const laos = await p.locator('a[href="/country/LA"] [role="img"]').first().getAttribute("aria-label");
  expect(laos).not.toContain("not stamped yet");
  expect(urls.some((u) => /51\.\d{3,}|-0\.\d{3,}/.test(decodeURIComponent(u)))).toBe(false);

  for (const x of [A, B, C]) await x.ctx.close();
}

test("happy path: the brief's Lao Café worked example", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  await happyPath(browser, baseURL!, false);
});

test("location denied: self-reported, and no coordinates anywhere", async ({ browser, baseURL }) => {
  const place = await lao();
  const u = await createUser("denied", "Denied Dan");
  await createGroup(u.id, "Denied Supper");
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    viewport: { width: 390, height: 844 },
    baseURL: baseURL!,
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("etw:ios-install-hint-dismissed", "1");
    } catch {}
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, err) =>
      err?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
  });
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await signIn(page, u.email);
  await page.goto(`/check-in/${place.id}`);
  await page.getByRole("button", { name: "Share my location" }).click();
  await expect(page.getByText(/Location is off for this site/)).toBeVisible();
  await page.getByRole("button", { name: "Continue unverified" }).click();
  await page.getByRole("button", { name: /^(Next|Just me)/ }).first().click();
  await page.getByRole("radio", { name: place.dish, exact: true }).click();
  await page.getByRole("button", { name: "Get my stamp" }).click();
  await expect(page.getByRole("heading", { name: "Stamped!" })).toBeVisible();
  await saved(page);
  const { data: mine } = await admin().from("visit_attendees").select("visit_id").eq("user_id", u.id).single();
  const { data: v } = await admin().from("visits").select("*").eq("id", mine!.visit_id).single();
  expect(v!.verification).toBe("self_reported");
  expect(v!.distance_m).toBeNull();
  for (const col of Object.keys(v!)) expect(col).not.toMatch(/^(lat|lon|lng|latitude|longitude|coords?|location)/i);
  expect(JSON.stringify(v)).not.toContain(place.lat.toFixed(3));
  expect(urls.every((x) => !/lat=|lon=|latitude|longitude|51\.\d{3,}/.test(decodeURIComponent(x)))).toBe(true);
  expect(page.url()).not.toMatch(/lat|lon|51\./);
  // Reloading after the stamp opens the saved visit, never a form that could post again.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Lao Café" })).toBeVisible();
  const { count } = await admin().from("visits").select("id", { count: "exact", head: true }).eq("created_by", u.id);
  expect(count).toBe(1);
  await ctx.close();
});

test("repeat visit: the same restaurant again is a repeat worth 0 points", async ({ browser, baseURL }) => {
  const place = await lao();
  const u = await createUser("repeat", "Repeat Rae");
  await createGroup(u.id, "Repeat Supper");
  const { ctx, page } = await phone(browser, baseURL!, u.email, { lat: place.lat, lon: place.lon });
  const checkIn = async () => {
    await page.goto(`/check-in/${place.id}`);
    await page.getByRole("button", { name: "Share my location" }).click();
    await page.getByRole("button", { name: /^(Next|Just me)/ }).first().click();
    await page.getByRole("radio", { name: place.dish, exact: true }).click();
    await page.getByRole("button", { name: "Get my stamp" }).click();
    await saved(page);
  };
  await checkIn();
  await expect(page.getByRole("heading", { name: "Stamped!" })).toBeVisible();
  await checkIn();
  await expect(page.locator("main")).toContainText(/again|repeat|been here/i);
  await expect(page.getByRole("heading", { name: "Stamped!" })).toHaveCount(0);
  const { data } = await admin().from("stamp_totals").select("points").eq("user_id", u.id);
  expect(data).toHaveLength(1);
  await ctx.close();
});

test("decline: 'Not me' leaves no stamp", async ({ browser, baseURL }) => {
  const place = await lao();
  const { a, b } = await trio("dc");
  const A = await phone(browser, baseURL!, a.email, { lat: place.lat, lon: place.lon });
  const p = A.page;
  await p.goto(`/check-in/${place.id}`);
  await p.getByRole("button", { name: "Share my location" }).click();
  await p.getByRole("checkbox", { name: /Trio B/ }).click();
  await p.getByRole("button", { name: /Next, 1 tagged/ }).click();
  await p.getByRole("radio", { name: place.dish, exact: true }).click();
  await p.getByRole("button", { name: "Get my stamp" }).click();
  await expect(p.getByRole("heading", { name: "Stamped!" })).toBeVisible();
  const visitId = await saved(p);
  // One friend tagged can't make a table of three: no "+5 when N more confirm".
  await expect(p.locator("body")).not.toContainText("more confirm");

  const B = await phone(browser, baseURL!, b.email, null);
  await B.page.goto(`/visit/${visitId}`);
  await B.page.getByRole("dialog").waitFor();
  await B.page.keyboard.press("Escape");
  await B.page.getByRole("button", { name: "Not me" }).click();
  await B.page.getByRole("button", { name: "Yes, not me" }).click();
  await expect(B.page.getByText("You said you weren't at this one.")).toBeVisible();

  const { data: att } = await admin()
    .from("visit_attendees")
    .select("status")
    .eq("visit_id", visitId)
    .eq("user_id", b.id)
    .single();
  expect(att!.status).toBe("declined");
  const { data: stamps } = await admin().from("stamp_totals").select("user_id").eq("visit_id", visitId).eq("user_id", b.id);
  expect(stamps).toHaveLength(0);
  await A.ctx.close();
  await B.ctx.close();
});

test("M3 screenshots @screens", async ({ browser, baseURL }) => {
  test.skip(!process.env.SCREENS, "set SCREENS=1 to regenerate docs/screens/M3");
  test.setTimeout(240_000);
  await happyPath(browser, baseURL!, true);

  // Stamp moment (waiting) and claim: a fourth new country in one day.
  const u = await createUser("cap", "Cap Cass");
  const g = await createGroup(u.id, "Cap Supper");
  const { data: rs } = await admin().from("restaurants").select("id, country_iso2").eq("status", "active").order("country_iso2");
  const seen = new Set<string>();
  const four = (rs ?? []).filter((r) => (seen.has(r.country_iso2) ? false : (seen.add(r.country_iso2), true))).slice(0, 4);
  const { ctx, page } = await phone(browser, baseURL!, u.email, null);
  for (const r of four.slice(0, 3)) {
    const res = await page.request.post("/api/check-in", { data: { restaurantId: r.id, groupId: g.id, tagged: [], location: null } });
    expect(res.ok()).toBe(true);
  }
  await page.goto(`/check-in/${four[3].id}`);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.getByRole("button", { name: "Just me" }).click();
  await page.getByRole("button", { name: "Get my stamp" }).click();
  await expect(page.getByRole("heading", { name: "Stamp waiting" })).toBeVisible();
  await saved(page);
  await shot(page, "stamp-moment-waiting", true);
  const { data: w } = await admin()
    .from("visit_attendees")
    .select("visit_id")
    .eq("user_id", u.id)
    .eq("stamp_waiting", true)
    .single();
  await page.goto(`/visit/${w!.visit_id}`);
  await expect(page.getByRole("heading", { name: "Claim your stamp" })).toBeVisible();
  await shot(page, "visit-claim", true);
  await ctx.close();
});

test("a lost reply is retried with the same key: one visit, and the real stamp", async ({ browser, baseURL }) => {
  const place = await lao();
  const u = await createUser("lost", "Lost Reply Lou");
  await createGroup(u.id, "Lost Supper");
  const { ctx, page } = await phone(browser, baseURL!, u.email, { lat: place.lat, lon: place.lon });
  const keys: string[] = [];
  let first = true;
  await page.route("**/api/check-in", async (route) => {
    keys.push(JSON.parse(route.request().postData() ?? "{}").clientKey);
    if (first) {
      first = false;
      await route.fetch(); // the server saves it...
      await route.abort("connectionreset"); // ...and the reply is lost on the way back
      return;
    }
    await route.continue();
  });
  await page.goto(`/check-in/${place.id}`);
  await page.getByRole("button", { name: "Share my location" }).click();
  await page.getByRole("button", { name: "Just me" }).click();
  await page.getByRole("radio", { name: place.dish, exact: true }).click();
  await page.getByRole("button", { name: "Get my stamp" }).click();
  await expect(page.getByRole("heading", { name: "Stamped!" })).toBeVisible();
  await saved(page);
  await expect(page.getByRole("heading", { name: "Stamped!" })).toBeVisible();
  await expect(page.locator("body")).toContainText(/Total\s*27/);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  const { count } = await admin().from("visits").select("id", { count: "exact", head: true }).eq("created_by", u.id);
  expect(count).toBe(1);
  await ctx.close();
});

test("Skip while the location is loading: the late fix is ignored", async ({ browser, baseURL }) => {
  const place = await lao();
  const u = await createUser("skip", "Skip Sid");
  const g = await createGroup(u.id, "Skip Supper");
  const friend = await createUser("skipf", "Skip Friend");
  await admin().from("group_members").insert({ group_id: g.id, user_id: friend.id, role: "member" });
  const { ctx, page } = await phone(browser, baseURL!, u.email, null);
  await page.addInitScript(
    ([lat, lon]) => {
      navigator.geolocation.getCurrentPosition = (ok) => {
        setTimeout(
          () => ok({ coords: { latitude: lat, longitude: lon, accuracy: 15 } } as GeolocationPosition),
          1500,
        );
      };
    },
    [place.lat, place.lon],
  );
  const bodies: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/check-in")) bodies.push(r.postData() ?? "");
  });
  await page.goto(`/check-in/${place.id}`);
  await page.getByRole("button", { name: "Share my location" }).click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Who's at the table?" })).toBeVisible();
  await page.waitForTimeout(2000);
  // Still on the tagging step, and still unverified.
  await expect(page.getByRole("heading", { name: "Who's at the table?" })).toBeVisible();
  await expect(page.getByText("Unverified")).toBeVisible();
  await page.getByRole("button", { name: "Just me" }).click();
  await page.getByRole("button", { name: "Get my stamp" }).click();
  await saved(page);
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0]).location).toBeNull();
  await ctx.close();
});

test("a restaurant marked closed still takes a check-in", async ({ browser, baseURL }) => {
  // A country with two or more active restaurants, so closing one changes no passport status.
  const { data: rs } = await admin().from("restaurants").select("id, name, country_iso2").eq("status", "active").order("name");
  const byCountry = new Map<string, { id: string; name: string }[]>();
  for (const r of rs ?? []) byCountry.set(r.country_iso2, [...(byCountry.get(r.country_iso2) ?? []), r]);
  const [iso, list] = [...byCountry.entries()].find(([, l]) => l.length >= 2)!;
  const target = list[0];
  const u = await createUser("closed", "Closed Cleo");
  await createGroup(u.id, "Closed Supper");
  await admin().from("restaurants").update({ status: "closed" }).eq("id", target.id);
  try {
    const { ctx, page } = await phone(browser, baseURL!, u.email, null);
    await page.goto(`/restaurant/${target.id}`);
    await expect(page.getByText(/Marked closed/)).toBeVisible();
    await page.getByRole("link", { name: "Check in here" }).click();
    await expect(page.getByText(/check in anyway and tell the curator/)).toBeVisible();
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await page.getByRole("button", { name: "Just me" }).click();
    await page.getByRole("button", { name: "Get my stamp" }).click();
    await expect(page.getByRole("heading", { name: "Stamped!" })).toBeVisible();
    await saved(page);
    const { data: st } = await admin().from("stamps").select("visit_id").eq("user_id", u.id).eq("country_iso2", iso).single();
    expect(st!.visit_id).toBeTruthy();
    await ctx.close();
  } finally {
    await admin().from("restaurants").update({ status: "active" }).eq("id", target.id);
  }
});
