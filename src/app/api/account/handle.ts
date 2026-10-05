/**
 * Account deletion (brief section 8), with its clients passed in so the route and the
 * integration test run the same code. The database function does the deleting and hands back
 * the photo paths; the objects are then removed from Storage with the service-role client
 * (which must never reach client code). Nothing here logs coordinates, names or paths.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const PHOTO_BUCKET = "visit-photos";
export const GOODBYE_PATH = "/privacy/goodbye";
const NO_STORE = { "Cache-Control": "no-store" } as const;

export interface AccountDeps {
  /** Acts as the signed-in user (cookie session). */
  supabase: SupabaseClient;
  /** Service role: used only to remove stored photo objects. */
  admin: SupabaseClient;
}

function fail(error: string, status: number) {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export async function handleAccountDelete(
  { supabase, admin }: AccountDeps,
  report: (message: string) => void = console.error,
): Promise<Response> {
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return fail("Please sign in again to delete your account.", 401);

  const { data: paths, error } = await supabase.rpc("delete_my_account");
  if (error) return fail("We couldn't delete your account. Please try again, or ask Andrew.", 500);

  // The account is already gone; a failed clean-up must not strand the person on a dead session.
  const photos = (Array.isArray(paths) ? paths : []).filter(
    (p): p is string => typeof p === "string",
  );
  if (photos.length > 0) {
    const { error: removeError } = await admin.storage.from(PHOTO_BUCKET).remove(photos);
    if (removeError) {
      report(`account deletion: ${photos.length} photo object(s) were not removed from Storage`);
    }
  }

  // The user row no longer exists, so only clear the cookies here (no server round trip).
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});

  return Response.json({ ok: true, redirect: GOODBYE_PATH }, { headers: NO_STORE });
}
