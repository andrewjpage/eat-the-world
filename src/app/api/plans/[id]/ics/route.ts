import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/components/checkin/logic";
import { icsFilename, planIcs } from "@/components/plans/logic";

/** GET /api/plans/[id]/ics: the dinner as a calendar file. Members of the plan's group only. */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function origin(request: NextRequest): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || request.nextUrl.origin).replace(/\/+$/, "");
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/plans/[id]/ics">) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404, headers: NO_STORE });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return new Response("Sign in to download this.", { status: 401, headers: NO_STORE });

  // RLS: only members of the plan's group can read it, so anyone else gets a 404.
  const { data: plan } = await supabase
    .from("plans")
    .select("id, group_id, proposed_for, groups(name), restaurants(name, address, postcode)")
    .eq("id", id)
    .maybeSingle();
  const restaurant = plan?.restaurants as unknown as { name: string; address: string | null; postcode: string | null } | null;
  if (!plan || !restaurant) return new Response("Not found", { status: 404, headers: NO_STORE });

  const groupName = (plan.groups as unknown as { name: string } | null)?.name ?? "Your group";
  const body = planIcs(
    { id: plan.id, proposed_for: plan.proposed_for, restaurant },
    groupName,
    `${origin(request)}/group/${plan.group_id}`,
  );
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // inline: iOS Safari then offers Add to Calendar instead of saving to Files; desktop
      // browsers still download text/calendar.
      "Content-Disposition": `inline; filename="${icsFilename(restaurant.name)}"`,
      ...NO_STORE,
    },
  });
}
