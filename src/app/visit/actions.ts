"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/components/auth/session";
import {
  UUID_RE,
  friendlyDbMessage,
  parseAttendanceInput,
  parseStampResult,
  type StampResult,
} from "@/components/checkin/logic";

export type VisitActionResult = { ok: true; result: StampResult } | { ok: false; error: string };
export type DeclineResult = { ok: true } | { ok: false; error: string };

const GENERIC = "Something went wrong. Please try again.";

async function signedIn() {
  return (await getSessionUser()) !== null;
}

/** confirm_attendance for the caller's pending row on this visit. */
export async function confirmAttendanceAction(
  visitId: string,
  input: unknown,
): Promise<VisitActionResult> {
  if (!UUID_RE.test(visitId)) return { ok: false, error: GENERIC };
  if (!(await signedIn())) return { ok: false, error: "Please sign in again." };
  const parsed = parseAttendanceInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const a = parsed.value;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_attendance", {
    p_visit_id: visitId,
    p_signature_dish_id: a.signatureDishId,
    p_dish_other: a.dishOther,
    p_rating: a.rating,
    p_note: a.note,
  });
  if (error) return { ok: false, error: friendlyDbMessage(error.message, GENERIC) };
  const result = parseStampResult(data);
  if (!result) return { ok: false, error: GENERIC };
  revalidatePath("/");
  revalidatePath(`/visit/${visitId}`);
  return { ok: true, result };
}

/** decline_attendance ("Not me"). */
export async function declineAttendanceAction(visitId: string): Promise<DeclineResult> {
  if (!UUID_RE.test(visitId)) return { ok: false, error: GENERIC };
  if (!(await signedIn())) return { ok: false, error: "Please sign in again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_attendance", { p_visit_id: visitId });
  if (error) return { ok: false, error: friendlyDbMessage(error.message, GENERIC) };
  revalidatePath("/");
  revalidatePath(`/visit/${visitId}`);
  return { ok: true };
}

/** claim_stamp for a confirmed attendance whose stamp is waiting. */
export async function claimStampAction(visitId: string): Promise<VisitActionResult> {
  if (!UUID_RE.test(visitId)) return { ok: false, error: GENERIC };
  if (!(await signedIn())) return { ok: false, error: "Please sign in again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_stamp", { p_visit_id: visitId });
  if (error) return { ok: false, error: friendlyDbMessage(error.message, GENERIC) };
  const result = parseStampResult(data);
  if (!result) return { ok: false, error: GENERIC };
  revalidatePath("/");
  revalidatePath(`/visit/${visitId}`);
  return { ok: true, result };
}
