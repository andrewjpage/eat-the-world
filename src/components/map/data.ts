import "server-only";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/countries";
import { buildPins, type MapRestaurant, type Pin } from "./pins";

/** Everything the London map needs, fetched with the signed-in user's session (RLS applies). */
export async function loadMapData(userId: string): Promise<Pin[]> {
  const supabase = await createClient();
  const { data: city } = await supabase
    .from("cities")
    .select("id")
    .eq("slug", "london")
    .maybeSingle();
  const cityId = (city as { id: string } | null)?.id;
  if (!cityId) return [];

  const [restR, stampR, friendR, countryR] = await Promise.all([
    supabase
      .from("restaurants")
      .select("id, name, country_iso2, address, postcode, lat, lon, status, confidence, curator_note")
      .eq("city_id", cityId)
      .in("status", ["active", "reported_closed"])
      .limit(5000),
    // Visit stamps only: a backfilled country is still "new" on the map.
    supabase.from("stamps").select("country_iso2").eq("user_id", userId).eq("backfilled", false),
    // Confirmed attendees other than me, on visits I can read (visits of my groups).
    supabase
      .from("visit_attendees")
      .select("visits!inner(restaurant_id)")
      .eq("status", "confirmed")
      .neq("user_id", userId)
      .limit(5000),
    supabase.from("countries").select("iso2, name, iso_name").limit(300),
  ]);

  const visitStamped = new Set(((stampR.data ?? []) as { country_iso2: string }[]).map((s) => s.country_iso2));
  const friendRestaurants = new Set(
    ((friendR.data ?? []) as unknown as { visits: { restaurant_id: string } | null }[])
      .map((a) => a.visits?.restaurant_id)
      .filter((id): id is string => Boolean(id)),
  );
  const names = new Map(
    ((countryR.data ?? []) as { iso2: string; name: string | null; iso_name: string | null }[]).map((c) => [
      c.iso2,
      displayName(c),
    ]),
  );

  return buildPins((restR.data ?? []) as MapRestaurant[], visitStamped, friendRestaurants, names);
}
