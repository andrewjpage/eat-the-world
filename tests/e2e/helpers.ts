import { existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import { serverRealtimeOptions } from "../../src/lib/supabase/node-realtime";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

let _admin: SupabaseClient | null = null;

/** Service-role client. Test-only; never imported by app code. */
export function admin(): SupabaseClient {
  if (!_admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error("e2e runs against local Supabase only");
    _admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: serverRealtimeOptions(),
    });
  }
  return _admin;
}

const created: string[] = [];

/** Create a throwaway confirmed user. Tracked for cleanup. */
export async function createUser(label: string, displayName?: string) {
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.local`;
  const { data, error } = await admin().auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: displayName ? { full_name: displayName } : undefined,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  created.push(data.user.id);
  return { id: data.user.id, email };
}

/** Sign in via a magic-link token, exactly like a clicked email link. */
export async function signIn(page: Page, email: string, next = "/") {
  const { data, error } = await admin().auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) throw new Error(`generateLink: ${error?.message}`);
  const q = new URLSearchParams({ token_hash: data.properties.hashed_token, type: "magiclink", next });
  await page.goto(`/auth/confirm?${q}`);
}

/** Delete every user created in this run, plus groups they own. */
export async function cleanupUsers() {
  await restoreUncharted();
  const ids = created.splice(0);
  if (!ids.length) return;
  await admin().from("groups").delete().in("owner_id", ids);
  for (const id of ids) await admin().auth.admin.deleteUser(id);
}

const markedUncharted: { city_id: string; country_iso2: string }[] = [];

/** The seed has no uncharted rows (a curator sets them), so mark one and restore it in cleanup. */
export async function markUncharted(iso2: string) {
  const { data: city } = await admin().from("cities").select("id").eq("slug", "london").single();
  const { error } = await admin()
    .from("city_countries")
    .upsert({ city_id: city!.id, country_iso2: iso2, status: "uncharted" });
  if (error) throw new Error(`markUncharted: ${error.message}`);
  markedUncharted.push({ city_id: city!.id as string, country_iso2: iso2 });
}

/** Put the seeded row back to `unlisted` (the seed has one row per country; never delete it). */
async function restoreUncharted() {
  for (const m of markedUncharted.splice(0)) {
    await admin()
      .from("city_countries")
      .update({ status: "unlisted" })
      .eq("city_id", m.city_id)
      .eq("country_iso2", m.country_iso2);
  }
}

/** A group owned by `ownerId`, created directly (no UI). Deleted with its owner in cleanup. */
export async function createGroup(ownerId: string, name: string) {
  const code = Array.from({ length: 8 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
  const { data, error } = await admin()
    .from("groups")
    .insert({ name, owner_id: ownerId, invite_code: code })
    .select("id, invite_code")
    .single();
  if (error || !data) throw new Error(`createGroup: ${error?.message}`);
  const { error: memberError } = await admin()
    .from("group_members")
    .insert({ group_id: data.id, user_id: ownerId, role: "owner" });
  if (memberError) throw new Error(`createGroup member: ${memberError.message}`);
  return { id: data.id as string, inviteCode: data.invite_code as string };
}

/** Mark a throwaway address (one that createUser didn't make) for deletion in cleanup. */
export async function trackUserByEmail(email: string) {
  const { data } = await admin().auth.admin.listUsers({ perPage: 1000 });
  const u = data?.users.find((x) => x.email === email);
  if (u) created.push(u.id);
  return u?.id ?? null;
}

/**
 * The latest sign-in email sent to `to`, from the local Supabase mail catcher
 * (MAILPIT_URL). Returns the "tap here to sign in" link.
 */
export async function latestSignInLink(to: string): Promise<string> {
  const base = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
  const host = new URL(base).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Mailpit must be local");
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`);
    const list = (await res.json()) as { messages?: { ID: string }[] };
    const id = list.messages?.[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${base}/api/v1/message/${id}`)).json()) as { HTML: string };
      const href = msg.HTML.match(/href="([^"]*\/auth\/confirm\?[^"]*)"/)?.[1];
      if (!href) throw new Error("no sign-in link in the email");
      return href.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email to ${to}`);
}

/** Look up a restaurant id by name. */
export async function restaurantId(name: string): Promise<string> {
  const { data, error } = await admin().from("restaurants").select("id").eq("name", name).limit(1).single();
  if (error || !data) throw new Error(`restaurant ${name}: ${error?.message}`);
  return data.id as string;
}

/** First ISO2 in London with the given passport status. */
export async function countryWithStatus(status: "listed" | "unlisted" | "uncharted", offset = 0) {
  const { data: city } = await admin().from("cities").select("id").eq("slug", "london").single();
  const { data } = await admin()
    .from("city_country_status")
    .select("country_iso2")
    .eq("city_id", city!.id)
    .eq("status", status)
    .order("country_iso2");
  const row = (data ?? [])[offset];
  if (!row) throw new Error(`no ${status} country`);
  return row.country_iso2 as string;
}
