import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, requireUser } from "@/components/auth/session";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Page } from "@/components/ui/Page";

export const metadata: Metadata = { title: "Join a group" };

const CODE_RE = /^[A-Z0-9]{8}$/;

function joinedWithin(joinedAt: string, ms: number): boolean {
  return Date.now() - new Date(joinedAt).getTime() < ms;
}

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
 * Invite link: /join/ABCD1234. Signed out → /login and back here (the proxy and
 * requireUser both do this). Signed in → join_group, then first-timers go to
 * backfill onboarding and everyone else to the group.
 */
export default async function JoinPage({ params }: PageProps<"/join/[code]">) {
  const { code: raw } = await params;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed escape: validated (and rejected) below.
  }
  const code = decoded.replace(/\s/g, "").toUpperCase();
  const user = await requireUser(`/join/${encodeURIComponent(raw)}`);

  if (!CODE_RE.test(code)) {
    return (
      <JoinProblem emoji="🔍" title="That invite looks smudged">
        Invite codes are 8 letters and numbers. Ask whoever sent it for a fresh link.
      </JoinProblem>
    );
  }

  const supabase = await createClient();
  const [{ data: memberships }, stamps] = await Promise.all([
    supabase.from("group_members").select("group_id, joined_at").eq("user_id", user.id),
    supabase
      .from("stamps")
      .select("country_iso2", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  const { data: groupId, error } = await supabase.rpc("join_group", { p_invite_code: code });

  if (error || !groupId) {
    const message = friendlyError(error, "We couldn't join that group. Please try again.");
    if (/full/i.test(message)) {
      return (
        <JoinProblem emoji="🍽️" title="This table is full">
          {`${message} Ask the owner to make room, or start your own group.`}
        </JoinProblem>
      );
    }
    if (/doesn.t match/i.test(message)) {
      return (
        <JoinProblem emoji="🔍" title="That invite has expired">
          The group owner may have changed the link. Ask them to send the new one.
        </JoinProblem>
      );
    }
    return (
      <JoinProblem emoji="😬" title="Couldn't join">
        {message}
      </JoinProblem>
    );
  }

  // First time: no stamps and no other group, and not a long-standing member of
  // this one. The 10-minute grace keeps it stable if this page renders twice.
  const previous = (memberships ?? []).find((m) => m.group_id === groupId);
  const recentlyJoined = !previous || joinedWithin(previous.joined_at as string, 10 * 60_000);
  const firstTime =
    (stamps.count ?? 0) === 0 &&
    (memberships ?? []).every((m) => m.group_id === groupId) &&
    recentlyJoined;

  redirect(firstTime ? "/settings/backfill?onboarding=1" : `/group/${groupId}`);
}
