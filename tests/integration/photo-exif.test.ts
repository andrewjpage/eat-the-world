import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { exiftool } from "exiftool-vendored";
import { handlePhotoUpload, PHOTO_BUCKET } from "@/app/api/visits/[id]/photo/handle";
import { jpegCarriesMetadata } from "@/app/api/visits/[id]/photo/process";
import { serverRealtimeOptions } from "@/lib/supabase/node-realtime";
import { isLocalUrl, testCountryRows } from "../helpers/local-db";
import { FIXTURE_GPS, makeGpsJpeg, makeHeicLike } from "../fixtures/photos";

// Runs only against the local Supabase stack (.env.local pointing at localhost).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const local = isLocalUrl(url) && !!anon && !!service;

const opts = { auth: { persistSession: false, autoRefreshToken: false }, realtime: serverRealtimeOptions() };

/** Group names the stored file may carry: file plumbing and the JFIF header, no metadata. */
const PLAIN_GROUPS = new Set(["SourceFile", "ExifTool", "System", "File", "Composite", "JFIF"]);

describe.skipIf(!local)("photo route: EXIF and GPS never reach storage", () => {
  let admin: SupabaseClient;
  let tmp: string;
  const userIds: string[] = [];
  const stored: string[] = [];
  let groupId: string;
  let restaurantId: string;
  let cityId = "";
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let outsider: SupabaseClient;
  let gps: Buffer;
  let bobId: string;

  async function newUser(label: string) {
    const email = `photo-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.local`;
    const password = `pw-${Math.random().toString(36).slice(2)}-Aa1!`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    userIds.push(data.user.id);
    const client = createClient(url!, anon!, opts);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`signIn: ${signInError.message}`);
    return { id: data.user.id, client };
  }

  async function checkIn(client: SupabaseClient, tagged: string[] = []) {
    const { data, error } = await client.rpc("check_in", {
      p_restaurant_id: restaurantId,
      p_group_id: groupId,
      p_lat: null,
      p_lon: null,
      p_accuracy: null,
      p_tagged: tagged,
      p_signature_dish_id: null,
      p_dish_other: null,
      p_rating: null,
      p_note: null,
      p_client_key: crypto.randomUUID(),
    });
    if (error) throw new Error(`check_in: ${error.message}`);
    return (data as { visit_id: string }).visit_id;
  }

  /** What the browser sends: the bytes as the body, with an image Content-Type. */
  const post = (body: Uint8Array | null, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/visits/x/photo", {
      method: "POST",
      headers: { "content-type": "image/jpeg", ...headers },
      body: body ? new Uint8Array(body) : null,
    });

  const visitRow = async (id: string) =>
    (await admin.from("visits").select("verification, photo_path").eq("id", id).single()).data!;

  async function objectExists(path: string) {
    const dir = path.split("/")[0];
    const { data } = await admin.storage.from(PHOTO_BUCKET).list(dir);
    return (data ?? []).some((o) => `${dir}/${o.name}` === path);
  }

  beforeAll(async () => {
    admin = createClient(url!, service!, opts);
    tmp = await mkdtemp(join(tmpdir(), "etw-photo-"));
    gps = await makeGpsJpeg();

    const a = await newUser("alice");
    const b = await newUser("bob");
    const o = await newUser("outsider");
    alice = a.client;
    bob = b.client;
    outsider = o.client;
    bobId = b.id;

    const code = Array.from({ length: 8 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
    const { data: g, error } = await admin
      .from("groups")
      .insert({ name: "Photo test", owner_id: a.id, invite_code: code })
      .select("id")
      .single();
    if (error || !g) throw new Error(`group: ${error?.message}`);
    groupId = g.id;
    await admin.from("group_members").insert([
      { group_id: groupId, user_id: a.id, role: "owner" },
      { group_id: groupId, user_id: b.id, role: "member" },
    ]);
    // Its own city and restaurant, so the test passes on an unseeded database (CI runs it
    // before the seed).
    const slug = `photo-${crypto.randomUUID().slice(0, 8)}`;
    const { data: city, error: cityErr } = await admin.from("cities").insert({ name: slug, slug }).select("id").single();
    if (cityErr || !city) throw new Error(`city: ${cityErr?.message}`);
    cityId = city.id;
    const { error: countryErr } = await admin
      .from("countries")
      .upsert(testCountryRows(["LA"]), { onConflict: "iso2", ignoreDuplicates: true });
    if (countryErr) throw new Error(`country: ${countryErr.message}`);
    const { data: r, error: rErr } = await admin
      .from("restaurants")
      .insert({
        city_id: cityId,
        country_iso2: "LA",
        name: `Photo ${slug}`,
        address: "1 Test Street",
        postcode: "WC2N 4HG",
        lat: 51.5098,
        lon: -0.1243,
        status: "active",
        confidence: "curated",
      })
      .select("id")
      .single();
    if (rErr || !r) throw new Error(`restaurant: ${rErr?.message}`);
    restaurantId = r.id;
  });

  afterAll(async () => {
    try {
      if (stored.length) await admin.storage.from(PHOTO_BUCKET).remove(stored);
      if (groupId) await admin.from("groups").delete().eq("id", groupId);
      for (const id of userIds) await admin.auth.admin.deleteUser(id);
      if (cityId) {
        await admin.from("restaurants").delete().eq("city_id", cityId);
        await admin.from("city_countries").delete().eq("city_id", cityId);
        await admin.from("cities").delete().eq("id", cityId);
      }
      if (tmp) await rm(tmp, { recursive: true, force: true });
    } finally {
      await exiftool.end();
    }
  });

  it("fixture really carries GPS, camera details and a 48 MP size", async () => {
    const file = join(tmp, "fixture.jpg");
    await writeFile(file, gps);
    const tags = await exiftool.read(file);
    expect(tags.ImageWidth).toBe(8000);
    expect(tags.ImageHeight).toBe(6000);
    expect(tags.GPSLatitude).toBeCloseTo(51.507, 2);
    expect(tags.Make).toBe("EtwTestCam");
    expect(tags.Orientation).toBe(6);
    expect(gps.length).toBeLessThan(4_500_000);
    expect(jpegCarriesMetadata(gps)).toBe(true);
    expect(FIXTURE_GPS.lat).toBeTruthy();
  });

  it("refuses without a session, for someone else's visit and for a non-member", async () => {
    const visit = await checkIn(alice);
    const anonymous = createClient(url!, anon!, opts);
    expect((await handlePhotoUpload(post(gps), visit, { supabase: anonymous, admin })).status).toBe(401);
    // Bob is in the group and can see the visit, but didn't check in.
    expect((await handlePhotoUpload(post(gps), visit, { supabase: bob, admin })).status).toBe(403);
    // A stranger can't even see it.
    expect((await handlePhotoUpload(post(gps), visit, { supabase: outsider, admin })).status).toBe(404);
    expect((await handlePhotoUpload(post(gps), "not-a-uuid", { supabase: alice, admin })).status).toBe(404);
    expect(await visitRow(visit)).toMatchObject({ photo_path: null, verification: "self_reported" });
  });

  it("refuses HEIC, a non-image Content-Type and an oversized request, storing nothing", async () => {
    const visit = await checkIn(alice);
    const path = `${groupId}/${visit}.jpg`;

    const heic = await handlePhotoUpload(post(makeHeicLike(), { "content-type": "image/heic" }), visit, {
      supabase: alice,
      admin,
    });
    expect(heic.status).toBe(415);
    expect(((await heic.json()) as { error: string }).error).toMatch(/JPEG, PNG or WebP/);
    // Claiming JPEG does not help: the bytes decide.
    expect((await handlePhotoUpload(post(makeHeicLike()), visit, { supabase: alice, admin })).status).toBe(415);

    const text = new Request("http://localhost/x", { method: "POST", headers: { "content-type": "text/plain" }, body: "hi" });
    expect((await handlePhotoUpload(text, visit, { supabase: alice, admin })).status).toBe(415);

    const big = await handlePhotoUpload(post(gps, { "content-length": "4600000" }), visit, { supabase: alice, admin });
    expect(big.status).toBe(413);
    // A body that is bigger than it says is stopped while reading.
    const huge = new Uint8Array(4_600_000);
    huge.set([0xff, 0xd8, 0xff]);
    expect((await handlePhotoUpload(post(huge, { "content-length": "100" }), visit, { supabase: alice, admin })).status).toBe(413);

    expect(await objectExists(path)).toBe(false);
    expect(await visitRow(visit)).toMatchObject({ photo_path: null, verification: "self_reported" });
  });

  it("without sharp, an unstripped JPEG is refused and nothing is stored", async () => {
    const visit = await checkIn(alice);
    const res = await handlePhotoUpload(post(gps), visit, { supabase: alice, admin, sharp: null });
    expect(res.status).toBe(422);
    expect(await objectExists(`${groupId}/${visit}.jpg`)).toBe(false);
    expect(await visitRow(visit)).toMatchObject({ photo_path: null });
  });

  it("removes the stored object when the database refuses the photo", async () => {
    const visit = await checkIn(alice);
    const failing = new Proxy(alice, {
      get(target, prop) {
        if (prop === "rpc") return async () => ({ data: null, error: { message: "boom" } });
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const res = await handlePhotoUpload(post(gps), visit, { supabase: failing, admin });
    expect(res.status).toBe(500);
    expect(await objectExists(`${groupId}/${visit}.jpg`)).toBe(false);
    expect(await visitRow(visit)).toMatchObject({ photo_path: null });
  });

  it("an orphan left by a failed cleanup does not block the next upload", async () => {
    const visit = await checkIn(alice);
    const path = `${groupId}/${visit}.jpg`;
    const orphan = await admin.storage
      .from(PHOTO_BUCKET)
      .upload(path, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { contentType: "image/jpeg" });
    expect(orphan.error).toBeNull();
    stored.push(path);
    const res = await handlePhotoUpload(post(gps), visit, { supabase: alice, admin });
    expect(res.status).toBe(200);
    expect(await visitRow(visit)).toMatchObject({ photo_path: path, verification: "photo" });
    const { data } = await admin.storage.from(PHOTO_BUCKET).download(path);
    expect((await data!.arrayBuffer()).byteLength).toBeGreaterThan(4); // the real photo replaced it
  });

  it("stores a metadata-free JPEG within 1600 px and makes the visit and every stamp 'photo'", async () => {
    // Bob is tagged and confirms first: the photo arrives after the confirmations.
    const visit = await checkIn(alice, [bobId]);
    const { error: confirmError } = await bob.rpc("confirm_attendance", {
      p_visit_id: visit,
      p_signature_dish_id: null,
      p_dish_other: null,
      p_rating: null,
      p_note: null,
    });
    expect(confirmError).toBeNull();
    const before = await admin.from("stamps").select("verification").eq("visit_id", visit);
    expect(before.data!.length).toBeGreaterThan(0);

    const res = await handlePhotoUpload(post(gps), visit, { supabase: alice, admin });
    const json = (await res.json()) as { ok?: boolean; verification?: string; error?: string };
    expect(res.status, json.error).toBe(200);
    expect(json).toMatchObject({ ok: true, verification: "photo" });

    const path = `${groupId}/${visit}.jpg`;
    stored.push(path);
    expect(await visitRow(visit)).toEqual({ verification: "photo", photo_path: path });
    const stamps = await admin.from("stamps").select("verification").eq("visit_id", visit);
    expect(stamps.data!.length).toBe(before.data!.length);
    expect(stamps.data!.every((s) => s.verification === "photo")).toBe(true);

    // Download what is really in the bucket and inspect it with exiftool.
    const { data: blob, error } = await admin.storage.from(PHOTO_BUCKET).download(path);
    expect(error).toBeNull();
    const bytes = Buffer.from(await blob!.arrayBuffer());
    const file = join(tmp, "stored.jpg");
    await writeFile(file, bytes);

    const tags = await exiftool.read(file);
    expect(tags.FileType).toBe("JPEG");
    expect(tags.GPSLatitude).toBeUndefined();
    expect(tags.GPSLongitude).toBeUndefined();
    expect(tags.GPSPosition).toBeUndefined();
    expect(tags.Make).toBeUndefined();
    expect(tags.Model).toBeUndefined();
    expect(tags.ImageDescription).toBeUndefined();
    expect(tags.Orientation).toBeUndefined();
    // The orientation was applied to the pixels: 8000x6000 flagged "rotate 90" is portrait.
    expect(tags.ImageWidth).toBe(1200);
    expect(tags.ImageHeight).toBe(1600);
    expect(Math.max(tags.ImageWidth!, tags.ImageHeight!)).toBeLessThanOrEqual(1600);

    // No EXIF, GPS, XMP, IPTC, ICC or maker-note block of any kind, by exiftool's own groups.
    const raw = await exiftool.readRaw(file, ["-G1", "-a", "-s"]);
    const groups = new Set(Object.keys(raw).filter((k) => k.includes(":")).map((k) => k.split(":")[0]));
    expect(groups.size).toBeGreaterThan(2); // the read worked
    expect([...groups].filter((g) => !PLAIN_GROUPS.has(g))).toEqual([]);
    // And by the bytes, independently of our own code.
    const text = bytes.toString("latin1");
    expect(text).not.toContain("Exif");
    expect(text).not.toContain("http://ns.adobe.com/xap");
    expect(text).not.toContain("ICC_PROFILE");
    expect(text).not.toContain("EtwTestCam");

    // Members read it through a short-lived signed URL as themselves; strangers cannot.
    const signed = await bob.storage.from(PHOTO_BUCKET).createSignedUrl(path, 60);
    expect(signed.error).toBeNull();
    expect((await fetch(signed.data!.signedUrl)).status).toBe(200);
    expect((await outsider.storage.from(PHOTO_BUCKET).createSignedUrl(path, 60)).data).toBeNull();

    // A retry after a lost response is a success for the creator, and the first photo stays.
    const again = await handlePhotoUpload(post(gps), visit, { supabase: alice, admin });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, already: true, verification: "photo" });
    expect((await visitRow(visit)).photo_path).toBe(path);
    const { data: still } = await admin.storage.from(PHOTO_BUCKET).download(path);
    expect(Buffer.from(await still!.arrayBuffer()).equals(bytes)).toBe(true);
    // Anyone else still can't.
    expect((await handlePhotoUpload(post(gps), visit, { supabase: bob, admin })).status).toBe(403);
  });

  it("a PNG with transparency is accepted and comes out as a plain JPEG", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } })
      .png()
      .toBuffer();
    const visit = await checkIn(alice);
    const res = await handlePhotoUpload(post(png, { "content-type": "image/png" }), visit, { supabase: alice, admin });
    expect(res.status).toBe(200);
    const path = `${groupId}/${visit}.jpg`;
    stored.push(path);
    const { data } = await admin.storage.from(PHOTO_BUCKET).download(path);
    const out = Buffer.from(await data!.arrayBuffer());
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(jpegCarriesMetadata(out)).toBe(false);
  });
});
