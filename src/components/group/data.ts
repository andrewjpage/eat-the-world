import "server-only";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/countries";
import type { Verification } from "@/components/ui/Badge";
import { confirmWindowOpen } from "@/components/checkin/logic";
import { signPhotoUrls } from "@/components/photos/signed";
import type { GapCountry, GapRestaurant } from "./spin";

/**
 * Server-only loaders for the group page. Everything runs as the signed-in user:
 * RLS and the SECURITY DEFINER group functions decide what they may see. Reaction
 * data is counts only (visit_reaction_counts); the page never learns who reacted.
 */

export const FEED_LIMIT = 15;

export type Emoji = "clap" | "drool" | "side_eye";
export type ReactionCounts = Record<Emoji, { n: number; mine: boolean }>;

export interface LeaderRow {
  user_id: string;
  display_name: string;
  countries: number;
  points: number;
}

export interface FeedAttendee {
  userId: string;
  name: string;
  avatarUrl: string | null;
  status: "pending" | "confirmed" | "declined";
  stampWaiting: boolean;
  /** Only true while the 7 day window is open (older pending rows count as declined). */
  waiting: boolean;
}

export interface FeedItem {
  id: string;
  visitedAt: string;
  verification: Verification;
  /** A short-lived signed URL for the visit's photo, or null. */
  photoUrl: string | null;
  restaurant: { id: string; name: string };
  country: { iso2: string; name: string };
  createdBy: string | null;
  attendees: FeedAttendee[];
  stamps: { userId: string; name: string; points: number }[];
  dishes: string[];
  rating: { avg: number; n: number } | null;
  note: string | null;
  pendingCount: number;
  reactions: ReactionCounts;
}

export interface FlaggedItem {
  id: string;
  visitedAt: string;
  verification: Verification;
  restaurantName: string;
  country: { iso2: string; name: string };
  checkedInBy: string;
  sideEyes: number;
}

export interface GroupPageData {
  together: { stamped: number; listed: number };
  leaderboards: { season: LeaderRow[]; allTime: LeaderRow[] };
  feed: FeedItem[];
  gaps: GapCountry[];
  flagged: FlaggedItem[];
}

const EMPTY: ReactionCounts = {
  clap: { n: 0, mine: false },
  drool: { n: 0, mine: false },
  side_eye: { n: 0, mine: false },
};

type Profile = { display_name: string; avatar_url: string | null } | null;

interface VisitRow {
  id: string;
  visited_at: string;
  verification: Verification;
  created_by: string | null;
  photo_path: string | null;
  restaurants: {
    id: string;
    name: string;
    country_iso2: string;
    countries: { iso2: string; name: string | null; iso_name: string | null } | null;
  } | null;
  visit_attendees: {
    user_id: string;
    status: "pending" | "confirmed" | "declined";
    stamp_waiting: boolean;
    rating: number | null;
    dish_other: string | null;
    note: string | null;
    profiles: Profile;
    signature_dishes: { name: string } | null;
  }[];
}

const VISIT_SELECT =
  "id, visited_at, verification, created_by, photo_path, " +
  "restaurants(id, name, country_iso2, countries(iso2, name, iso_name)), " +
  "visit_attendees(user_id, status, stamp_waiting, rating, dish_other, note, profiles(display_name, avatar_url), signature_dishes(name))";

/** Confidence tiers for the Spin suggestion: curated and not flagged first. */
function tier(r: { confidence: string; status: string }): number {
  const base = r.confidence === "curated" ? 0 : r.confidence === "community" ? 1 : 2;
  return base * 2 + (r.status === "active" ? 0 : 1);
}

/**
 * Everything below the group header. `isOwner` may still be pending, so the page can start
 * this in the same round trip as its own group and member queries (a non-member's calls
 * just come back empty, and the page shows a 404 anyway). Two rounds in all: the city id
 * is chained into the first, not awaited before it.
 */
export async function loadGroupPage(groupId: string, isOwner: boolean | PromiseLike<boolean>): Promise<GroupPageData> {
  const supabase = await createClient();

  const cityP: Promise<string | null> = (async () => {
    const { data } = await supabase.from("cities").select("id").eq("slug", "london").maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  })();
  // Calls that need the city id start as soon as it arrives, not after the whole round.
  const withCity = async (rpc: "group_together" | "group_gaps"): Promise<{ data: unknown }> => {
    const cityId = await cityP;
    if (!cityId) return { data: null };
    return supabase.rpc(rpc, { p_group_id: groupId, p_city_id: cityId });
  };
  const flagsP = async (): Promise<{ data: unknown }> =>
    (await isOwner) ? supabase.rpc("group_flagged_visits", { p_group_id: groupId }) : { data: null };

  const [cityId, togetherR, seasonR, allTimeR, gapsR, visitsR, flagsR] = await Promise.all([
    cityP,
    withCity("group_together"),
    supabase.rpc("group_leaderboard", { p_group_id: groupId, p_season: true }),
    supabase.rpc("group_leaderboard", { p_group_id: groupId, p_season: false }),
    withCity("group_gaps"),
    supabase
      .from("visits")
      .select(VISIT_SELECT)
      .eq("group_id", groupId)
      .order("visited_at", { ascending: false })
      .limit(FEED_LIMIT),
    flagsP(),
  ]);

  const together = ((togetherR.data ?? []) as { stamped: number; listed: number }[])[0] ?? {
    stamped: 0,
    listed: 0,
  };
  const leaders = (rows: unknown): LeaderRow[] => (Array.isArray(rows) ? (rows as LeaderRow[]) : []);

  const visits = (visitsR.data ?? []) as unknown as VisitRow[];
  const flags = (flagsR.data ?? []) as {
    visit_id: string;
    side_eye_count: number;
    latest_side_eye_at: string;
  }[];
  const gapIso = ((gapsR.data ?? []) as { country_iso2: string }[]).map((g) => g.country_iso2);

  // Second round: reaction counts, stamps earned at these visits, flagged visit details, the Spin pool.
  const feedIds = visits.map((v) => v.id);
  const flaggedIds = flags.map((f) => f.visit_id).filter((id) => !feedIds.includes(id));
  const [countsR, stampsR, flaggedVisitsR, countriesR, restaurantsR, photoUrls] = await Promise.all([
    feedIds.length
      ? supabase.rpc("visit_reaction_counts", { p_visit_ids: feedIds })
      : Promise.resolve({ data: [] }),
    feedIds.length
      ? supabase
          .from("stamp_totals")
          .select("user_id, visit_id, points")
          .in("visit_id", feedIds)
          .eq("backfilled", false)
      : Promise.resolve({ data: [] }),
    flaggedIds.length
      ? supabase.from("visits").select(VISIT_SELECT).in("id", flaggedIds)
      : Promise.resolve({ data: [] }),
    gapIso.length
      ? supabase.from("countries").select("iso2, name, iso_name").in("iso2", gapIso)
      : Promise.resolve({ data: [] }),
    gapIso.length && cityId
      ? supabase
          .from("restaurants")
          .select("id, name, country_iso2, confidence, status")
          .eq("city_id", cityId)
          .in("country_iso2", gapIso)
          .in("status", ["active", "reported_closed"])
      : Promise.resolve({ data: [] }),
    // One call signs every feed photo, as the signed-in user.
    signPhotoUrls(supabase, visits.map((v) => v.photo_path)),
  ]);

  // Reactions by visit.
  const reactions = new Map<string, ReactionCounts>();
  for (const r of (countsR.data ?? []) as { visit_id: string; emoji: Emoji; n: number; mine: boolean }[]) {
    const cur = reactions.get(r.visit_id) ?? structuredClone(EMPTY);
    if (r.emoji in cur) cur[r.emoji] = { n: r.n, mine: r.mine };
    reactions.set(r.visit_id, cur);
  }

  // Points earned at each visit.
  const stampsByVisit = new Map<string, { userId: string; points: number }[]>();
  for (const s of (stampsR.data ?? []) as { user_id: string; visit_id: string; points: number }[]) {
    const list = stampsByVisit.get(s.visit_id) ?? [];
    list.push({ userId: s.user_id, points: s.points });
    stampsByVisit.set(s.visit_id, list);
  }

  const feed = visits.map((v): FeedItem => {
    const open = confirmWindowOpen(v.visited_at);
    const attendees: FeedAttendee[] = v.visit_attendees
      .map((a) => ({
        userId: a.user_id,
        name: a.profiles?.display_name ?? "Former member",
        avatarUrl: a.profiles?.avatar_url ?? null,
        status: a.status,
        stampWaiting: a.stamp_waiting,
        waiting: a.status === "pending" && open,
      }))
      .sort(
        (a, b) =>
          Number(b.userId === v.created_by) - Number(a.userId === v.created_by) ||
          Number(b.status === "confirmed") - Number(a.status === "confirmed") ||
          a.name.localeCompare(b.name),
      );
    const nameOf = new Map(attendees.map((a) => [a.userId, a.name]));
    const confirmed = v.visit_attendees.filter((a) => a.status === "confirmed");
    const ratings = confirmed.map((a) => a.rating).filter((r): r is number => r != null);
    const dishes = [
      ...new Set(
        confirmed
          .map((a) => a.signature_dishes?.name ?? a.dish_other?.trim() ?? "")
          .filter((d) => d.length > 0),
      ),
    ];
    const checker = v.visit_attendees.find((a) => a.user_id === v.created_by);
    const country = v.restaurants?.countries;
    return {
      id: v.id,
      visitedAt: v.visited_at,
      verification: v.verification,
      photoUrl: (v.photo_path && photoUrls.get(v.photo_path)) || null,
      restaurant: { id: v.restaurants?.id ?? "", name: v.restaurants?.name ?? "A restaurant" },
      country: {
        iso2: v.restaurants?.country_iso2 ?? "",
        name: country ? displayName(country) : (v.restaurants?.country_iso2 ?? ""),
      },
      createdBy: v.created_by,
      attendees,
      stamps: (stampsByVisit.get(v.id) ?? [])
        .map((s) => ({ ...s, name: nameOf.get(s.userId) ?? "A friend" }))
        .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)),
      dishes,
      rating: ratings.length
        ? { avg: ratings.reduce((a, b) => a + b, 0) / ratings.length, n: ratings.length }
        : null,
      note: checker?.note?.trim() || null,
      pendingCount: attendees.filter((a) => a.waiting).length,
      reactions: reactions.get(v.id) ?? structuredClone(EMPTY),
    };
  });

  // The owner's flag list: details come from the feed rows or the second query.
  const known = new Map<string, VisitRow>();
  for (const v of [...visits, ...((flaggedVisitsR.data ?? []) as unknown as VisitRow[])]) known.set(v.id, v);
  const flagged: FlaggedItem[] = flags.flatMap((f) => {
    const v = known.get(f.visit_id);
    if (!v) return [];
    const country = v.restaurants?.countries;
    const who = v.visit_attendees.find((a) => a.user_id === v.created_by)?.profiles?.display_name;
    return [
      {
        id: v.id,
        visitedAt: v.visited_at,
        verification: v.verification,
        restaurantName: v.restaurants?.name ?? "A restaurant",
        country: {
          iso2: v.restaurants?.country_iso2 ?? "",
          name: country ? displayName(country) : (v.restaurants?.country_iso2 ?? ""),
        },
        checkedInBy: who ?? "A friend",
        sideEyes: f.side_eye_count,
      },
    ];
  });

  // Gaps, each with the restaurants Spin may suggest (best tier first).
  const names = new Map(
    ((countriesR.data ?? []) as { iso2: string; name: string | null; iso_name: string | null }[]).map((c) => [
      c.iso2,
      displayName(c),
    ]),
  );
  const byCountry = new Map<string, (GapRestaurant & { rank: number })[]>();
  for (const r of (restaurantsR.data ?? []) as {
    id: string;
    name: string;
    country_iso2: string;
    confidence: string;
    status: string;
  }[]) {
    const list = byCountry.get(r.country_iso2) ?? [];
    list.push({ id: r.id, name: r.name, rank: tier(r) });
    byCountry.set(r.country_iso2, list);
  }
  const gaps: GapCountry[] = gapIso
    .map((iso2) => {
      const list = (byCountry.get(iso2) ?? []).sort((a, b) => a.rank - b.rank);
      const best = list.length ? list[0].rank : 0;
      return {
        iso2,
        name: names.get(iso2) ?? iso2,
        restaurants: list.filter((r) => r.rank === best).map(({ id, name }) => ({ id, name })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    together,
    leaderboards: { season: leaders(seasonR.data), allTime: leaders(allTimeR.data) },
    feed,
    gaps,
    flagged,
  };
}
