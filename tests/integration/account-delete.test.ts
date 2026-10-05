import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { handleAccountDelete, PHOTO_BUCKET } from "@/app/api/account/handle";
import { serverRealtimeOptions } from "@/lib/supabase/node-realtime";
import { isLocalUrl } from "../helpers/local-db";

// Brief section 3's worked example, then Alice deletes her account (brief section 8): Bob and
// Cara keep 32, and the visit's photo object is gone. Runs only against the local stack:
// it creates users and commits rows. No coordinates are used.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const local = isLocalUrl(url) && Boolean(anon) && Boolean(serviceKey);

const opts = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: serverRealtimeOptions(),
};
const PASSWORD = "correct-horse-battery-staple";
const COUNTRY = "LA"; // the worked example's country (Laos)

let admin: SupabaseClient;
let tag = "";
let cityId = "";
const userIds: string[] = [];
let groupId = "";

type Reply<T> = PromiseLike<{ data: T; error: { message: string } | null }>;

/** The data of a reply that must have succeeded and returned something. */
async function must<T>(p: Reply<T>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error || data === null || data === undefined) throw new Error(error?.message ?? "no data");
  return data;
}

/** A reply that must have succeeded (inserts, void functions). */
async function ok(p: Reply<unknown>): Promise<void> {
  const { error } = await p;
  if (error) throw new Error(error.message);
}

async function newUser(name: string): Promise<SupabaseClient> {
  const email = `del-${tag}-${name}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user) throw new Error(error?.message ?? "no user");
  userIds.push(data.user.id);
  const client = createClient(url!, anon!, opts);
  const signedIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signedIn.error) throw new Error(signedIn.error.message);
  return client;
}

const uid = (c: SupabaseClient) => c.auth.getUser().then((r) => r.data.user!.id);

describe.skipIf(!local)("worked example, then Alice deletes her account", () => {
  beforeAll(() => {
    tag = randomUUID().slice(0, 8);
    admin = createClient(url!, serviceKey!, opts);
  });

  afterAll(async () => {
    if (!admin) return;
    if (groupId) await admin.from("groups").delete().eq("id", groupId);
    if (userIds.length) await admin.from("profiles").delete().in("user_id", userIds);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
    if (cityId) {
      await admin.from("restaurants").delete().eq("city_id", cityId);
      await admin.from("city_countries").delete().eq("city_id", cityId);
      await admin.from("cities").delete().eq("id", cityId);
    }
    await admin.from("signature_dishes").delete().eq("name", `Larb ${tag}`);
  });

  it("leaves Bob and Cara on 32 and removes the photo object", async () => {
    // A city of its own, so the Lao restaurant is the only one there (rarity bonus 15).
    const city = await must(
      admin.from("cities").insert({ name: `Del ${tag}`, slug: `del-${tag}` }).select("id").single(),
    );
    cityId = city.id;
    await ok(
      admin.from("city_countries").insert({ city_id: cityId, country_iso2: COUNTRY, status: "unlisted" }),
    );
    const restaurant = await must(
      admin
        .from("restaurants")
        .insert({
          city_id: cityId,
          country_iso2: COUNTRY,
          name: `Lao ${tag}`,
          address: "1 Test Street",
          postcode: `D${tag.toUpperCase()}`,
          lat: 51.5074,
          lon: -0.1278,
          status: "active",
          confidence: "curated",
        })
        .select("id")
        .single(),
    );
    const dish = await must(
      admin
        .from("signature_dishes")
        .insert({ country_iso2: COUNTRY, name: `Larb ${tag}`, status: "approved" })
        .select("id")
        .single(),
    );

    const alice = await newUser("alice");
    const bob = await newUser("bob");
    const cara = await newUser("cara");
    const [aliceId, bobId, caraId] = [await uid(alice), await uid(bob), await uid(cara)];

    // Groups are invite-only: Alice is lent the curator flag to start one.
    await ok(admin.from("profiles").update({ is_curator: true }).eq("user_id", aliceId));
    groupId = await must(alice.rpc("create_group", { p_name: `Del ${tag}` }));
    await ok(admin.from("profiles").update({ is_curator: false }).eq("user_id", aliceId));
    const { invite_code } = await must(
      admin.from("groups").select("invite_code").eq("id", groupId).single(),
    );
    await ok(bob.rpc("join_group", { p_invite_code: invite_code }));
    await ok(cara.rpc("join_group", { p_invite_code: invite_code }));

    // Alice checks in and tags Bob and Cara; each confirms with the signature dish.
    const first = await must(
      alice.rpc("check_in", {
        p_restaurant_id: restaurant.id,
        p_group_id: groupId,
        p_lat: null,
        p_lon: null,
        p_accuracy: null,
        p_tagged: [bobId, caraId],
        p_signature_dish_id: dish.id,
        p_dish_other: null,
        p_rating: null,
        p_note: null,
        p_client_key: randomUUID(),
      }),
    );
    const visitId = (first as { visit_id: string }).visit_id;
    for (const friend of [bob, cara]) {
      await ok(
        friend.rpc("confirm_attendance", {
          p_visit_id: visitId,
          p_signature_dish_id: dish.id,
          p_dish_other: null,
          p_rating: null,
          p_note: null,
        }),
      );
    }

    const totals = async () =>
      (
        await must(
          admin
            .from("stamp_totals")
            .select("user_id, points")
            .eq("country_iso2", COUNTRY)
            .in("user_id", [aliceId, bobId, caraId]),
        )
      ).map((r) => [r.user_id, r.points] as const);
    expect(new Map(await totals())).toEqual(
      new Map([
        [aliceId, 32],
        [bobId, 32],
        [caraId, 32],
      ]),
    );

    // Alice adds the visit's photo (a stored object, then the link).
    const photoPath = `${groupId}/${visitId}.jpg`;
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const up = await admin.storage
      .from(PHOTO_BUCKET)
      .upload(photoPath, jpeg, { contentType: "image/jpeg", upsert: true });
    expect(up.error).toBeNull();
    await ok(alice.rpc("set_visit_photo", { p_visit_id: visitId, p_photo_path: photoPath }));
    expect((await admin.storage.from(PHOTO_BUCKET).download(photoPath)).error).toBeNull();

    // Alice deletes her account through the same handler the route uses.
    const response = await handleAccountDelete({ supabase: alice, admin });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, redirect: "/privacy/goodbye" });

    // Bob and Cara keep 32; Alice's stamp, profile and login are gone.
    const after = new Map(await totals());
    expect(after.get(bobId)).toBe(32);
    expect(after.get(caraId)).toBe(32);
    expect(after.has(aliceId)).toBe(false);
    expect((await admin.auth.admin.getUserById(aliceId)).data.user).toBeNull();

    // The visit stays for them, anonymised and without its photo; the object is gone.
    const visit = await must(
      admin.from("visits").select("created_by, photo_path").eq("id", visitId).single(),
    );
    expect(visit).toEqual({ created_by: null, photo_path: null });
    expect((await admin.storage.from(PHOTO_BUCKET).download(photoPath)).error).not.toBeNull();
    const { data: listed } = await admin.storage.from(PHOTO_BUCKET).list(groupId);
    expect(listed?.map((o) => o.name) ?? []).not.toContain(`${visitId}.jpg`);

    // Ownership passed to the longest-standing member (Bob joined first).
    const group = await must(admin.from("groups").select("owner_id").eq("id", groupId).single());
    expect(group.owner_id).toBe(bobId);
  });

  it("refuses a signed-out caller", async () => {
    const anonymous = createClient(url!, anon!, opts);
    const response = await handleAccountDelete({ supabase: anonymous, admin });
    expect(response.status).toBe(401);
  });
});
