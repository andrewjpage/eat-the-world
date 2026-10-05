import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GROUP_MAX_MEMBERS } from "@/lib/scoring";
import { requireUser } from "@/components/auth/session";
import { ActivityFeed } from "@/components/group/ActivityFeed";
import { FlagList } from "@/components/group/FlagList";
import { GapGrid } from "@/components/group/GapGrid";
import { GroupSettings } from "@/components/group/GroupSettings";
import { Leaderboard } from "@/components/group/Leaderboard";
import { SpinGlobe } from "@/components/group/SpinGlobe";
import { Together } from "@/components/group/Together";
import { loadGroupPage } from "@/components/group/data";
import { PlanList } from "@/components/plans/PlanList";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card, Eyebrow } from "@/components/ui/Card";
import { Page, PageHeader } from "@/components/ui/Page";
import { InviteCard } from "./InviteCard";

export async function generateMetadata({ params }: PageProps<"/group/[id]">): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Group" };
  const supabase = await createClient();
  // RLS: only members can read the group, so a non-member gets the generic title.
  const { data } = await supabase.from("groups").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Group" };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MemberRow {
  user_id: string;
  role: "owner" | "member";
  joined_at: string;
  profiles: { display_name: string; avatar_url: string | null } | null;
}

/**
 * Absolute origin for the invite link. NEXT_PUBLIC_APP_URL wins when set, so a
 * link copied on a preview deployment still points at the real app; otherwise
 * the request's own host (works on any local port).
 */
async function requestOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https");
  if (host) return `${proto}://${host}`;
  return "http://127.0.0.1:3000";
}

function PlansFallback() {
  return (
    <section aria-label="Dinner plans" aria-busy="true">
      <Eyebrow className="mb-2 px-1">Dinner plans</Eyebrow>
      <Card tone="sunk" className="h-24 animate-pulse motion-reduce:animate-none">
        <span className="sr-only">Loading plans…</span>
      </Card>
    </section>
  );
}

const joinedFmt = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "Europe/London" });

/**
 * The group page. Sections, top to bottom (brief section 6.7), built for the fun core loop:
 *   1. Header: name and members
 *   2. Together bar
 *   3. Spin the globe + Gaps
 *   4. Dinner plans (PlanList, owned by the plans agent)
 *   5. Leaderboard (season / all-time)
 *   6. Activity feed with reactions
 *   7. Invite friends, Members
 *   8. Owner tools: settings and the private flag list (owner only)
 */
export default async function GroupPage({ params }: PageProps<"/group/[id]">) {
  const { id } = await params;
  const user = await requireUser(`/group/${id}`);
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const groupP = supabase
    .from("groups")
    .select("id, name, owner_id, invite_code, verified_only, season_start, season_end")
    .eq("id", id)
    .maybeSingle();
  // The page data starts in the same round trip; only the owner's flag list waits for the group.
  const [{ data: group }, { data: memberRows }, data] = await Promise.all([
    groupP,
    supabase
      .from("group_members")
      .select("user_id, role, joined_at, profiles(display_name, avatar_url)")
      .eq("group_id", id)
      .order("joined_at"),
    loadGroupPage(
      id,
      groupP.then(({ data: g }) => !!g && g.owner_id === user.id),
    ),
  ]);
  // RLS hides groups you aren't in, so "not a member" and "doesn't exist" look the same.
  if (!group) notFound();

  const members = (memberRows ?? []) as unknown as MemberRow[];
  const isOwner = group.owner_id === user.id;
  const origin = await requestOrigin();
  const inviteUrl = `${origin}/join/${group.invite_code}`;
  const settings = {
    name: group.name,
    verifiedOnly: group.verified_only,
    seasonStart: group.season_start,
    seasonEnd: group.season_end,
  };

  return (
    <Page>
      {/* 1. Header */}
      <PageHeader kicker="Group" title={group.name}>
        <p>
          {members.length} {members.length === 1 ? "member" : "members"}
          {isOwner && " · you run this group"}
        </p>
      </PageHeader>

      <div className="space-y-5">
        {/* 2. Together */}
        <Together stamped={data.together.stamped} listed={data.together.listed} />

        {/* 3. Spin the globe and Gaps */}
        <SpinGlobe groupId={group.id} gaps={data.gaps} />
        <GapGrid gaps={data.gaps} />

        {/* 4. Plans */}
        {/* Streams in after the rest, so Together and Spin paint first. */}
        <Suspense fallback={<PlansFallback />}>
          <PlanList groupId={group.id} userId={user.id} isOwner={isOwner} origin={origin} />
        </Suspense>

        {/* 5. Leaderboard */}
        <Leaderboard
          key={`${group.season_start}|${group.season_end}`}
          season={data.leaderboards.season}
          allTime={data.leaderboards.allTime}
          seasonStart={group.season_start}
          seasonEnd={group.season_end}
          verifiedOnly={group.verified_only}
          meId={user.id}
          action={isOwner ? <GroupSettings groupId={group.id} initial={settings} label="Season & rules" /> : undefined}
        />

        {/* 6. Activity feed */}
        <ActivityFeed items={data.feed} checkInHref="/check-in" />

        {/* 7. Invite friends */}
        <section id="invite" aria-label="Invite friends">
          <InviteCard
            groupId={group.id}
            groupName={group.name}
            inviteUrl={inviteUrl}
            inviteCode={group.invite_code}
            isOwner={isOwner}
            memberCount={members.length}
            maxMembers={GROUP_MAX_MEMBERS}
          />
        </section>

        {/* 7. Members */}
        <section id="members" aria-labelledby="members-heading">
          <Eyebrow id="members-heading" className="mb-2 px-1">
            Members · {members.length}/{GROUP_MAX_MEMBERS}
          </Eyebrow>
          <Card className="p-0">
            <ul className="divide-y divide-line" data-testid="member-list">
              {members.map((m) => {
                const name = m.profiles?.display_name ?? "Former member";
                return (
                  <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={name} src={m.profiles?.avatar_url} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">
                        {name}
                        {m.user_id === user.id && <span className="font-normal text-muted"> (you)</span>}
                      </p>
                      <p className="text-xs text-muted">Joined {joinedFmt.format(new Date(m.joined_at))}</p>
                    </div>
                    {m.role === "owner" && <Badge tone="red">Owner</Badge>}
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>

        {/* 8. Owner tools (private) */}
        {isOwner && (
          <section id="owner-tools" aria-labelledby="owner-heading" className="space-y-4">
            <Eyebrow id="owner-heading" className="px-1">
              Owner tools
            </Eyebrow>
            <GroupSettings groupId={group.id} initial={settings} label="Group settings" variant="button" />
            <FlagList groupId={group.id} items={data.flagged} />
          </section>
        )}
      </div>
    </Page>
  );
}
