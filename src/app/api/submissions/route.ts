import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/components/auth/session";
import { parseSuggestion } from "@/components/curator/logic";
import {
  GeocodeUnavailableError,
  POSTCODE_NOT_FOUND,
  POSTCODE_SERVICE_DOWN,
  geocodePostcode,
} from "@/lib/postcodes";

/**
 * POST /api/submissions: a group member suggests a restaurant (brief 6.4, decision 4).
 *
 * Body: { countryIso2, name, address?, postcode, googlePlaceId?, website?, note? }.
 * The postcode is checked here with postcodes.io (live, then terminated) and stored in its
 * canonical form; the curator geocodes it again on approval, so no coordinates are stored here
 * (the client can't insert lat/lon at all). The row is inserted as the caller, so RLS enforces
 * submitted_by = caller, status = pending and group membership, and a trigger the pending cap.
 * Nothing about the caller's position is read.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_PENDING_PER_USER = 10;

function fail(error: string, status: number) {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  // A cross-site form can't send JSON without a CORS preflight, so this also blocks CSRF.
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return fail("Send the suggestion as JSON.", 415);
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return fail("That suggestion was too big.", 413);
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return fail("Please sign in again to suggest a restaurant.", 401);

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return fail("That didn't look right. Please try again.", 400);
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return fail("That suggestion was too big.", 413);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail("That didn't look right. Please try again.", 400);
  }
  const parsed = parseSuggestion(json);
  if (!parsed.ok) return fail(parsed.error, 400);
  const s = parsed.value;

  // Cheap checks first, so a bad request never costs a geocoder call.
  const [{ data: country }, { data: city }, { count: groups }, { count: pending }] = await Promise.all([
    supabase.from("countries").select("iso2").eq("iso2", s.countryIso2).maybeSingle(),
    supabase.from("cities").select("id").eq("slug", "london").maybeSingle(),
    supabase.from("group_members").select("group_id", { count: "exact", head: true }).eq("user_id", userId),
    supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("submitted_by", userId)
      .eq("status", "pending"),
  ]);
  if (!country) return fail("We don't know that country. Pick one from the list.", 400);
  if (!city) return fail("Something is off on our side. Please try again later.", 500);
  if ((groups ?? 0) === 0) return fail("Join a group first, then you can suggest restaurants.", 403);
  if ((pending ?? 0) >= MAX_PENDING_PER_USER) {
    return fail("You have lots of suggestions waiting. Give the curator a chance to catch up.", 429);
  }

  let geo;
  try {
    geo = await geocodePostcode(s.postcode);
  } catch (e) {
    if (e instanceof GeocodeUnavailableError) return fail(POSTCODE_SERVICE_DOWN, 503);
    throw e;
  }
  if (!geo) return fail(POSTCODE_NOT_FOUND, 422);

  // Already on the list? (exact name and postcode, ignoring case)
  const { data: dupe } = await supabase
    .from("restaurants")
    .select("id")
    .eq("postcode", geo.postcode)
    .ilike("name", s.name.replace(/[\\%_]/g, "\\$&"))
    .limit(1);
  if (dupe && dupe.length > 0) return fail("That restaurant is already on the list. Search for it on its country page.", 409);

  const { data, error } = await supabase
    .from("submissions")
    .insert({
      city_id: city.id,
      country_iso2: s.countryIso2,
      name: s.name,
      address: s.address,
      postcode: geo.postcode,
      google_place_id: s.googlePlaceId,
      website: s.website,
      note: s.note,
      submitted_by: userId,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) {
    return fail(friendlyError(error, "We couldn't save that suggestion. Please try again."), 500);
  }

  revalidatePath("/curator");
  return Response.json({ ok: true, id: data.id, postcode: geo.postcode }, { headers: NO_STORE });
}
