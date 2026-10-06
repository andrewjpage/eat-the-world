import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  summarisePassport,
  type PassportAttendanceRow,
  type PassportCountryRow,
  type PassportStampRow,
  type PassportStatusRow,
  type PassportSummary,
} from "@/lib/passport";

export type { PassportCountry, PendingItem } from "@/lib/passport";

/** Server-only: loads the Passport home data with the signed-in user's session. */

export interface PassportData extends PassportSummary {
  hasGroup: boolean;
}

/** All data for the Passport home, fetched in parallel (RLS applies). */
export async function loadPassport(userId: string): Promise<PassportData> {
  const supabase = await createClient();
  const { data: city } = await supabase
    .from("cities")
    .select("id")
    .eq("slug", "london")
    .maybeSingle();
  const cityId = (city as { id: string } | null)?.id;

  const [countriesR, statusR, stampsR, awardsR, attendR, groupsR] = await Promise.all([
    supabase.from("countries").select("iso2, name, iso_name, m49_group").limit(300),
    cityId
      ? supabase
          .from("city_country_status")
          .select("country_iso2, status")
          .eq("city_id", cityId)
          .limit(300)
      : Promise.resolve({ data: [] }),
    supabase
      .from("stamp_totals")
      .select("country_iso2, points, backfilled, verification, earned_at, stamped_at")
      .eq("user_id", userId)
      .limit(300),
    supabase.from("set_awards").select("points").eq("user_id", userId),
    supabase
      .from("visit_attendees")
      .select("visit_id, status, stamp_waiting, visits(visited_at, restaurants(name, country_iso2))")
      .eq("user_id", userId)
      .or("status.eq.pending,stamp_waiting.eq.true"),
    supabase
      .from("group_members")
      .select("group_id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  const summary = summarisePassport({
    countries: (countriesR.data ?? []) as PassportCountryRow[],
    statusRows: (statusR.data ?? []) as PassportStatusRow[],
    stamps: (stampsR.data ?? []) as PassportStampRow[],
    awards: (awardsR.data ?? []) as { points: number }[],
    attendances: (attendR.data ?? []) as unknown as PassportAttendanceRow[],
    now: new Date(),
  });

  return { ...summary, hasGroup: (groupsR.count ?? 0) > 0 };
}
