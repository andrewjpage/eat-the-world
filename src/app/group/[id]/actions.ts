"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, getSessionUser } from "@/components/auth/session";

/** Server actions for the group page. Every one re-checks the session; Postgres enforces the roles. */

export type GroupActionResult = { ok: true; message?: string } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMOJIS = ["clap", "drool", "side_eye"] as const;
export type ReactionEmoji = (typeof EMOJIS)[number];

const GENERIC = "Something went wrong. Please try again.";

/** A real calendar date in YYYY-MM-DD: the date, null for "none", undefined if invalid. */
function cleanDate(v: string | null): string | null | undefined {
  if (v === null || v === "") return null;
  if (!DATE_RE.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : v;
}

/** update_group_settings: owner only. Season dates are inclusive London dates; empty clears them. */
export async function updateGroupSettingsAction(
  groupId: string,
  input: { name: string; verifiedOnly: boolean; seasonStart: string | null; seasonEnd: string | null },
): Promise<GroupActionResult> {
  if (!UUID_RE.test(groupId)) return { ok: false, error: GENERIC };
  if (!(await getSessionUser())) return { ok: false, error: "Please sign in again." };

  const name = String(input.name ?? "").trim();
  if (name.length < 1 || name.length > 60) {
    return { ok: false, error: "Give the group a name of 1 to 60 characters." };
  }
  const start = cleanDate(input.seasonStart);
  const end = cleanDate(input.seasonEnd);
  if (start === undefined || end === undefined) return { ok: false, error: "Pick real dates for the season." };
  if (start && end && end < start) return { ok: false, error: "The season has to end on or after its start." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_group_settings", {
    p_group_id: groupId,
    p_name: name,
    p_verified_only: !!input.verifiedOnly,
    p_season_start: start,
    p_season_end: end,
  });
  if (error) return { ok: false, error: friendlyError(error, "We couldn't save the settings. Please try again.") };
  revalidatePath(`/group/${groupId}`);
  revalidatePath("/group");
  return { ok: true, message: "Settings saved" };
}

/** Own reaction insert / delete (RLS: own rows, on visits the caller can read). */
export async function setReactionAction(
  visitId: string,
  emoji: ReactionEmoji,
  on: boolean,
): Promise<GroupActionResult> {
  if (!UUID_RE.test(visitId) || !EMOJIS.includes(emoji)) return { ok: false, error: GENERIC };
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  const supabase = await createClient();
  if (on) {
    const { error } = await supabase
      .from("reactions")
      .insert({ visit_id: visitId, user_id: user.id, emoji });
    // 23505: already reacted (a double tap); the end state is what was asked for.
    if (error && error.code !== "23505") {
      return { ok: false, error: "Couldn't send that reaction. Please try again." };
    }
  } else {
    const { error } = await supabase
      .from("reactions")
      .delete()
      .eq("visit_id", visitId)
      .eq("user_id", user.id)
      .eq("emoji", emoji);
    if (error) return { ok: false, error: "Couldn't take that reaction back. Please try again." };
  }
  return { ok: true };
}

/** downgrade_visit: the group owner marks the visit self-reported (stamps keep their points). */
export async function downgradeVisitAction(groupId: string, visitId: string): Promise<GroupActionResult> {
  if (!UUID_RE.test(groupId) || !UUID_RE.test(visitId)) return { ok: false, error: GENERIC };
  if (!(await getSessionUser())) return { ok: false, error: "Please sign in again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("downgrade_visit", { p_visit_id: visitId });
  if (error) return { ok: false, error: friendlyError(error, "We couldn't downgrade that visit. Please try again.") };
  revalidatePath(`/group/${groupId}`);
  revalidatePath(`/visit/${visitId}`);
  return { ok: true, message: "Marked as self-reported" };
}

/** dismiss_flag: the group owner clears the flag; a newer side-eye brings it back. */
export async function dismissFlagAction(groupId: string, visitId: string): Promise<GroupActionResult> {
  if (!UUID_RE.test(groupId) || !UUID_RE.test(visitId)) return { ok: false, error: GENERIC };
  if (!(await getSessionUser())) return { ok: false, error: "Please sign in again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("dismiss_flag", { p_visit_id: visitId });
  if (error) return { ok: false, error: friendlyError(error, "We couldn't dismiss that flag. Please try again.") };
  revalidatePath(`/group/${groupId}`);
  return { ok: true, message: "Flag dismissed" };
}
