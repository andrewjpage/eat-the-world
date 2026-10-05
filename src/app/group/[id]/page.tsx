import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GROUP_MAX_MEMBERS } from "@/lib/scoring";
import { requireUser } from "@/components/auth/session";
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

const joinedFmt = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "Europe/London" });

/**
 * The group page. Sections, top to bottom (brief section 6.7):
 *   1. Header: name and members           (M2, here)
 *   2. Together bar                         (M4)
 *   3. Leaderboard (season / all-time)      (M4)
 *   4. Plans: Spin the globe, Plan a dinner (M4)
 *   5. Activity feed with reactions         (M4)
 *   6. Gaps                                 (M4)
 *   7. Owner's flag list                    (M4)
 *   8. Invite friends                       (M2, here)
 *   9. Members                              (M2, here)
 * Later milestones add their section components in the marked slots.
 */
export default async function GroupPage({ params }: PageProps<"/group/[id]">) {
  const { id } = await params;
  const user = await requireUser(`/group/${id}`);
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: group }, { data: memberRows }] = await Promise.all([
    supabase.from("groups").select("id, name, owner_id, invite_code").eq("id", id).maybeSingle(),
    supabase
      .from("group_members")
      .select("user_id, role, joined_at, profiles(display_name, avatar_url)")
      .eq("group_id", id)
      .order("joined_at"),
  ]);
  // RLS hides groups you aren't in, so "not a member" and "doesn't exist" look the same.
  if (!group) notFound();

  const members = (memberRows ?? []) as unknown as MemberRow[];
  const isOwner = group.owner_id === user.id;
  const origin = await requestOrigin();
  const inviteUrl = `${origin}/join/${group.invite_code}`;

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
        {/* 2–7. M4 slots: <TogetherBar />, <Leaderboard />, <Plans />, <Feed />, <Gaps />, <FlagList /> */}
        <section aria-labelledby="table-heading">
          <Card tone="sunk" className="text-center">
            <p id="table-heading" className="font-display text-lg text-ink">
              The table is set
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              Your Together bar, leaderboard and dinner plans appear here once the group starts
              checking in.
            </p>
          </Card>
        </section>

        {/* 8. Invite friends */}
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

        {/* 9. Members */}
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
      </div>
    </Page>
  );
}
