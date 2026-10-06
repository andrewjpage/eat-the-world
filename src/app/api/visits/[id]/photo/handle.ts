/**
 * The whole photo upload, with its clients passed in so the route and the integration test
 * run exactly the same code. route.ts supplies the cookie session and the service-role
 * client (which must never reach client code); the test supplies its own two.
 *
 * Order matters: size check from the header, the caller's session, the visit through RLS
 * (only its creator; a retry once the photo is linked is answered "already" without reading
 * the body), and only then the body is read. An orphan left by a failed attempt is overwritten.
 * Nothing here logs the body, and no error echoes it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { PHOTO_MAX_UPLOAD_BYTES } from "@/lib/photos";
import { UUID_RE } from "@/components/checkin/logic";
import { processPhoto, type SharpModule } from "./process";

export const PHOTO_BUCKET = "visit-photos";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const SIGN_IN_AGAIN = "Please sign in again to add a photo.";
const TOO_BIG = "That photo is too big. Try a smaller one.";
const NOT_YOURS = "Only the person who checked in can add the photo.";
const FALLBACK = "We couldn't save that photo. Check your signal and try again.";

export function photoFail(error: string, status: number) {
  return Response.json({ error }, { status, headers: NO_STORE });
}

/** Reads the body, giving up as soon as it passes `max` bytes (a chunked body has no length). */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export interface PhotoDeps {
  /** Acts as the signed-in user (cookie session): RLS and set_visit_photo apply. */
  supabase: SupabaseClient;
  /** Service role: used only to write and remove the stored object. */
  admin: SupabaseClient;
  /** Tests pass sharp: null to run the no-sharp path. */
  sharp?: SharpModule | null;
}

export async function handlePhotoUpload(
  request: Request,
  visitId: string,
  { supabase, admin, sharp }: PhotoDeps,
): Promise<Response> {
  if (!UUID_RE.test(visitId)) return photoFail("That visit doesn't exist.", 404);

  // A cross-site page can't send an image/* body without a CORS preflight: no CSRF.
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("image/")) {
    return photoFail("Send the photo as an image.", 415);
  }
  // Refuse an oversized body before reading any of it.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > PHOTO_MAX_UPLOAD_BYTES) return photoFail(TOO_BIG, 413);

  // The proxy has refreshed the cookie; getClaims checks the JWT.
  const { data: auth } = await supabase.auth.getClaims();
  const uid = auth?.claims?.sub;
  if (!uid) return photoFail(SIGN_IN_AGAIN, 401);

  // RLS only returns visits of the caller's groups; anyone else gets a 404.
  const { data: visit } = await supabase
    .from("visits")
    .select("id, group_id, created_by, photo_path, verification")
    .eq("id", visitId)
    .maybeSingle();
  if (!visit) return photoFail("That visit doesn't exist.", 404);
  if (visit.created_by !== uid) return photoFail(NOT_YOURS, 403);
  if (visit.photo_path) {
    // Idempotent for the creator: a retry after a lost response is a success, not an error.
    // The first photo stays; this body is never read.
    return Response.json(
      { ok: true, already: true, verification: visit.verification },
      { headers: NO_STORE },
    );
  }

  const body = await readCapped(request, PHOTO_MAX_UPLOAD_BYTES).catch(() => undefined);
  if (body === null) return photoFail(TOO_BIG, 413);
  if (!body) return photoFail(FALLBACK, 400);

  const processed = await processPhoto(body, sharp === undefined ? {} : { sharp });
  if (!processed.ok) return photoFail(processed.error, processed.status);

  const path = `${visit.group_id}/${visit.id}.jpg`;
  // upsert: the caller is the creator and photo_path is null (both checked above under RLS),
  // so anything already at this path is an orphan from a failed earlier attempt. Nobody can
  // read an object no visit points at (the storage policy), so overwriting it is safe, and
  // it means one failed cleanup can't block every later upload.
  const { error: uploadError } = await admin.storage
    .from(PHOTO_BUCKET)
    .upload(path, processed.jpeg, { contentType: "image/jpeg", upsert: true });
  if (uploadError) return photoFail(FALLBACK, 500);

  // The database checks the caller and the path, and only then raises the verification.
  const { error: rpcError } = await supabase.rpc("set_visit_photo", {
    p_visit_id: visit.id,
    p_photo_path: path,
  });
  if (rpcError) {
    // Never leave an object behind that no visit points at, but never remove one that a
    // concurrent retry has just linked either.
    const { data: now } = await admin.from("visits").select("photo_path").eq("id", visit.id).maybeSingle();
    if (!now?.photo_path) await admin.storage.from(PHOTO_BUCKET).remove([path]).catch(() => {});
    const message = rpcError.message ?? "";
    if (message === NOT_YOURS) return photoFail(NOT_YOURS, 403);
    return photoFail(FALLBACK, 500);
  }

  const { data: after } = await supabase.from("visits").select("verification").eq("id", visit.id).maybeSingle();
  return Response.json(
    { ok: true, verification: after?.verification ?? "photo" },
    { headers: NO_STORE },
  );
}
