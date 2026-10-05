import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile, requireUser } from "@/components/auth/session";
import { Card, Eyebrow } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Page, PageHeader } from "@/components/ui/Page";
import { CreateGroupForm } from "./CreateGroupForm";

export const metadata: Metadata = { title: "Groups" };

interface GroupRow {
  id: string;
  name: string;
  owner_id: string | null;
  group_members: { count: number }[];
}

/** My groups, and a form to start one. */
export default async function GroupsPage() {
  const user = await requireUser("/group");
  const supabase = await createClient();
  const { data } = await supabase
    .from("groups")
    .select("id, name, owner_id, group_members(count)")
    .order("created_at");
  const groups = (data ?? []) as unknown as GroupRow[];

  if (groups.length === 0) {
    // Invite-only: only the curator can start the first group; everyone else joins by invite.
    const curator = (await getMyProfile())?.is_curator === true;
    return (
      <Page>
        <EmptyState emoji="🍽️" title="No table yet">
          {curator
            ? "Groups are where the fun happens: dinners together, one check-in stamps the whole table. Start the first one and invite your friends."
            : "Groups are where the fun happens: dinners together, one check-in stamps the whole table. Eat the World is invite-only, so ask a friend for their group's invite link."}
        </EmptyState>
        {curator && (
          <Card>
            <CreateGroupForm cta="Start a group" />
          </Card>
        )}
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader kicker="Your tables" title="Groups" />
      <ul className="mb-6 space-y-3">
        {groups.map((g) => {
          const count = g.group_members[0]?.count ?? 0;
          return (
            <li key={g.id}>
              <Link href={`/group/${g.id}`} className="block transition active:scale-[0.99]">
                <Card className="flex items-center gap-4 hover:border-ink/30">
                  <span
                    aria-hidden
                    className="stamp-ink grid size-12 shrink-0 place-items-center rounded-full text-xl text-stamp-red"
                  >
                    🍽️
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-xl text-ink">{g.name}</span>
                    <span className="block text-sm text-muted">
                      {count} {count === 1 ? "member" : "members"}
                      {g.owner_id === user.id && " · you run it"}
                    </span>
                  </span>
                  <span aria-hidden className="text-2xl text-muted">
                    ›
                  </span>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
      <Eyebrow className="mb-2 px-1">Another table?</Eyebrow>
      <Card tone="sunk">
        <CreateGroupForm cta="Start a group" />
      </Card>
    </Page>
  );
}
