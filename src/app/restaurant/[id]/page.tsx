import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mapsUrl } from "@/lib/maps-url";
import { displayName } from "@/lib/countries";
import { requireUser } from "@/components/auth/session";
import {
  Avatar,
  Badge,
  ButtonLink,
  Card,
  ContestedBadge,
  EmptyState,
  Eyebrow,
  Flag,
  Page,
  VerificationBadge,
} from "@/components/ui";
import type { Verification } from "@/components/ui";
import { ReportClosed } from "@/components/restaurant/ReportClosed";
import { formatDate, Stars, UUID_RE } from "@/components/restaurant/format";

export async function generateMetadata({ params }: PageProps<"/restaurant/[id]">): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Restaurant" };
  const supabase = await createClient();
  const { data } = await supabase.from("restaurants").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Restaurant" };
}

interface Attendance {
  user_id: string;
  rating: number | null;
  note: string | null;
  dish_other: string | null;
  confirmed_at: string | null;
  profiles: { display_name: string; avatar_url: string | null } | null;
  signature_dishes: { name: string } | null;
  visits: { id: string; visited_at: string; verification: Verification } | null;
}

export default async function RestaurantPage({ params }: PageProps<"/restaurant/[id]">) {
  const { id } = await params;
  await requireUser(`/restaurant/${id}`);
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: r }, { data: att }] = await Promise.all([
    supabase
      .from("restaurants")
      .select(
        "id, name, address, postcode, google_place_id, website, status, confidence, curator_note, country_iso2, countries(iso2, name, iso_name)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("visit_attendees")
      .select(
        "user_id, rating, note, dish_other, confirmed_at, profiles(display_name, avatar_url), signature_dishes(name), visits!inner(id, visited_at, verification, restaurant_id)",
      )
      .eq("status", "confirmed")
      .eq("visits.restaurant_id", id),
  ]);
  if (!r || r.status === "pending") notFound();

  const country = r.countries as unknown as { iso2: string; name: string; iso_name: string } | null;
  const rows = ((att ?? []) as unknown as Attendance[])
    .filter((a) => a.visits)
    .sort((a, b) => b.visits!.visited_at.localeCompare(a.visits!.visited_at));
  const rated = rows.filter((a) => a.rating != null);
  const avg = rated.length ? rated.reduce((s, a) => s + a.rating!, 0) / rated.length : null;
  const closed = r.status === "closed";
  const maybeClosed = r.status === "reported_closed";

  return (
    <Page>
      {country && (
        <Link
          href={`/country/${country.iso2}`}
          className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink-soft"
        >
          <Flag iso2={country.iso2} size="xs" /> {displayName(country)}
        </Link>
      )}
      <header className="mb-4">
        <h1 className="font-display text-[2rem] leading-tight text-ink">{r.name}</h1>
        <p className="mt-1 text-[0.95rem] text-ink-soft">
          {[r.address, r.postcode].filter(Boolean).join(", ")}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {r.confidence === "flagged" && <ContestedBadge note={r.curator_note} />}
          {maybeClosed && <Badge tone="red">Reported closed</Badge>}
          {closed && <Badge tone="muted">Closed</Badge>}
          {avg != null && (
            <span className="inline-flex items-center gap-1 text-sm text-ink-soft">
              <Stars rating={avg} /> {avg.toFixed(1)} ({rated.length})
            </span>
          )}
        </div>
      </header>

      {r.curator_note && (
        <Card tone="sunk" className="mb-4">
          <Eyebrow className="mb-1">Curator&apos;s note</Eyebrow>
          <p className="text-[0.95rem] text-ink">{r.curator_note}</p>
        </Card>
      )}

      <div className="mb-6 flex flex-col gap-3">
        {closed ? (
          <>
            <p className="text-sm text-ink-soft">
              Marked closed. If it&apos;s open tonight, check in anyway and tell the curator.
            </p>
            <ButtonLink href={`/check-in/${r.id}`} variant="secondary" size="lg" block>
              Check in here
            </ButtonLink>
          </>
        ) : (
          <ButtonLink href={`/check-in/${r.id}`} size="lg" block>
            Check in here
          </ButtonLink>
        )}
        <a
          href={mapsUrl(r)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-ink/80 bg-paper-raised px-5 text-[0.95rem] font-semibold text-ink"
        >
          Open in Google Maps
        </a>
      </div>

      <section aria-labelledby="visits-h" className="mb-6">
        <h2 id="visits-h" className="mb-3 font-display text-xl text-ink">
          Friends who&apos;ve been
        </h2>
        {rows.length === 0 ? (
          <Card tone="sunk">
            <EmptyState emoji="🍽️" title="No visits yet" className="py-4">
              Be the first from your groups to eat here.
            </EmptyState>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((a) => {
              const dish = a.signature_dishes?.name ?? a.dish_other;
              return (
                <li key={`${a.visits!.id}-${a.user_id}`}>
                  <Card>
                    <div className="flex items-center gap-3">
                      <Avatar name={a.profiles?.display_name ?? "Friend"} src={a.profiles?.avatar_url} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-ink">
                          {a.profiles?.display_name ?? "Former member"}
                        </p>
                        <p className="font-mono text-xs text-muted">{formatDate(a.visits!.visited_at)}</p>
                      </div>
                      <VerificationBadge verification={a.visits!.verification} compact />
                    </div>
                    {(a.rating != null || dish) && (
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
                        {a.rating != null && <Stars rating={a.rating} />}
                        {dish && <span>Had the {dish}</span>}
                      </p>
                    )}
                    {a.note && <p className="mt-2 text-[0.95rem] text-ink">&ldquo;{a.note}&rdquo;</p>}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!closed && (
        <div className="flex justify-center">
          <ReportClosed restaurantId={r.id} name={r.name} />
        </div>
      )}
    </Page>
  );
}
