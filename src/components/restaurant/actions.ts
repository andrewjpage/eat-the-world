"use server";

import { createClient } from "@/lib/supabase/server";
import { friendlyError, getSessionUser } from "@/components/auth/session";
import { UUID_RE } from "@/components/restaurant/format";

export interface ReportState {
  ok?: boolean;
  error?: string | null;
}

/** Inserts a closure report as the signed-in user (RLS checks membership). Status changes are curator-only. */
export async function reportClosedAction(restaurantId: string, note: string): Promise<ReportState> {
  const user = await getSessionUser();
  if (!user) return { error: "Please sign in first." };
  if (typeof restaurantId !== "string" || !UUID_RE.test(restaurantId) || typeof note !== "string") {
    return { error: "We couldn't send that report. Please try again." };
  }
  const trimmed = note.trim();
  if (trimmed.length > 1000) return { error: "Keep the note under 1000 characters." };

  const supabase = await createClient();
  const { error } = await supabase.from("closure_reports").insert({
    restaurant_id: restaurantId,
    reported_by: user.id,
    note: trimmed || null,
  });
  if (error) {
    return {
      error: friendlyError(
        error,
        "We couldn't send that report. Only people in a group can report, so join one first.",
      ),
    };
  }
  return { ok: true };
}
