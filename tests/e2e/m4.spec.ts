import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { exiftool } from "exiftool-vendored";
import { admin, cleanupUsers, restaurantId, signIn } from "./helpers";
import { UUID, dinner, table } from "./m4-helpers";
import { makeGpsJpeg } from "../fixtures/photos";

const OUT = "docs/screens/M4";
const BUCKET = "visit-photos";
const storedPhotos: string[] = [];
const tmpDirs: string[] = [];

test.afterAll(async () => {
  if (storedPhotos.length) await admin().storage.from(BUCKET).remove(storedPhotos.splice(0));
  for (const d of tmpDirs.splice(0)) await rm(d, { recursive: true, force: true });
  await exiftool.end();
  await cleanupUsers();
});

async function phone(browser: Browser, baseURL: string, email: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, baseURL });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("etw:ios-install-hint-dismissed", "1");
    } catch {}
  });
  const page = await ctx.newPage();
  await signIn(page, email);
  return { ctx, page };
}

async function shot(page: Page, name: string, scrollTo?: ReturnType<Page["locator"]>) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(700);
  if (scrollTo) await scrollTo.scrollIntoViewIfNeeded();
  else await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  // The Next.js dev indicator is not part of the app.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

const row = (page: Page, name: string) => page.getByTestId("leaderboard").getByRole("listitem").filter({ hasText: name });

async function upload(page: Page) {
  const buf = await makeGpsJpeg();
  const done = page.waitForResponse((r) => /\/api\/visits\/[^/]+\/photo/.test(r.url()) && r.request().method() === "POST");
  await page.getByTestId("photo-input").setInputFiles({ name: "dinner.jpg", mimeType: "image/jpeg", buffer: buf });
  expect((await done).status()).toBe(200);
}

test("group page: Together, and the leaderboard after a check-in with 3 confirmed", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const { people, group } = await table("Lead", 2, "Leaderboard Supper");
  const [a, b, c] = people;
  await dinner(a, [b, c], group.id, "Lao Café", true);

  const A = await phone(browser, baseURL!, a.email);
  await A.page.goto(`/group/${group.id}`);
  const together = A.page.getByTestId("together");
  await expect(together).toBeVisible();
  await expect(together).toContainText("Together");
  await expect(together).toContainText(/1\s*\/\s*\d+/);
  for (const p of people) {
    const r = row(A.page, p.name);
    await expect(r).toContainText(/32\s*pts/);
    await expect(r).toContainText(/1\s*country/);
  }
  await expect(A.page.getByRole("tab", { name: "All time" })).toHaveAttribute("aria-selected", "true");
  await A.ctx.close();
});

test("season excludes the visit; verified-only hides a self-reported visit", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const { people, group } = await table("Seas", 2, "Season Supper");
  const [a, b, c] = people;
  await dinner(a, [b, c], group.id, "Lao Café", false); // no location: self_reported

  const { ctx, page } = await phone(browser, baseURL!, a.email);
  await page.goto(`/group/${group.id}`);
  const open = page.getByTestId("group-settings-open").first();

  // The owner sets a season in the past.
  await open.click();
  await page.getByLabel("Starts", { exact: true }).fill("2020-01-01");
  await page.getByLabel("Ends", { exact: true }).fill("2020-01-31");
  await page.getByTestId("group-settings-save").click();
  await expect(page.getByTestId("leaderboard-note")).toContainText("Season");
  await expect(page.getByRole("tab", { name: "This season" })).toHaveAttribute("aria-selected", "true");
  for (const p of people) await expect(row(page, p.name)).toContainText(/(^|\D)0\s*pts/);
  await page.getByRole("tab", { name: "All time" }).click();
  for (const p of people) await expect(row(page, p.name)).toContainText(/32\s*pts/);

  // Clear the season; turn on verified only: the self-reported visit scores nothing.
  await open.click();
  await page.getByRole("button", { name: "Clear the season" }).click();
  await page.getByRole("dialog").getByLabel(/Verified only/).check();
  await page.getByTestId("group-settings-save").click();
  await expect(page.getByTestId("verified-only-note")).toBeVisible();
  await page.getByRole("tab", { name: "All time" }).click();
  for (const p of people) await expect(row(page, p.name)).toContainText(/(^|\D)0\s*pts/);

  // Turn it off again: points are back.
  await open.click();
  await page.getByRole("dialog").getByLabel(/Verified only/).uncheck();
  await page.getByTestId("group-settings-save").click();
  await expect(page.getByTestId("verified-only-note")).toHaveCount(0);
  for (const p of people) await expect(row(page, p.name)).toContainText(/32\s*pts/);

  const { data: g } = await admin().from("groups").select("verified_only, season_start, season_end").eq("id", group.id).single();
  expect(g).toEqual({ verified_only: false, season_start: null, season_end: null });
  await ctx.close();
});

test("reactions: counts only, and the owner's flag list", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const { people, group } = await table("Reac", 2, "Reaction Supper");
  const [a, b, c] = people;
  const v1 = await dinner(a, [b, c], group.id, "Lao Café", true);
  const v2 = await dinner(a, [b, c], group.id, "Fonda", true);

  // B and C each give Lao Café a side-eye.
  const B = await phone(browser, baseURL!, b.email);
  const C = await phone(browser, baseURL!, c.email);
  const card = (p: Page) => p.getByTestId("feed-item").filter({ hasText: "Lao Café" });
  for (const [x, n] of [
    [B, "Side-eye, 1"],
    [C, "Side-eye, 1"],
  ] as const) {
    await x.page.goto(`/group/${group.id}`);
    await card(x.page).getByTestId("react-side_eye").click();
    await expect(card(x.page).getByTestId("react-side_eye")).toHaveAttribute("aria-pressed", "true");
    expect(n).toBeTruthy();
  }
  await C.page.reload();
  const btn = card(C.page).getByTestId("react-side_eye");
  await expect(btn).toHaveAttribute("aria-label", "Side-eye, 2");
  // A count, never a name.
  const text = (await btn.innerText()).replace(/\s+/g, " ");
  expect(text).toMatch(/2/);
  for (const p of people) expect(`${text} ${await btn.getAttribute("aria-label")} ${await btn.getAttribute("title")}`).not.toContain(p.name);
  const { data: rows } = await admin().from("reactions").select("user_id").eq("visit_id", v1).eq("emoji", "side_eye");
  expect(rows).toHaveLength(2);

  // A member sees no flag list; the owner does.
  await expect(C.page.getByTestId("flag-list")).toHaveCount(0);
  const A = await phone(browser, baseURL!, a.email);
  await A.page.goto(`/group/${group.id}`);
  const flags = A.page.getByTestId("flag-list");
  await expect(flags.getByTestId("flag-item")).toHaveCount(1);
  await expect(flags).toContainText("Lao Café");
  await expect(flags.getByTestId("flag-item")).toContainText(/2\s*🤨/);
  await flags.getByRole("button", { name: "Dismiss" }).click();
  await expect(A.page.getByTestId("flag-empty")).toBeVisible();
  const { data: dismissed } = await admin().from("visits").select("verification, flag_resolved_at").eq("id", v1).single();
  expect(dismissed!.flag_resolved_at).not.toBeNull();
  expect(dismissed!.verification).toBe("geo_verified");

  // Another visit gets side-eyes; the owner downgrades it.
  const { error } = await admin()
    .from("reactions")
    .insert([b, c].map((u) => ({ visit_id: v2, user_id: u.id, emoji: "side_eye" })));
  expect(error).toBeNull();
  await A.page.reload();
  const flag2 = A.page.getByTestId("flag-list").getByTestId("flag-item");
  await expect(flag2).toHaveCount(1);
  await expect(flag2).toContainText("Fonda");
  await flag2.getByRole("button", { name: "Downgrade to self-reported" }).click();
  await A.page.getByTestId("downgrade-confirm").click();
  await expect(A.page.getByTestId("flag-empty")).toBeVisible();
  const { data: down } = await admin().from("visits").select("verification, downgraded_at").eq("id", v2).single();
  expect(down!.verification).toBe("self_reported");
  expect(down!.downgraded_at).not.toBeNull();
  for (const x of [A, B, C]) await x.ctx.close();
});

test("plan a dinner from the spin, RSVP, and download the .ics", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const { people, group } = await table("Plan", 2, "Plan Supper");
  const [a, b, c] = people;
  const A = await phone(browser, baseURL!, a.email);
  await A.page.goto(`/group/${group.id}`);
  await A.page.getByTestId("spin-button").click();
  await expect(A.page.getByTestId("spin-result")).toBeVisible({ timeout: 20_000 });
  await A.page.getByRole("link", { name: "Propose a dinner" }).click();
  await expect(A.page).toHaveURL(new RegExp(`/group/${group.id}/plan/new\\?restaurant=${UUID}`));
  await expect(A.page.getByTestId("picked-restaurant")).toBeVisible();
  // From Spin the date is already filled in (next Friday): one tap would do.
  await expect(A.page.locator("#plan-date")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  const when = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await A.page.locator("#plan-date").fill(when);
  await A.page.locator("#plan-time").fill("19:30");
  await A.page.getByRole("button", { name: "Plan the dinner" }).click();
  await expect(A.page).toHaveURL(new RegExp(`/group/${group.id}$`));
  const plan = A.page.getByTestId("plan-card");
  await expect(plan).toHaveCount(1);
  await expect(plan.getByTestId("rsvp-counts")).toContainText("1 yes");
  const planId = (await plan.getAttribute("data-plan-id"))!;

  // B says yes, C says maybe.
  const B = await phone(browser, baseURL!, b.email);
  await B.page.goto(`/group/${group.id}`);
  await B.page.getByTestId("plan-card").getByRole("button", { name: "I'm in" }).click();
  await expect(B.page.getByTestId("plan-card").getByRole("button", { name: "I'm in" })).toHaveAttribute("aria-pressed", "true");
  const C = await phone(browser, baseURL!, c.email);
  await C.page.goto(`/group/${group.id}`);
  await C.page.getByTestId("plan-card").getByRole("button", { name: "Maybe" }).click();
  await expect(C.page.getByTestId("plan-card").getByRole("button", { name: "Maybe" })).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => (await admin().from("plan_rsvps").select("user_id, response").eq("plan_id", planId)).data?.length)
    .toBe(3);
  const { data: rs } = await admin().from("plan_rsvps").select("user_id, response").eq("plan_id", planId);
  const byUser = Object.fromEntries((rs ?? []).map((r) => [r.user_id, r.response]));
  expect(byUser).toEqual({ [a.id]: "yes", [b.id]: "yes", [c.id]: "maybe" });
  await A.page.reload();
  await expect(A.page.getByTestId("rsvp-counts")).toContainText("2 yes");
  await expect(A.page.getByTestId("rsvp-counts")).toContainText("1 maybe");

  // The calendar file: through the link, and by request.
  const dl = A.page.waitForEvent("download");
  await A.page.getByRole("link", { name: /Add to calendar/ }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(/\.ics$/);
  const res = await B.ctx.request.get(`/api/plans/${planId}/ics`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/calendar");
  const ics = await res.text();
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(ics).toContain("BEGIN:VEVENT");
  // Inline, so iOS offers Add to Calendar; still named .ics.
  expect(res.headers()["content-disposition"]).toMatch(/^inline; filename=".+\.ics"$/);

  // Someone from another group gets a 404, not the plan.
  const other = await table("PlanOut", 0, "Elsewhere");
  const X = await phone(browser, baseURL!, other.people[0].email);
  const stranger = await X.ctx.request.get(`/api/plans/${planId}/ics`);
  expect(stranger.status()).toBe(404);
  expect(await stranger.text()).not.toContain("BEGIN:VCALENDAR");
  for (const x of [A, B, C, X]) await x.ctx.close();
});

test("recap PNG: image/png for a member, not for a stranger", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const { people, group } = await table("Recap", 2, "Recap Supper");
  const [a, b, c] = people;
  const visit = await dinner(a, [b, c], group.id, "Lao Café", true);
  const other = await table("Outsider", 0, "Elsewhere");

  const B = await phone(browser, baseURL!, b.email);
  const ok = await B.ctx.request.get(`/api/visits/${visit}/recap`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toContain("image/png");
  const png = await ok.body();
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(png.length).toBeGreaterThan(5_000);

  // Right after a check-in, tagged people who haven't confirmed are on the card too.
  const fresh = await dinner(a, [b], group.id, "Fonda", false, [c]);
  const withPending = await B.ctx.request.get(`/api/visits/${fresh}/recap`);
  expect(withPending.status()).toBe(200);
  expect(withPending.headers()["content-type"]).toContain("image/png");

  const X = await phone(browser, baseURL!, other.people[0].email);
  const no = await X.ctx.request.get(`/api/visits/${visit}/recap`);
  expect([403, 404]).toContain(no.status());
  expect(no.headers()["content-type"] ?? "").not.toContain("image/png");

  const anon = await browser.newContext({ baseURL: baseURL! });
  const out = await anon.request.get(`/api/visits/${visit}/recap`);
  expect(out.ok()).toBe(false);
  expect(out.headers()["content-type"] ?? "").not.toContain("image/png");
  for (const x of [anon, B.ctx, X.ctx]) await x.close();
});

test("photo: upload through the UI, photo-verified, and the stored file has no EXIF", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const { people, group } = await table("Pic", 0, "Photo Supper");
  const [a] = people;
  const visit = await dinner(a, [], group.id, "Lao Café", false);
  const { data: before } = await admin().from("visits").select("verification, photo_path").eq("id", visit).single();
  expect(before).toEqual({ verification: "self_reported", photo_path: null });

  const { ctx, page } = await phone(browser, baseURL!, a.email);
  await page.goto(`/visit/${visit}`);
  await upload(page);
  await expect(page.getByText(/Photo added/)).toBeVisible();
  await page.reload();
  await expect(page.locator('img[alt^="Photo from"]')).toBeVisible();
  await expect(page.locator("main")).toContainText("Photo");

  const { data: after } = await admin().from("visits").select("verification, photo_path").eq("id", visit).single();
  expect(after!.verification).toBe("photo");
  expect(after!.photo_path).toBeTruthy();
  storedPhotos.push(after!.photo_path as string);

  const { data: blob, error } = await admin().storage.from(BUCKET).download(after!.photo_path as string);
  expect(error).toBeNull();
  const dir = await mkdtemp(join(tmpdir(), "etw-photo-"));
  tmpDirs.push(dir);
  const file = join(dir, "stored.jpg");
  await writeFile(file, Buffer.from(await blob!.arrayBuffer()));
  const tags = await exiftool.read(file);
  expect(tags.FileType).toBe("JPEG");
  for (const k of ["GPSLatitude", "GPSLongitude", "GPSPosition", "Make", "Model", "ImageDescription", "Orientation", "DateTimeOriginal", "CreateDate"] as const) {
    expect(tags[k], k).toBeUndefined();
  }
  const groups = Object.keys(await exiftool.read(file, ["-G1", "-a", "-s"]).then((t) => t as Record<string, unknown>));
  expect(groups.some((k) => /^(GPS|Make|Model|ImageDescription)/.test(k))).toBe(false);
  expect(Math.max(tags.ImageWidth!, tags.ImageHeight!)).toBeLessThanOrEqual(1600);
  await ctx.close();
});

test("M4 screenshots @screens", async ({ browser, baseURL }) => {
  test.skip(!process.env.SCREENS, "set SCREENS=1 to regenerate docs/screens/M4 (after npm run dev:fixtures)");
  test.setTimeout(240_000);
  const { data: g } = await admin().from("groups").select("id").eq("name", "Supper Club").single();
  const gid = g!.id as string;
  const { data: members } = await admin().from("group_members").select("user_id, profiles(display_name)").eq("group_id", gid);
  const uid = (name: string) =>
    (members ?? []).find((m) => (m.profiles as unknown as { display_name: string }).display_name === name)!.user_id as string;
  const { data: visits } = await admin()
    .from("visits")
    .select("id")
    .eq("group_id", gid)
    .order("visited_at", { ascending: false })
    .limit(3);
  expect((visits ?? []).length).toBeGreaterThan(1);

  // Seed reactions and a plan, and take them away afterwards.
  const wanted = [
    { visit_id: visits![0].id, user_id: uid("Bea"), emoji: "side_eye" },
    { visit_id: visits![0].id, user_id: uid("Chidi"), emoji: "side_eye" },
    { visit_id: visits![0].id, user_id: uid("Dana"), emoji: "clap" },
    { visit_id: visits![1].id, user_id: uid("Bea"), emoji: "drool" },
    { visit_id: visits![1].id, user_id: uid("Eli"), emoji: "clap" },
  ];
  const added: typeof wanted = [];
  for (const r of wanted) {
    const { data: have } = await admin().from("reactions").select("emoji").match(r).maybeSingle();
    if (have) continue;
    const { error } = await admin().from("reactions").insert(r);
    if (!error) added.push(r);
  }
  const fonda = await restaurantId("Fonda");
  const { data: plan } = await admin()
    .from("plans")
    .insert({ group_id: gid, restaurant_id: fonda, proposed_by: uid("Andrew"), proposed_for: new Date(Date.now() + 4 * 86_400_000).toISOString() })
    .select("id")
    .single();
  await admin().from("plan_rsvps").insert([
    { plan_id: plan!.id, user_id: uid("Andrew"), response: "yes" },
    { plan_id: plan!.id, user_id: uid("Bea"), response: "yes" },
    { plan_id: plan!.id, user_id: uid("Chidi"), response: "maybe" },
  ]);

  try {
    const A = await phone(browser, baseURL!, "andrew@demo.local");
    const p = A.page;
    await p.goto(`/group/${gid}`);
    await shot(p, "group-top");
    await p.getByTestId("spin-button").click();
    await expect(p.getByTestId("spin-result")).toBeVisible({ timeout: 20_000 });
    await shot(p, "spin-result", p.getByTestId("spin-card"));
    await shot(p, "leaderboard", p.getByTestId("leaderboard"));
    await shot(p, "feed-reactions", p.getByTestId("feed-item").first());
    await shot(p, "owner-flag-list", p.getByTestId("flag-list"));
    await p.goto(`/group/${gid}/plan/new?restaurant=${fonda}`);
    await expect(p.getByTestId("picked-restaurant")).toBeVisible();
    await shot(p, "plan-new");
    await p.goto(`/group/${gid}/plan`);
    await expect(p.getByTestId("plan-card").first()).toBeVisible();
    await shot(p, "plan-list-rsvps");

    await A.ctx.close();

    // The recap card from a fresh table of three: two confirmed, one still confirming.
    const r = await table("Card", 2, "Card Table");
    const rv = await dinner(r.people[0], [r.people[1]], r.group.id, "Lao Café", true, [r.people[2]]);
    const R = await phone(browser, baseURL!, r.people[0].email);
    const recap = await R.ctx.request.get(`/api/visits/${rv}/recap`);
    expect(recap.headers()["content-type"]).toContain("image/png");
    await writeFile(`${OUT}/recap.png`, await recap.body());
    await R.ctx.close();

    // A visit with a photo, on a throwaway table (the demo group keeps its data).
    const t = await table("Shot", 1, "Photo Table");
    const visit = await dinner(t.people[0], [t.people[1]], t.group.id, "Lao Café", false);
    const P = await phone(browser, baseURL!, t.people[0].email);
    await P.page.goto(`/visit/${visit}`);
    await upload(P.page);
    await P.page.reload();
    await expect(P.page.locator('img[alt^="Photo from"]')).toBeVisible();
    const { data: v } = await admin().from("visits").select("photo_path").eq("id", visit).single();
    storedPhotos.push(v!.photo_path as string);
    await shot(P.page, "visit-photo");
    await P.ctx.close();
  } finally {
    for (const r of added) await admin().from("reactions").delete().match(r);
    await admin().from("plans").delete().eq("id", plan!.id);
  }
});
