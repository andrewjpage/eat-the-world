import type { SupabaseClient } from "@supabase/supabase-js";
import type { Rsvp } from "./logic";

/**
 * Save the caller's own RSVP. PostgREST's upsert would also SET the key columns, which
 * the table's column grants forbid, so this updates first and inserts when there is no row.
 * Returns true on success.
 */
export async function saveRsvp(
  supabase: SupabaseClient,
  planId: string,
  userId: string,
  response: Rsvp,
): Promise<boolean> {
  const upd = await supabase
    .from("plan_rsvps")
    .update({ response })
    .eq("plan_id", planId)
    .eq("user_id", userId)
    .select("plan_id");
  if (upd.error) return false;
  if (upd.data && upd.data.length > 0) return true;

  const ins = await supabase.from("plan_rsvps").insert({ plan_id: planId, user_id: userId, response });
  if (!ins.error) return true;
  if (ins.error.code === "23505") {
    // Raced with another tab: the row exists now.
    const retry = await supabase
      .from("plan_rsvps")
      .update({ response })
      .eq("plan_id", planId)
      .eq("user_id", userId);
    return !retry.error;
  }
  return false;
}
