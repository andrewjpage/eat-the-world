import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/components/auth/session";
import { UUID_RE } from "@/components/checkin/logic";
import { PlanForm } from "@/components/plans/PlanForm";
import { nextFridayLondon, parsePlanDate } from "@/components/plans/logic";
import { Page, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Plan a dinner" };

export default async function NewPlanPage({ params, searchParams }: PageProps<"/group/[id]/plan/new">) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/group/${id}/plan/new`);
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const { data: group } = await supabase.from("groups").select("id, name").eq("id", id).maybeSingle();
  // RLS hides groups you are not in.
  if (!group) notFound();

  const rid = typeof sp.restaurant === "string" && UUID_RE.test(sp.restaurant) ? sp.restaurant : null;
  const { data: pre } = rid
    ? await supabase.from("restaurants").select("id, name, address").eq("id", rid).maybeSingle()
    : { data: null };

  // ?date= wins; with a restaurant already picked (from Spin), next Friday is the default.
  const initialDate = parsePlanDate(sp.date) ?? (pre ? nextFridayLondon() : "");

  return (
    <Page>
      <PageHeader kicker={group.name} title="Plan a dinner" />
      <PlanForm groupId={group.id} userId={user.id} initial={pre ?? null} initialDate={initialDate} />
    </Page>
  );
}
