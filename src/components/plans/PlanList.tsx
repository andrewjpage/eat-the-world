import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink, Card, EmptyState, Eyebrow } from "@/components/ui";
import { PlanCard, type PlanCardData } from "./PlanCard";
import { isUpcoming, summariseRsvps, type PlanStatus, type Rsvp } from "./logic";

async function requestOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https");
  return host ? `${proto}://${host}` : "http://127.0.0.1:3000";
}

interface PlanRow {
  id: string;
  restaurant_id: string;
  proposed_by: string | null;
  proposed_for: string;
  status: PlanStatus;
  restaurants: { name: string } | null;
  profiles: { display_name: string } | null;
  plan_rsvps: { user_id: string; response: Rsvp; profiles: { display_name: string } | null }[];
}

/**
 * Upcoming dinner plans for a group (brief 6.7), for the group page. Server component:
 * RLS limits every read to the group's members.
 */
export async function PlanList({
  groupId,
  userId,
  isOwner,
  origin,
}: {
  groupId: string;
  userId: string;
  isOwner: boolean;
  /** Absolute origin for the shared link; defaults to the request's own. */
  origin?: string;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("plans")
    .select(
      "id, restaurant_id, proposed_by, proposed_for, status, restaurants(name), profiles:proposed_by(display_name), plan_rsvps(user_id, response, profiles(display_name))",
    )
    .eq("group_id", groupId)
    .in("status", ["proposed", "booked"])
    .order("proposed_for");
  const base = (origin ?? (await requestOrigin())).replace(/\/+$/, "");
  const groupUrl = `${base}/group/${groupId}`;
  const now = new Date();

  const plans: PlanCardData[] = ((data ?? []) as unknown as PlanRow[])
    .filter((p) => isUpcoming(p, now))
    .map((p) => ({
      id: p.id,
      status: p.status,
      proposedFor: p.proposed_for,
      restaurantId: p.restaurant_id,
      restaurantName: p.restaurants?.name ?? "A restaurant",
      proposerName: p.profiles?.display_name ?? null,
      canManage: isOwner || p.proposed_by === userId,
      rsvps: summariseRsvps(p.plan_rsvps.map((r) => ({ response: r.response, name: r.profiles?.display_name ?? "Someone" }))),
      mine: p.plan_rsvps.find((r) => r.user_id === userId)?.response ?? null,
      groupUrl,
    }));

  return (
    <section aria-labelledby="plans-heading" data-testid="plan-list">
      <div className="mb-2 flex items-center justify-between px-1">
        <Eyebrow id="plans-heading">Dinner plans</Eyebrow>
        <ButtonLink href={`/group/${groupId}/plan/new`} prefetch={false} size="sm" variant="secondary">
          Plan a dinner
        </ButtonLink>
      </div>
      {plans.length === 0 ? (
        <Card tone="sunk">
          <EmptyState
            emoji="🍽️"
            title="No dinner planned yet"
            action={
              <ButtonLink href={`/group/${groupId}/plan/new`} prefetch={false}>
                Plan a dinner
              </ButtonLink>
            }
          >
            Pick a restaurant and a night, and the group can say who is in.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-3">
          {plans.map((p) => (
            <PlanCard key={p.id} plan={p} userId={userId} />
          ))}
        </div>
      )}
    </section>
  );
}
