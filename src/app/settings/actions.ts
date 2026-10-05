"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, getSessionUser } from "@/components/auth/session";
import type { ActionState } from "@/app/group/actions";

export async function updateDisplayNameAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Please sign in first." };

  const name = String(formData.get("display_name") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 1 || name.length > 60) {
    return { error: "Your name needs 1 to 60 characters." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: name })
    .eq("user_id", user.id);
  if (error) return { error: friendlyError(error, "We couldn't save your name. Please try again.") };

  // The TopBar avatar lives in the root layout.
  revalidatePath("/", "layout");
  return { ok: true, message: "Name saved." };
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
