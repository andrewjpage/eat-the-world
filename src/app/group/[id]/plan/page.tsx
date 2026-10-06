import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/components/auth/session";
import { UUID_RE } from "@/components/checkin/logic";
import { PlanList } from "@/components/plans/PlanList";
import { Page, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Dinner plans" };

/** Stand-alone view of a group's dinner plans (the group page embeds the same PlanList). */
export default async function PlansPage({ params }: PageProps<"/group/[id]/plan">) {
  const { id } = await params;
  const user = await requireUser(`/group/${id}/plan`);
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();
  const { data: group } = await supabase.from("groups").select("id, name, owner_id").eq("id", id).maybeSingle();
  if (!group) notFound();
  return (
    <Page>
      <PageHeader kicker={group.name} title="Dinner plans" />
      <PlanList groupId={group.id} userId={user.id} isOwner={group.owner_id === user.id} />
    </Page>
  );
}
