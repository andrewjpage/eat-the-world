import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { loginUrl } from "@/lib/app";

/**
 * Server-side session helpers for pages, layouts and server actions.
 * Each is cached for the duration of one request.
 */

export interface MyProfile {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  is_curator: boolean;
}

/** The signed-in user (verified with the Auth server), or null. */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
});

/** The signed-in user, or a redirect to /login that comes back to `returnTo`. */
export async function requireUser(returnTo: string): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect(loginUrl(returnTo));
  return user;
}

/** The signed-in user's profile row, or null when signed out. */
export const getMyProfile = cache(async (): Promise<MyProfile | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("user_id, display_name, avatar_url, is_curator")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data as MyProfile | null) ?? {
    user_id: user.id,
    display_name: user.email?.split("@")[0] ?? "Friend",
    avatar_url: null,
    is_curator: false,
  };
});

/** Server-side error text reaches users only for our own `raise exception` (SQLSTATE P0001). */
export { friendlyError } from "@/lib/errors";
