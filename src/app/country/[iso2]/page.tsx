import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/countries";
import { requireUser } from "@/components/auth/session";
import {
  Avatar,
  BackfilledBadge,
  Badge,
  Card,
  ContestedBadge,
  EmptyState,
  Eyebrow,
  Flag,
  Page,
  VerificationBadge,
} from "@/components/ui";
import type { Verification } from "@/components/ui";
import { formatDate, Stars } from "@/components/restaurant/format";

/** One query per request, shared by generateMetadata and the page. */
const loadCountry = cache(async (iso2: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("countries")
    .select("iso2, name, iso_name")
    .eq("iso2", iso2)
    .maybeSingle();
  return data;
});

export async function generateMetadata({ params }: PageProps<"/country/[iso2]">): Promise<Metadata> {
  const iso2 = (await params).iso2.toUpperCase();
  const country = /^[A-Z]{2}$/.test(iso2) ? await loadCountry(iso2) : null;
  return { title: country ? displayName(country) : "Country" };
}

type Status = "listed" | "unlisted" | "uncharted";

const statusCopy: Record<Status, { label: string; tone: "teal" | "muted" | "gold"; blurb: string }> = {
  listed: {
    label: "On the London list",
    tone: "teal",
    blurb: "London has real places to eat this. Pick one and go.",
  },
  unlisted: {
    label: "Unlisted",
    tone: "gold",
    blurb: "Nobody's checked London for this one yet. Know a specialist? Tell a curator.",
  },
  uncharted: {
    label: "Uncharted",
    tone: "muted",
    blurb:
      "Our curator looked: London has no specialist for this one. It's one of the countries London can't give you, for now.",
  },
};

interface Rating {
  rating: number;
  visits: { restaurant_id: string; restaurants: { country_iso2: string } | null } | null;
}

interface EatenBy {
  user_id: string;
  earned_at: string;
  backfilled: boolean;
  verification: Verification;
  profiles: { display_name: string; avatar_url: string | null } | null;
}

export default async function CountryPage({ params }: PageProps<"/country/[iso2]">) {
  const { iso2: raw } = await params;
  const iso2 = raw.toUpperCase();
  await requireUser(`/country/${raw}`);
  if (!/^[A-Z]{2}$/.test(iso2)) notFound();

  const supabase = await createClient();
  const country = await loadCountry(iso2);
  if (!country) notFound();

  const { data: city } = await supabase.from("cities").select("id, name").eq("slug", "london").maybeSingle();

  const [statusRes, dishRes, restRes, ratingRes, stampRes] = await Promise.all([
    city
      ? supabase
          .from("city_country_status")
          .select("status")
          .eq("city_id", city.id)
          .eq("country_iso2", iso2)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("signature_dishes")
      .select("id, name, note")
      .eq("country_iso2", iso2)
      .eq("status", "approved")
      .order("name"),
    city
      ? supabase
          .from("restaurants")
          .select("id, name, postcode, confidence, curator_note, status")
          .eq("city_id", city.id)
          .eq("country_iso2", iso2)
          .in("status", ["active", "reported_closed"])
          .order("name")
      : Promise.resolve({ data: [] }),
    supabase
      .from("visit_attendees")
      .select("rating, visits!inner(restaurant_id, restaurants!inner(country_iso2))")
      .eq("status", "confirmed")
      .not("rating", "is", null)
      .eq("visits.restaurants.country_iso2", iso2),
    supabase
      .from("stamps")
      .select("user_id, earned_at, backfilled, verification, profiles(display_name, avatar_url)")
      .eq("country_iso2", iso2)
      .order("earned_at", { ascending: false }),
  ]);

  const status = ((statusRes.data as { status: Status } | null)?.status ?? "unlisted") as Status;
  const copy = statusCopy[status];
  const dishes = dishRes.data ?? [];
  const restaurants = restRes.data ?? [];

  const byRestaurant = new Map<string, { sum: number; n: number }>();
  for (const a of (ratingRes.data ?? []) as unknown as Rating[]) {
    const rid = a.visits?.restaurant_id;
    if (!rid) continue;
    const cur = byRestaurant.get(rid) ?? { sum: 0, n: 0 };
    cur.sum += a.rating;
    cur.n += 1;
    byRestaurant.set(rid, cur);
  }
  const eaten = (stampRes.data ?? []) as unknown as EatenBy[];

  return (
    <Page>
      <header className="mb-5 flex items-center gap-4">
        <Flag iso2={iso2} size="xl" label={displayName(country)} />
        <div className="min-w-0">
          <h1 className="font-display text-[2rem] leading-tight text-ink">{displayName(country)}</h1>
          <Badge tone={copy.tone} className="mt-1">
            {copy.label}
          </Badge>
        </div>
      </header>
      <p className="mb-6 text-[0.95rem] text-ink-soft">{copy.blurb}</p>

      {dishes.length > 0 && (
        <section aria-labelledby="dishes-h" className="mb-6">
          <h2 id="dishes-h" className="mb-3 font-display text-xl text-ink">
            Signature dishes
          </h2>
          <ul className="flex flex-col gap-2">
            {dishes.map((d) => (
              <li key={d.id}>
                <Card tone="sunk" className="py-3">
                  <p className="font-semibold text-ink">{d.name}</p>
                  {d.note && <p className="text-sm text-ink-soft">{d.note}</p>}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="rest-h" className="mb-6">
        <h2 id="rest-h" className="mb-3 font-display text-xl text-ink">
          Where to eat in {city?.name ?? "London"}
        </h2>
        {restaurants.length === 0 ? (
          <Card tone="sunk">
            <EmptyState emoji="🧭" title="No restaurants yet" className="py-4">
              {status === "uncharted"
                ? "Our curator found no specialist in London. Spot one opening? Tell a curator."
                : "Nobody's checked London for this one yet. Know a specialist? Tell a curator."}
            </EmptyState>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {restaurants.map((r) => {
              const rt = byRestaurant.get(r.id);
              return (
                <li key={r.id}>
                  <Link href={`/restaurant/${r.id}`} className="block">
                    <Card className="transition active:scale-[0.99]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">{r.name}</p>
                          <p className="font-mono text-xs text-muted">{r.postcode}</p>
                        </div>
                        <span aria-hidden className="text-muted">
                          ›
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {r.confidence === "flagged" && <ContestedBadge note={r.curator_note} />}
                        {r.status === "reported_closed" && <Badge tone="red">Reported closed</Badge>}
                        {rt ? (
                          <span className="inline-flex items-center gap-1 text-sm text-ink-soft">
                            <Stars rating={rt.sum / rt.n} /> {(rt.sum / rt.n).toFixed(1)} ({rt.n})
                          </span>
                        ) : (
                          <span className="text-sm text-muted">No friend ratings yet</span>
                        )}
                      </div>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="eaten-h" className="mb-6">
        <h2 id="eaten-h" className="mb-3 font-display text-xl text-ink">
          Eaten by
        </h2>
        {eaten.length === 0 ? (
          <Card tone="sunk">
            <p className="text-[0.95rem] text-ink-soft">
              Nobody in your groups has this stamp yet. Be the first.
            </p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {eaten.map((s) => (
              <li key={s.user_id}>
                <Card className="flex items-center gap-3 py-3">
                  <Avatar name={s.profiles?.display_name ?? "Friend"} src={s.profiles?.avatar_url} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{s.profiles?.display_name ?? "Friend"}</p>
                    {!s.backfilled && (
                      <Eyebrow className="font-mono normal-case tracking-normal">{formatDate(s.earned_at)}</Eyebrow>
                    )}
                  </div>
                  {s.backfilled ? (
                    <BackfilledBadge />
                  ) : (
                    <VerificationBadge verification={s.verification} compact />
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
