import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/countries";
import { londonDate } from "@/lib/time";
import { requireUser } from "@/components/auth/session";
import { CheckInFlow, type FlowGroup } from "@/components/checkin/CheckInFlow";
import { UUID_RE, type StampPrediction } from "@/components/checkin/logic";
import { ButtonLink, EmptyState, Page } from "@/components/ui";

export const metadata: Metadata = { title: "Check in" };

interface MemberRow {
  group_id: string;
  user_id: string;
  profiles: { display_name: string; avatar_url: string | null } | null;
}

interface PlanRow {
  group_id: string;
  proposed_for: string;
  plan_rsvps: { user_id: string; response: string }[];
}

interface MyStampRow {
  country_iso2: string;
  backfilled: boolean;
  stamped_at: string | null;
}

/** Statuses counted for rarity (brief section 3); any other status adds the visited one. */
const RARITY_STATUSES = ["active", "reported_closed"];

export default async function CheckInPage({ params }: PageProps<"/check-in/[restaurantId]">) {
  const { restaurantId } = await params;
  const user = await requireUser(`/check-in/${restaurantId}`);
  if (!UUID_RE.test(restaurantId)) notFound();

  const supabase = await createClient();
  const [{ data: r }, { data: mine }] = await Promise.all([
    supabase
      .from("restaurants")
      .select("id, name, status, lat, lon, city_id, country_iso2, countries(iso2, name, iso_name)")
      .eq("id", restaurantId)
      .maybeSingle(),
    supabase.from("group_members").select("group_id, groups(id, name)").eq("user_id", user.id),
  ]);
  if (!r || r.status === "pending") notFound();

  const country = r.countries as unknown as { iso2: string; name: string; iso_name: string } | null;
  const countryName = country ? displayName(country) : r.country_iso2;

  const myGroups = ((mine ?? []) as unknown as { group_id: string; groups: { id: string; name: string } | null }[])
    .map((m) => m.groups)
    .filter((g): g is { id: string; name: string } => g !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (myGroups.length === 0) {
    return (
      <Page className="pt-[max(1rem,env(safe-area-inset-top))]">
        <EmptyState
          emoji="👯"
          title="Join a group first"
          action={<ButtonLink href="/group">Go to groups</ButtonLink>}
        >
          Check-ins are made with a group, so friends can confirm they were at the table.
        </EmptyState>
      </Page>
    );
  }

  const groupIds = myGroups.map((g) => g.id);
  const today = londonDate(new Date());
  const now = new Date().getTime();
  const [{ data: dishes }, { data: members }, { data: plans }, { data: myStamps }, { data: status }] =
    await Promise.all([
      supabase
        .from("signature_dishes")
        .select("id, name")
        .eq("country_iso2", r.country_iso2)
        .eq("status", "approved")
        .order("name"),
      supabase
        .from("group_members")
        .select("group_id, user_id, profiles(display_name, avatar_url)")
        .in("group_id", groupIds)
        .neq("user_id", user.id),
      supabase
        .from("plans")
        .select("group_id, proposed_for, plan_rsvps(user_id, response)")
        .eq("restaurant_id", restaurantId)
        .in("group_id", groupIds)
        .neq("status", "cancelled")
        .gte("proposed_for", new Date(now - 36 * 3600_000).toISOString())
        .lte("proposed_for", new Date(now + 36 * 3600_000).toISOString()),
      supabase
        .from("stamps")
        .select("country_iso2, backfilled, stamped_at")
        .eq("user_id", user.id)
        .limit(300),
      supabase
        .from("city_country_status")
        .select("restaurant_count")
        .eq("city_id", r.city_id)
        .eq("country_iso2", r.country_iso2)
        .maybeSingle(),
    ]);

  const memberRows = (members ?? []) as unknown as MemberRow[];
  const memberIds = [...new Set(memberRows.map((m) => m.user_id))];
  // Who in my groups already has this country (for "First in the group!" on the predicted stamp).
  const { data: theirs } = memberIds.length
    ? await supabase
        .from("stamps")
        .select("user_id")
        .eq("country_iso2", r.country_iso2)
        .eq("backfilled", false)
        .in("user_id", memberIds)
    : { data: [] };
  const haveIt = new Set(((theirs ?? []) as { user_id: string }[]).map((s) => s.user_id));

  // Plans are matched on the London calendar date, not a rolling 24 hours.
  const todaysPlans = ((plans ?? []) as unknown as PlanRow[]).filter(
    (p) => londonDate(p.proposed_for) === today,
  );

  const groups: FlowGroup[] = myGroups.map((g) => ({
    id: g.id,
    name: g.name,
    members: memberRows
      .filter((m) => m.group_id === g.id)
      .map((m) => ({
        id: m.user_id,
        name: m.profiles?.display_name ?? "Friend",
        avatarUrl: m.profiles?.avatar_url ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    rsvpYes: [
      ...new Set(
        todaysPlans
          .filter((p) => p.group_id === g.id)
          .flatMap((p) => p.plan_rsvps.filter((x) => x.response === "yes").map((x) => x.user_id)),
      ),
    ].filter((id) => id !== user.id && memberRows.some((m) => m.group_id === g.id && m.user_id === id)),
  }));

  const stamps = (myStamps ?? []) as MyStampRow[];
  const forCountry = stamps.find((s) => s.country_iso2 === r.country_iso2);
  const counted = (status as { restaurant_count: number } | null)?.restaurant_count ?? 0;
  const prediction: StampPrediction = {
    hasVisitStamp: !!forCountry && !forCountry.backfilled,
    hasBackfilledStamp: !!forCountry?.backfilled,
    stampedAts: stamps.map((s) => s.stamped_at),
    rarityCount: counted + (RARITY_STATUSES.includes(r.status) ? 0 : 1),
    firstInGroup: Object.fromEntries(
      groups.map((g) => [g.id, !g.members.some((m) => haveIt.has(m.id))]),
    ),
  };

  return (
    <CheckInFlow
      restaurant={{
        id: r.id,
        name: r.name,
        countryIso2: r.country_iso2,
        countryName,
        lat: r.lat,
        lon: r.lon,
        closed: r.status === "closed",
      }}
      dishes={(dishes ?? []) as { id: string; name: string }[]}
      groups={groups}
      prediction={prediction}
    />
  );
}
