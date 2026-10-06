import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { admin, createGroup, createUser } from "./helpers";
import { serverRealtimeOptions } from "../../src/lib/supabase/node-realtime";

export const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** A Supabase client signed in as `email` (the same RLS and grants a browser gets). Data set-up only. */
export async function userClient(email: string): Promise<SupabaseClient> {
  const { data, error } = await admin().auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) throw new Error(`generateLink: ${error?.message}`);
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: serverRealtimeOptions(),
  });
  const v = await c.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw new Error(`verifyOtp: ${v.error.message}`);
  return c;
}

export type Person = { id: string; email: string; name: string };

/** An owner plus `extra` members in one group. */
export async function table(prefix: string, extra: number, groupName = "Table Supper") {
  const names = ["Alpha", "Bravo", "Charlie", "Delta"];
  const people: Person[] = [];
  for (let i = 0; i <= extra; i++) {
    const name = `${prefix} ${names[i]}`;
    people.push({ ...(await createUser(`${prefix.toLowerCase()}${i}`, name)), name });
  }
  const g = await createGroup(people[0].id, groupName);
  for (const p of people.slice(1)) {
    const { error } = await admin().from("group_members").insert({ group_id: g.id, user_id: p.id, role: "member" });
    if (error) throw new Error(error.message);
  }
  return { people, group: g };
}

export async function restaurantRow(name: string) {
  const { data, error } = await admin().from("restaurants").select("id, lat, lon, country_iso2").eq("name", name).single();
  if (error || !data) throw new Error(`restaurant ${name}: ${error?.message}`);
  return data as { id: string; lat: number; lon: number; country_iso2: string };
}

export async function firstDish(iso2: string): Promise<string> {
  const { data } = await admin()
    .from("signature_dishes")
    .select("id")
    .eq("country_iso2", iso2)
    .eq("status", "approved")
    .order("name")
    .limit(1)
    .single();
  return data!.id as string;
}

/**
 * The owner checks in with the others tagged; each of them confirms. Returns the visit id.
 * `geo` true sends the restaurant's own position (geo_verified); false sends none (self_reported).
 * `pending` people are tagged too but don't confirm.
 */
export async function dinner(
  owner: Person,
  others: Person[],
  groupId: string,
  restaurantName: string,
  geo: boolean,
  pending: Person[] = [],
): Promise<string> {
  const r = await restaurantRow(restaurantName);
  const dish = await firstDish(r.country_iso2);
  const a = await userClient(owner.email);
  const { data, error } = await a.rpc("check_in", {
    p_restaurant_id: r.id,
    p_group_id: groupId,
    p_lat: geo ? r.lat : null,
    p_lon: geo ? r.lon : null,
    p_accuracy: geo ? 20 : null,
    p_tagged: [...others, ...pending].map((o) => o.id),
    p_signature_dish_id: dish,
    p_rating: 5,
  });
  if (error) throw new Error(`check_in: ${error.message}`);
  const d = data as { visit_id?: string; visitId?: string };
  const visitId = d.visit_id ?? d.visitId;
  if (!visitId) throw new Error(`check_in result: ${JSON.stringify(data)}`);
  for (const o of others) {
    const c = await userClient(o.email);
    const res = await c.rpc("confirm_attendance", { p_visit_id: visitId, p_signature_dish_id: dish, p_rating: 4 });
    if (res.error) throw new Error(`confirm: ${res.error.message}`);
  }
  return visitId;
}
