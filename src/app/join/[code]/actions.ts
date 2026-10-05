"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, getSessionUser } from "@/components/auth/session";
import { INVITE_CODE_RE, normaliseInviteCode } from "./code";

export interface JoinState {
  error?: string | null;
}

function joinedWithin(joinedAt: string, ms: number): boolean {
  return Date.now() - new Date(joinedAt).getTime() < ms;
}

/**
 * The "Join the table" button. Joining happens only here (a POST, which Next checks is
 * same-origin), never on a GET of /join/<code>, so a link from another site can't add anyone to
 * a group. First-timers then go to backfill onboarding, everyone else to the group.
 */
export async function joinGroupAction(rawCode: string, _prev: JoinState, _form: FormData): Promise<JoinState> {
  void _prev;
  void _form;
  const user = await getSessionUser();
  if (!user) return { error: "Please sign in again, then tap Join." };
  const code = normaliseInviteCode(rawCode);
  if (!INVITE_CODE_RE.test(code)) return { error: "That invite looks smudged. Ask for a fresh link." };

  const supabase = await createClient();
  const [{ data: memberships }, stamps] = await Promise.all([
    supabase.from("group_members").select("group_id, joined_at").eq("user_id", user.id),
    supabase.from("stamps").select("country_iso2", { count: "exact", head: true }).eq("user_id", user.id),
  ]);

  const { data: groupId, error } = await supabase.rpc("join_group", { p_invite_code: code });
  if (error || !groupId) {
    return { error: friendlyError(error, "We couldn't join that group. Please try again.") };
  }

  // First time: no stamps and no other group, and not a long-standing member of this one.
  // The 10-minute grace keeps it stable if the button is pressed twice.
  const previous = (memberships ?? []).find((m) => m.group_id === groupId);
  const recentlyJoined = !previous || joinedWithin(previous.joined_at as string, 10 * 60_000);
  const firstTime =
    (stamps.count ?? 0) === 0 && (memberships ?? []).every((m) => m.group_id === groupId) && recentlyJoined;

  revalidatePath("/group");
  redirect(firstTime ? "/settings/backfill?onboarding=1" : `/group/${groupId}`);
}
