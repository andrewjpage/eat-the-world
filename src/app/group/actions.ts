"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, getSessionUser } from "@/components/auth/session";
import { UUID_RE } from "@/components/restaurant/format";

export interface ActionState {
  ok?: boolean;
  error?: string | null;
  message?: string | null;
}

/** create_group(name), then open the new group. */
export async function createGroupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Please sign in first." };

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 1 || name.length > 60) {
    return { error: "Give the group a name of 1 to 60 characters." };
  }

  const supabase = await createClient();
  const { data: groupId, error } = await supabase.rpc("create_group", { p_name: name });
  if (error || !groupId) {
    return { error: friendlyError(error, "We couldn't create that group. Please try again.") };
  }
  revalidatePath("/group");
  redirect(`/group/${groupId}`);
}

/** Owner only: invalidates the old invite link. */
export async function rotateInviteCodeAction(groupId: string): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Please sign in first." };
  if (typeof groupId !== "string" || !UUID_RE.test(groupId)) {
    return { error: "We couldn't change the link. Please try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("rotate_invite_code", { p_group_id: groupId });
  if (error) {
    return { error: friendlyError(error, "We couldn't change the link. Please try again.") };
  }
  revalidatePath(`/group/${groupId}`);
  return { ok: true, message: "New invite link ready. The old one no longer works." };
}
