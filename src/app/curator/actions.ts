"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, getSessionUser } from "@/components/auth/session";
import {
  CONFIDENCES,
  RESTAURANT_STATUSES,
  cleanIsoList,
  cleanPlaceId,
  cleanText,
  cleanWebsite,
  slugify,
  type Confidence,
  type RestaurantStatus,
} from "@/components/curator/logic";
import { UUID_RE } from "@/components/restaurant/format";
import {
  GeocodeUnavailableError,
  POSTCODE_NOT_FOUND,
  POSTCODE_SERVICE_DOWN,
  geocodePostcode,
  normalisePostcode,
} from "@/lib/postcodes";

/**
 * Curator writes (brief 6.8). Every action re-checks is_curator() on the server, then writes as
 * the caller: curator RLS policies and the existing SQL functions are the real gate, this is the
 * friendly one. Never import the admin client here.
 */

export interface CuratorResult {
  ok?: boolean;
  error?: string | null;
  message?: string;
}

const NOT_CURATOR = "Only a curator can do that.";
const GENERIC = "We couldn't save that. Please try again.";

async function curator() {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_curator");
  return data === true ? { supabase, userId: user.id } : null;
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function dbError(error: { message?: string; code?: string }, fallback = GENERIC): string {
  if (error.code === "23505") return "That already exists. Change the name or postcode and try again.";
  return friendlyError(error, fallback);
}

function refresh(...extra: string[]) {
  revalidatePath("/curator");
  for (const p of extra) revalidatePath(p);
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export async function approveSubmissionAction(submissionId: string): Promise<CuratorResult> {
  const c = await curator();
  if (!c) return { error: NOT_CURATOR };
  if (!isUuid(submissionId)) return { error: GENERIC };

  const { data: sub } = await c.supabase
    .from("submissions")
    .select("id, status, postcode, name, country_iso2")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub) return { error: "We couldn't find that submission." };
  if (sub.status !== "pending") return { error: "That submission has already been reviewed." };

  // Coordinates come only from postcodes.io (brief section 8), never from the submission row.
  let lat: number;
  let lon: number;
  try {
    const geo = await geocodePostcode(sub.postcode);
    if (!geo) return { error: POSTCODE_NOT_FOUND };
    lat = geo.lat;
    lon = geo.lon;
  } catch (e) {
    if (e instanceof GeocodeUnavailableError) return { error: POSTCODE_SERVICE_DOWN };
    throw e;
  }

  const { error } = await c.supabase.rpc("approve_submission", {
    p_submission_id: submissionId,
    p_lat: lat,
    p_lon: lon,
  });
  if (error) return { error: dbError(error) };
  refresh("/", `/country/${sub.country_iso2}`);
  return { ok: true, message: `${sub.name} is on the list.` };
}

export async function rejectSubmissionAction(submissionId: string, note: string): Promise<CuratorResult> {
  const c = await curator();
  if (!c) return { error: NOT_CURATOR };
  if (!isUuid(submissionId)) return { error: GENERIC };
  const cleaned = typeof note === "string" ? note.trim() : "";
  if (cleaned.length > 1000) return { error: "Keep the note under 1000 characters." };

  const { error } = await c.supabase.rpc("reject_submission", {
    p_submission_id: submissionId,
    p_note: cleaned,
  });
  if (error) return { error: dbError(error) };
  refresh();
  return { ok: true, message: "Rejected." };
}

// ---------------------------------------------------------------------------
// Closure reports
// ---------------------------------------------------------------------------

export async function setRestaurantStatusAction(
  restaurantId: string,
  status: RestaurantStatus,
): Promise<CuratorResult> {
  const c = await curator();
  if (!c) return { error: NOT_CURATOR };
  if (!isUuid(restaurantId) || !(RESTAURANT_STATUSES as readonly string[]).includes(status)) {
    return { error: GENERIC };
  }
  const { data, error } = await c.supabase
    .from("restaurants")
    .update({ status })
    .eq("id", restaurantId)
    .select("country_iso2")
    .maybeSingle();
  if (error) return { error: dbError(error) };
  if (!data) return { error: "We couldn't find that restaurant." };
  refresh("/", `/country/${data.country_iso2}`, `/restaurant/${restaurantId}`);
  return { ok: true, message: `Marked ${status.replace("_", " ")}.` };
}

export async function resolveClosureReportAction(reportId: string): Promise<CuratorResult> {
  const c = await curator();
  if (!c) return { error: NOT_CURATOR };
  if (!isUuid(reportId)) return { error: GENERIC };
  const { error } = await c.supabase.from("closure_reports").update({ resolved: true }).eq("id", reportId);
  if (error) return { error: dbError(error) };
  refresh();
  return { ok: true, message: "Report resolved." };
}

// ---------------------------------------------------------------------------
// Restaurants
// ---------------------------------------------------------------------------

export interface RestaurantEdit {
  name: string;
  address: string;
  postcode: string;
  country_iso2: string;
  status: RestaurantStatus;
  confidence: Confidence;
  curator_note: string;
  google_place_id: string;
  website: string;
}

export async function saveRestaurantAction(id: string, f: RestaurantEdit): Promise<CuratorResult> {
  const c = await curator();
  if (!c) return { error: NOT_CURATOR };
  if (!isUuid(id) || !f || typeof f !== "object") return { error: GENERIC };

  const name = cleanText(f.name, 200);
  if (!name) return { error: "Add a name (up to 200 characters)." };
  const postcode = normalisePostcode(f.postcode);
  if (!postcode) return { error: "That doesn't look like a UK postcode." };
  const iso2 = typeof f.country_iso2 === "string" ? f.country_iso2.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(iso2)) return { error: "Pick a country." };
  if (!(RESTAURANT_STATUSES as readonly string[]).includes(f.status)) return { error: "Pick a status." };
  if (!(CONFIDENCES as readonly string[]).includes(f.confidence)) return { error: "Pick a confidence." };

  const addressText = typeof f.address === "string" ? f.address.trim() : "";
  const address = addressText ? cleanText(addressText, 300) : null;
  if (addressText && !address) return { error: "Shorten the address (up to 300 characters)." };
  const noteText = typeof f.curator_note === "string" ? f.curator_note.trim() : "";
  const curator_note = noteText ? cleanText(noteText, 1000) : null;
  if (noteText && !curator_note) return { error: "Shorten the curator note (up to 1000 characters)." };
  const websiteText = typeof f.website === "string" ? f.website.trim() : "";
  const website = websiteText ? cleanWebsite(websiteText) : null;
  if (websiteText && !website) return { error: "That website doesn't look like a web address." };
  const placeText = typeof f.google_place_id === "string" ? f.google_place_id.trim() : "";
  const google_place_id = placeText ? cleanPlaceId(placeText) : null;
  if (placeText && !google_place_id) return { error: "That Google place ID doesn't look right." };

  const { data: current } = await c.supabase
    .from("restaurants")
    .select("postcode, country_iso2")
    .eq("id", id)
    .maybeSingle();
  if (!current) return { error: "We couldn't find that restaurant." };

  const patch: Record<string, unknown> = {
    name,
    address,
    postcode,
    country_iso2: iso2,
    status: f.status,
    confidence: f.confidence,
    curator_note,
    google_place_id,
    website,
  };

  // Re-geocode only when the postcode really changed.
  if (normalisePostcode(current.postcode) !== postcode) {
    try {
      const geo = await geocodePostcode(postcode);
      if (!geo) return { error: POSTCODE_NOT_FOUND };
      patch.postcode = geo.postcode;
      patch.lat = geo.lat;
      patch.lon = geo.lon;
    } catch (e) {
      if (e instanceof GeocodeUnavailableError) return { error: POSTCODE_SERVICE_DOWN };
      throw e;
    }
  }

  const { error } = await c.supabase.from("restaurants").update(patch).eq("id", id);
  if (error) {
    return {
      error: dbError(error, "We couldn't save that. Check the country and that the name and postcode are unique."),
    };
  }
  const touched = new Set([current.country_iso2, iso2]);
  refresh("/", `/restaurant/${id}`, ...[...touched].map((i) => `/country/${i}`));
  return { ok: true, message: "Saved." };
}

export async function markVerifiedAction(id: string): Promise<CuratorResult> {
  const c = await curator();
  if (!c) return { error: NOT_CURATOR };
  if (!isUuid(id)) return { error: GENERIC };
  const { error } = await c.supabase
    .from("restaurants")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: dbError(error) };
  refresh(`/restaurant/${id}`);
  return { ok: true, message: "Marked verified today." };
}

// ---------------------------------------------------------------------------
// City-country status
// ---------------------------------------------------------------------------

export async function setCityCountryStatusAction(
  iso2: string,
  status: "unlisted" | "uncharted",
): Promise<CuratorResult> {
  const c = await curator();
  if (!c) return { error: NOT_CURATOR };
  const code = typeof iso2 === "string" ? iso2.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(code) || (status !== "unlisted" && status !== "uncharted")) return { error: GENERIC };

  const { data: city } = await c.supabase.from("cities").select("id").eq("slug", "london").maybeSingle();
  if (!city) return { error: GENERIC };

  if (status === "uncharted") {
    const { data: now } = await c.supabase
      .from("city_country_status")
      .select("restaurant_count")
      .eq("city_id", city.id)
      .eq("country_iso2", code)
      .maybeSingle();
    if ((now?.restaurant_count ?? 0) > 0) {
      return { error: "This country has an eligible restaurant, so it is listed. It can't be marked uncharted." };
    }
  }

  const { error } = await c.supabase
    .from("city_countries")
    .upsert({ city_id: city.id, country_iso2: code, status }, { onConflict: "city_id,country_iso2" });
  if (error) return { error: dbError(error) };
  refresh("/", `/country/${code}`);
  return { ok: true, message: status === "uncharted" ? "Marked uncharted." : "Back to unlisted." };
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

export async function saveSetAction(input: {
  id?: string | null;
  name: string;
  countries: string[];
}): Promise<CuratorResult> {
  const c = await curator();
  if (!c) return { error: NOT_CURATOR };
  const name = cleanText(input?.name, 80);
  if (!name) return { error: "Give the set a name (up to 80 characters)." };
  const countries = cleanIsoList(input?.countries);
  if (countries.length < 1) return { error: "Pick at least one country." };

  if (input.id) {
    if (!isUuid(input.id)) return { error: GENERIC };
    const { error } = await c.supabase
      .from("sets")
      .update({ name, country_iso2s: countries })
      .eq("id", input.id);
    if (error) return { error: dbError(error) };
  } else {
    const slug = slugify(name);
    if (!slug) return { error: "Use letters or numbers in the name." };
    const { error } = await c.supabase.from("sets").insert({ slug, name, country_iso2s: countries });
    if (error) {
      return {
        error: error.code === "23505" ? "A set with that name already exists." : dbError(error),
      };
    }
  }
  refresh("/");
  return { ok: true, message: input.id ? "Set saved." : "Set added." };
}

// ---------------------------------------------------------------------------
// Signature dishes
// ---------------------------------------------------------------------------

export async function saveDishAction(input: {
  id?: string | null;
  country: string;
  name: string;
  note: string;
  status: "draft" | "approved";
}): Promise<CuratorResult> {
  const c = await curator();
  if (!c) return { error: NOT_CURATOR };
  const country = typeof input?.country === "string" ? input.country.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(country)) return { error: "Pick a country." };
  const name = cleanText(input.name, 120);
  if (!name) return { error: "Add a dish name (up to 120 characters)." };
  const noteText = typeof input.note === "string" ? input.note.trim() : "";
  const note = noteText ? cleanText(noteText, 300) : null;
  if (noteText && !note) return { error: "Shorten the note (up to 300 characters)." };
  if (input.status !== "draft" && input.status !== "approved") return { error: GENERIC };

  if (input.id) {
    if (!isUuid(input.id)) return { error: GENERIC };
    const { error } = await c.supabase
      .from("signature_dishes")
      .update({ name, note, status: input.status })
      .eq("id", input.id);
    if (error) return { error: error.code === "23505" ? "That country already has a dish with that name." : dbError(error) };
  } else {
    const { error } = await c.supabase
      .from("signature_dishes")
      .insert({ country_iso2: country, name, note, status: input.status });
    if (error) return { error: error.code === "23505" ? "That country already has a dish with that name." : dbError(error) };
  }
  refresh(`/country/${country}`);
  return { ok: true, message: input.id ? "Dish saved." : "Dish added." };
}

export async function setDishStatusAction(id: string, status: "draft" | "approved"): Promise<CuratorResult> {
  const c = await curator();
  if (!c) return { error: NOT_CURATOR };
  if (!isUuid(id) || (status !== "draft" && status !== "approved")) return { error: GENERIC };
  const { data, error } = await c.supabase
    .from("signature_dishes")
    .update({ status })
    .eq("id", id)
    .select("country_iso2")
    .maybeSingle();
  if (error) return { error: dbError(error) };
  if (!data) return { error: "We couldn't find that dish." };
  refresh(`/country/${data.country_iso2}`);
  return { ok: true, message: status === "approved" ? "Approved." : "Demoted to draft." };
}
