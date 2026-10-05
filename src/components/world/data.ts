import "server-only";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/countries";
import { normNumeric } from "./geometry";
import type { WorldData, WorldGroup } from "./states";

/** Everything the world view needs, fetched with the signed-in user's session (RLS applies). */
export async function loadWorldData(userId: string): Promise<WorldData> {
  const supabase = await createClient();
  const { data: city } = await supabase
    .from("cities")
    .select("id")
    .eq("slug", "london")
    .maybeSingle();
  const cityId = (city as { id: string } | null)?.id;

  const [countryR, statusR, stampR, groupR] = await Promise.all([
    supabase.from("countries").select("iso2, iso_numeric, name, iso_name").limit(300),
    cityId
      ? supabase
          .from("city_country_status")
          .select("country_iso2")
          .eq("city_id", cityId)
          .eq("status", "listed")
          .limit(300)
      : Promise.resolve({ data: [] }),
    supabase.from("stamps").select("country_iso2, backfilled").eq("user_id", userId).limit(300),
    supabase.from("groups").select("id, name").order("created_at"),
  ]);

  const stamps = (stampR.data ?? []) as { country_iso2: string; backfilled: boolean }[];
  const groupRows = (groupR.data ?? []) as { id: string; name: string }[];

  // Group view: one query for everyone's visit stamps across my groups, then split per group.
  let groups: WorldGroup[] = [];
  if (groupRows.length > 0) {
    const { data: memberRows } = await supabase
      .from("group_members")
      .select("group_id, user_id")
      .in(
        "group_id",
        groupRows.map((g) => g.id),
      )
      .limit(2000);
    const members = (memberRows ?? []) as { group_id: string; user_id: string }[];
    const userIds = [...new Set(members.map((m) => m.user_id))];
    const { data: groupStampRows } = userIds.length
      ? await supabase
          .from("stamps")
          .select("user_id, country_iso2")
          .in("user_id", userIds)
          .eq("backfilled", false)
          .limit(10000)
      : { data: [] };
    const stampsByUser = new Map<string, string[]>();
    for (const s of (groupStampRows ?? []) as { user_id: string; country_iso2: string }[]) {
      const list = stampsByUser.get(s.user_id) ?? [];
      list.push(s.country_iso2);
      stampsByUser.set(s.user_id, list);
    }
    groups = groupRows.map((g) => {
      const ids = members.filter((m) => m.group_id === g.id).map((m) => m.user_id);
      const counts: Record<string, number> = {};
      for (const uid of ids) for (const iso2 of stampsByUser.get(uid) ?? []) counts[iso2] = (counts[iso2] ?? 0) + 1;
      return { id: g.id, name: g.name, members: ids.length, counts };
    });
  }

  return {
    countries: (
      (countryR.data ?? []) as { iso2: string; iso_numeric: string | null; name: string | null; iso_name: string | null }[]
    ).map((c) => ({ iso2: c.iso2, iso_numeric: normNumeric(c.iso_numeric), name: displayName(c) })),
    listed: ((statusR.data ?? []) as { country_iso2: string }[]).map((r) => r.country_iso2),
    visitStamped: stamps.filter((s) => !s.backfilled).map((s) => s.country_iso2),
    backfilled: stamps.filter((s) => s.backfilled).map((s) => s.country_iso2),
    groups,
  };
}
