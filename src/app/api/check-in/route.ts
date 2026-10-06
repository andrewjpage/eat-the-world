import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  CHECK_IN_FALLBACK,
  MAX_BODY_BYTES,
  SIGNED_OUT_DB_MESSAGE,
  friendlyDbMessage,
  parseCheckInBody,
  parseStampResult,
} from "@/components/checkin/logic";

/**
 * POST /api/check-in: the one place a browser position is sent.
 *
 * The body ({ restaurantId, groupId, tagged, location: { lat, lon, accuracy } | null,
 * clientKey, ... }) goes straight to rpc('check_in') as the signed-in user. The database
 * computes the distance with PostGIS and keeps only the verification, plus distance_m
 * (rounded to 10 m) when the check-in is geo_verified; members can't read distance_m. A retry with the same clientKey returns the first result and creates
 * nothing. Nothing here logs the body, puts it in a URL or echoes it in an error.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;
const SIGN_IN_AGAIN = "Please sign in again to check in.";
const TOO_BIG = "That check-in was too big.";
const BAD_BODY = "That didn't look right. Please try again.";

function fail(error: string, status: number) {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  // A cross-site form can't send JSON without a CORS preflight, so this also blocks CSRF.
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return fail("Send the check-in as JSON.", 415);
  }
  // Refuse an oversized body before reading it.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return fail(TOO_BIG, 413);
  }

  // The proxy has already refreshed the session cookie. getClaims checks the JWT (locally
  // when the project signs with asymmetric keys); check_in checks auth again in SQL.
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return fail(SIGN_IN_AGAIN, 401);

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return fail(BAD_BODY, 400);
  }
  // A chunked body has no Content-Length: check its real size in bytes.
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return fail(TOO_BIG, 413);

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail(BAD_BODY, 400);
  }
  const parsed = parseCheckInBody(json);
  if (!parsed.ok) return fail(parsed.error, 400);
  const b = parsed.value;

  const { data, error } = await supabase.rpc("check_in", {
    p_restaurant_id: b.restaurantId,
    p_group_id: b.groupId,
    p_lat: b.location?.lat ?? null,
    p_lon: b.location?.lon ?? null,
    p_accuracy: b.location?.accuracy ?? null,
    p_tagged: b.tagged,
    p_signature_dish_id: b.signatureDishId,
    p_dish_other: b.dishOther,
    p_rating: b.rating,
    p_note: b.note,
    p_client_key: b.clientKey,
  });

  if (error) {
    // Only our own friendly sentences pass through; anything else is generic.
    const message = friendlyDbMessage(error.message, CHECK_IN_FALLBACK);
    if (message === SIGNED_OUT_DB_MESSAGE) return fail(SIGN_IN_AGAIN, 401);
    return fail(message, message === CHECK_IN_FALLBACK ? 500 : 422);
  }
  const result = parseStampResult(data);
  if (!result) return fail(CHECK_IN_FALLBACK, 500);

  revalidatePath("/");
  return Response.json(result, { headers: NO_STORE });
}
