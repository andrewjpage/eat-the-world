import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/components/auth/session";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Page } from "@/components/ui/Page";
import { INVITE_CODE_RE, normaliseInviteCode } from "./code";
import { JoinButton } from "./JoinButton";

export const metadata: Metadata = { title: "Join a group" };

const GROUP_MAX_MEMBERS = 20;

function JoinProblem({ title, children, emoji }: { title: string; children: string; emoji: string }) {
  return (
    <Page>
      <EmptyState
        emoji={emoji}
        title={title}
        action={
          <div className="space-y-3">
            <ButtonLink href="/" block>
              Go to my passport
            </ButtonLink>
            <ButtonLink href="/group" variant="secondary" block>
              My groups
            </ButtonLink>
          </div>
        }
      >
        {children}
      </EmptyState>
    </Page>
  );
}

/**
 * Invite link: /join/ABCD1234. Signed out → /login and back here (the proxy and requireUser
 * both do this). Signed in, this page only reads: it shows the group and a "Join the table"
 * button, and the join itself is a server action (POST), so following a link can't join anyone.
 * Members of the group go straight to it.
 */
export default async function JoinPage({ params }: PageProps<"/join/[code]">) {
  const { code: raw } = await params;
  const code = normaliseInviteCode(raw);
  await requireUser(`/join/${encodeURIComponent(raw)}`);

  if (!INVITE_CODE_RE.test(code)) {
    return (
      <JoinProblem emoji="🔍" title="That invite looks smudged">
        Invite codes are 8 letters and numbers. Ask whoever sent it for a fresh link.
      </JoinProblem>
    );
  }

  const supabase = await createClient();
  // RLS returns the group only to its members.
  const [{ data: mine }, { data: preview }] = await Promise.all([
    supabase.from("groups").select("id").eq("invite_code", code).maybeSingle(),
    supabase.rpc("invite_preview", { p_invite_code: code }),
  ]);
  if (mine) redirect(`/group/${mine.id}`);

  const group = (preview as { name: string; members: number }[] | null)?.[0];
  if (!group) {
    return (
      <JoinProblem emoji="🔍" title="That invite has expired">
        The group owner may have changed the link. Ask them to send the new one.
      </JoinProblem>
    );
  }
  if (group.members >= GROUP_MAX_MEMBERS) {
    return (
      <JoinProblem emoji="🍽️" title="This table is full">
        {`${GROUP_MAX_MEMBERS} members is the limit. Ask the owner to make room.`}
      </JoinProblem>
    );
  }

  const others = group.members === 1 ? "1 friend is" : `${group.members} friends are`;
  return (
    <Page>
      <EmptyState
        emoji="🍽️"
        title={`Join ${group.name}?`}
        action={
          <div className="space-y-3">
            <JoinButton code={code} />
            <ButtonLink href="/" variant="ghost" block>
              Not now
            </ButtonLink>
          </div>
        }
      >
        {`${others} already at the table. Join to eat your way round the world together: one check-in stamps everyone who came.`}
      </EmptyState>
    </Page>
  );
}
