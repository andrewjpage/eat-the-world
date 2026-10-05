import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/countries";
import { requireUser } from "@/components/auth/session";
import { NudgeButton } from "@/components/checkin/NudgeButton";
import { VisitActions, type VisitMode } from "@/components/checkin/VisitActions";
import { UUID_RE, confirmWindowOpen, dailyCapFull } from "@/components/checkin/logic";
import { formatDate, Stars } from "@/components/restaurant/format";
import { PointsBreakdown } from "@/components/stamp/PointsBreakdown";
import {
  Avatar,
  Badge,
  Card,
  Eyebrow,
  Flag,
  Page,
  Stamp,
  VerificationBadge,
  type BadgeTone,
  type Verification,
} from "@/components/ui";

export const metadata: Metadata = { title: "Visit" };

interface AttendeeRow {
  user_id: string;
  status: "pending" | "confirmed" | "declined";
  stamp_waiting: boolean;
  rating: number | null;
  dish_other: string | null;
  profiles: { display_name: string; avatar_url: string | null } | null;
  signature_dishes: { name: string } | null;
}

interface StampRow {
  visit_id: string | null;
  base: number;
  rarity_bonus: number;
  table_bonus: number;
  dish_bonus: number;
  stamped_at: string | null;
  earned_at: string;
  verification: Verification;
  backfilled: boolean;
}

function attendeeStatus(a: AttendeeRow, open: boolean): { label: string; tone: BadgeTone } {
  if (a.status === "confirmed") {
    return a.stamp_waiting
      ? { label: "Stamp waiting", tone: "gold" }
      : { label: "Confirmed", tone: "teal" };
  }
  if (a.status === "declined") return { label: "Couldn't make it", tone: "muted" };
  // Older pending rows count as declined (brief section 4), shown as "No reply".
  return open ? { label: "Waiting to confirm", tone: "red" } : { label: "No reply", tone: "muted" };
}

export default async function VisitPage({ params }: PageProps<"/visit/[id]">) {
  const { id } = await params;
  const user = await requireUser(`/visit/${id}`);
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const { data: visit } = await supabase
    .from("visits")
    .select(
      "id, visited_at, verification, group_id, groups(name), restaurants(id, name, country_iso2, countries(iso2, name, iso_name))",
    )
    .eq("id", id)
    .maybeSingle();
  // RLS only returns visits of the caller's groups: anyone else gets a 404.
  if (!visit) notFound();

  const restaurant = visit.restaurants as unknown as {
    id: string;
    name: string;
    country_iso2: string;
    countries: { iso2: string; name: string; iso_name: string } | null;
  };
  const groupName = (visit.groups as unknown as { name: string } | null)?.name ?? "your group";
  const countryName = restaurant.countries ? displayName(restaurant.countries) : restaurant.country_iso2;
  const open = confirmWindowOpen(visit.visited_at);

  const [{ data: att }, { data: myStamp }, { data: dishes }, { data: members }] = await Promise.all([
    supabase
      .from("visit_attendees")
      .select(
        "user_id, status, stamp_waiting, rating, dish_other, profiles(display_name, avatar_url), signature_dishes(name)",
      )
      .eq("visit_id", id),
    supabase
      .from("stamps")
      .select("visit_id, base, rarity_bonus, table_bonus, dish_bonus, stamped_at, earned_at, verification, backfilled")
      .eq("user_id", user.id)
      .eq("country_iso2", restaurant.country_iso2)
      .maybeSingle(),
    supabase
      .from("signature_dishes")
      .select("id, name")
      .eq("country_iso2", restaurant.country_iso2)
      .eq("status", "approved")
      .order("name"),
    supabase.from("group_members").select("user_id").eq("group_id", visit.group_id),
  ]);
  const memberIds = new Set(((members ?? []) as { user_id: string }[]).map((m) => m.user_id));

  const attendees = ((att ?? []) as unknown as AttendeeRow[]).sort(
    (a, b) =>
      Number(b.status === "confirmed") - Number(a.status === "confirmed") ||
      (a.profiles?.display_name ?? "").localeCompare(b.profiles?.display_name ?? ""),
  );
  const me = attendees.find((a) => a.user_id === user.id) ?? null;
  const pendingOthers = attendees.filter(
    (a) => a.user_id !== user.id && a.status === "pending" && open,
  ).length;
  const anyPending = attendees.some((a) => a.status === "pending") && open;

  const stamp = myStamp as StampRow | null;
  // A waiting row for a country stamped since at another visit would only claim a repeat
  // (the passport banner drops these rows too).
  const staleWaiting =
    me?.status === "confirmed" && me.stamp_waiting && !!stamp && !stamp.backfilled && stamp.visit_id !== id;

  let mode: VisitMode = "none";
  if (me?.status === "pending" && open) mode = "pending";
  else if (me?.status === "confirmed" && me.stamp_waiting && !staleWaiting) mode = "waiting";

  let capFull = false;
  if (mode === "waiting") {
    const { data: recent } = await supabase
      .from("stamps")
      .select("stamped_at")
      .eq("user_id", user.id)
      .not("stamped_at", "is", null)
      .order("stamped_at", { ascending: false })
      .limit(10);
    capFull = dailyCapFull(((recent ?? []) as { stamped_at: string | null }[]).map((s) => s.stamped_at));
  }

  const stampFromHere = stamp && stamp.visit_id === id && !stamp.backfilled ? stamp : null;
  const iConfirmed = me?.status === "confirmed" && (!me.stamp_waiting || staleWaiting);

  // "+5 when N more confirm" only while the table can still make it: as in SQL, count
  // confirmed group members, and compare with the live pending members.
  const isMember = (a: AttendeeRow) => memberIds.has(a.user_id);
  const needed = Math.max(0, 3 - attendees.filter((a) => a.status === "confirmed" && isMember(a)).length);
  const live = open ? attendees.filter((a) => a.status === "pending" && isMember(a)).length : 0;

  return (
    <Page>
      <Link
        href={`/restaurant/${restaurant.id}`}
        className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink-soft"
      >
        <Flag iso2={restaurant.country_iso2} size="xs" /> {countryName}
      </Link>
      <header className="mb-5">
        <h1 className="font-display text-[2rem] leading-tight text-ink">{restaurant.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.95rem] text-ink-soft">
          <span className="font-mono text-sm">{formatDate(visit.visited_at)}</span>
          <span aria-hidden>·</span>
          <span>{groupName}</span>
          <VerificationBadge verification={visit.verification as Verification} />
        </p>
      </header>

      <VisitActions
        visitId={id}
        mode={mode}
        capFull={capFull}
        dishes={(dishes ?? []) as { id: string; name: string }[]}
        countryName={countryName}
        restaurantName={restaurant.name}
        pendingOthers={pendingOthers}
        visitedAt={visit.visited_at}
      />

      {me?.status === "pending" && !open && (
        <Card tone="sunk" className="mb-5">
          <p className="text-[0.95rem] text-ink">
            This visit is more than 7 days old, so it can&apos;t be confirmed now.
          </p>
        </Card>
      )}
      {me?.status === "declined" && (
        <Card tone="sunk" className="mb-5">
          <p className="text-[0.95rem] text-ink">You said you weren&apos;t at this one.</p>
        </Card>
      )}

      {iConfirmed && stampFromHere && (
        <section aria-labelledby="my-stamp-h" className="mb-5">
          <h2 id="my-stamp-h" className="sr-only">
            Your stamp
          </h2>
          <div className="mx-auto w-40">
            <Stamp
              iso2={restaurant.country_iso2}
              name={countryName}
              date={stampFromHere.earned_at}
              verification={stampFromHere.verification}
            />
          </div>
          <PointsBreakdown
            className="mt-2"
            points={{
              base: stampFromHere.base,
              rarity: stampFromHere.rarity_bonus,
              table: stampFromHere.table_bonus,
              dish: stampFromHere.dish_bonus,
              total:
                stampFromHere.base +
                stampFromHere.rarity_bonus +
                stampFromHere.table_bonus +
                stampFromHere.dish_bonus,
            }}
            tablePending={stampFromHere.table_bonus > 0 || live < needed ? 0 : needed}
          />
        </section>
      )}
      {iConfirmed && !stampFromHere && (
        <Card tone="sunk" className="mb-5">
          <p className="text-[0.95rem] text-ink">
            Already stamped — logged as a repeat visit, 0 points.
          </p>
        </Card>
      )}

      {anyPending && (
        <div className="mb-5">
          <NudgeButton visitId={id} restaurantName={restaurant.name} />
        </div>
      )}

      <section aria-labelledby="who-h">
        <Eyebrow id="who-h" className="mb-2">
          Who was there
        </Eyebrow>
        <ul className="flex flex-col gap-2.5">
          {attendees.map((a) => {
            const s = attendeeStatus(a, open);
            const dish = a.signature_dishes?.name ?? a.dish_other;
            return (
              <li key={a.user_id}>
                <Card className="flex items-center gap-3 p-3">
                  <Avatar name={a.profiles?.display_name ?? "Friend"} src={a.profiles?.avatar_url} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">
                      {a.profiles?.display_name ?? "Former member"}
                      {a.user_id === user.id && <span className="font-normal text-muted"> (you)</span>}
                    </p>
                    {a.status === "confirmed" && (a.rating != null || dish) && (
                      <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
                        {a.rating != null && <Stars rating={a.rating} />}
                        {dish && <span className="truncate">{dish}</span>}
                      </p>
                    )}
                  </div>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>
    </Page>
  );
}
