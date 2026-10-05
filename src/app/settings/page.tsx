import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile, requireUser } from "@/components/auth/session";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card, Eyebrow } from "@/components/ui/Card";
import { Page, PageHeader } from "@/components/ui/Page";
import { CreateGroupForm } from "@/app/group/CreateGroupForm";
import { ProfileForm } from "./ProfileForm";
import { DeleteAccount } from "@/components/settings/DeleteAccount";
import { signOutAction } from "./actions";

export const metadata: Metadata = { title: "Settings" };

function Row({ href, title, detail, icon }: { href: string; title: string; detail?: string; icon: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-paper-sunk active:bg-paper-sunk"
      >
        <span aria-hidden className="grid size-9 place-items-center rounded-full bg-paper-sunk text-lg">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">{title}</span>
          {detail && <span className="block truncate text-sm text-muted">{detail}</span>}
        </span>
        <span aria-hidden className="text-xl text-muted">
          ›
        </span>
      </Link>
    </li>
  );
}

export default async function SettingsPage() {
  const user = await requireUser("/settings");
  const profile = (await getMyProfile())!;
  const supabase = await createClient();

  const [{ data: memberships }, { count: backfilled }] = await Promise.all([
    supabase
      .from("group_members")
      .select("role, groups(id, name)")
      .eq("user_id", user.id)
      .order("joined_at"),
    supabase
      .from("stamps")
      .select("country_iso2", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("backfilled", true),
  ]);

  const groups = (memberships ?? [])
    .map((m) => {
      const g = m.groups as unknown as { id: string; name: string } | null;
      return g ? { id: g.id, name: g.name, owner: m.role === "owner" } : null;
    })
    .filter((g): g is { id: string; name: string; owner: boolean } => g !== null);

  return (
    <Page>
      <PageHeader title="Settings" kicker="Your passport" />

      <Card className="mb-5">
        <div className="mb-4 flex items-center gap-3">
          <Avatar name={profile.display_name} src={profile.avatar_url} size={52} />
          <div className="min-w-0">
            <p className="truncate font-display text-xl text-ink">{profile.display_name}</p>
            {user.email && <p className="truncate text-sm text-muted">{user.email}</p>}
          </div>
        </div>
        <ProfileForm displayName={profile.display_name} />
      </Card>

      <Eyebrow className="mb-2 px-1">Passport</Eyebrow>
      <Card className="mb-5 overflow-hidden p-0">
        <ul className="divide-y divide-line">
          <Row
            href="/settings/backfill"
            icon="🧳"
            title="Countries before the app"
            detail={
              backfilled
                ? `${backfilled} passport ${backfilled === 1 ? "memory" : "memories"} · 0 points`
                : "Add places you've eaten already · 0 points"
            }
          />
        </ul>
      </Card>

      <Eyebrow className="mb-2 px-1">Groups</Eyebrow>
      <Card className={`${groups.length > 0 || profile.is_curator ? "mb-3" : "mb-5"} overflow-hidden p-0`}>
        {groups.length > 0 ? (
          <ul className="divide-y divide-line">
            {groups.map((g) => (
              <Row
                key={g.id}
                href={`/group/${g.id}`}
                icon="🍽️"
                title={g.name}
                detail={g.owner ? "You run this group" : "Member"}
              />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-4 text-sm text-ink-soft">
            {profile.is_curator
              ? "No groups yet. Start the first one below, then share its invite link."
              : "No groups yet. Eat the World is invite-only: ask a friend for their group's invite link."}
          </p>
        )}
      </Card>
      {/* Invite-only: a new group needs the curator or someone already in a group. */}
      {(groups.length > 0 || profile.is_curator) && (
        <Card tone="sunk" className="mb-5">
          <p className="mb-3 font-display text-lg text-ink">Start a new group</p>
          <CreateGroupForm />
        </Card>
      )}

      <Eyebrow className="mb-2 px-1">About</Eyebrow>
      <Card className="mb-6 overflow-hidden p-0">
        <ul className="divide-y divide-line">
          <Row href="/privacy" icon="🔒" title="Privacy" detail="What we keep, and how to delete it" />
          <Row href="/credits" icon="📜" title="Credits" detail="Maps, flags and data sources" />
        </ul>
      </Card>

      <DeleteAccount />

      <form action={signOutAction}>
        <Button type="submit" variant="danger" block>
          Sign out
        </Button>
      </form>
    </Page>
  );
}
