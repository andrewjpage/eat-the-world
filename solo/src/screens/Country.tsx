import { Badge, BackfilledBadge, ContestedBadge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Flag } from "@/components/ui/Flag";
import { Page } from "@/components/ui/Page";
import { displayName } from "@/lib/countries";
import { formatDate } from "@/components/restaurant/format";
import type { ScreenProps } from "@solo/router";
import { dishesFor, listedCountries } from "@solo/data/seed";
import { dishLabel, visitsIn } from "@solo/domain/lookup";
import { stampDate } from "@solo/domain/views";
import { MapsLink } from "@solo/components/MapsLink";
import { VisitRow } from "@solo/components/VisitRow";
import Link from "@solo/shims/link";
import { useSolo } from "@solo/state/SoloContext";

function SectionTitle({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="mb-3 font-display text-xl text-ink">
      {children}
    </h2>
  );
}

export default function Country({ params }: ScreenProps) {
  const { seed, data, stamps } = useSolo();
  const iso2 = params.iso2;
  const country = seed.countries.find((c) => c.iso2 === iso2);

  if (!country) {
    return (
      <EmptyState
        emoji="🧭"
        title="No such country"
        action={
          <ButtonLink href="/" block>
            Back to my passport
          </ButtonLink>
        }
      >
        There&apos;s no country with the code {iso2}.
      </EmptyState>
    );
  }

  const name = displayName(country);
  const stamp = stamps.find((s) => s.countryIso2 === iso2);
  const listed = listedCountries(seed).has(iso2);
  const dishes = dishesFor(seed, iso2);
  const suggestions = seed.restaurants
    .filter((r) => r.countryIso2 === iso2)
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  const mine = visitsIn(iso2, data.restaurants, data.visits);

  // A suggestion I have copied is "been" once any visit is logged against my copy.
  const beenTo = new Set(
    data.restaurants.filter((r) => r.seedId && data.visits.some((v) => v.restaurantId === r.id)).map((r) => r.seedId),
  );

  return (
    <Page>
      <header className="mb-4 flex items-center gap-4">
        <Flag iso2={iso2} size="xl" label={name} />
        <div className="min-w-0">
          <h1 className="font-display text-[2rem] leading-tight text-ink">{name}</h1>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {stamp?.kind === "visit" ? (
              <Badge tone="red">Stamped {formatDate(stampDate(stamp.earnedOn))}</Badge>
            ) : stamp ? (
              <BackfilledBadge />
            ) : (
              <Badge tone="muted">Not stamped yet</Badge>
            )}
            {listed ? <Badge tone="teal">On the London list</Badge> : <Badge tone="muted">Not on the London list</Badge>}
          </div>
        </div>
      </header>
      <p className="mb-4 text-[0.95rem] text-ink-soft">
        {listed
          ? "London has real places to eat this. Pick one and go."
          : "The London list has no pick for this one yet. Found a place yourself? Log it and the stamp is yours."}
      </p>
      <ButtonLink href={`/check-in?country=${iso2}`} prefetch={false} size="lg" block className="mb-6">
        Log a visit here
      </ButtonLink>

      {dishes.length > 0 && (
        <section aria-labelledby="dishes-h" className="mb-6">
          <SectionTitle id="dishes-h">Signature dishes</SectionTitle>
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
        <SectionTitle id="rest-h">Where to eat in London</SectionTitle>
        {suggestions.length === 0 ? (
          <Card tone="sunk">
            <EmptyState emoji="🧭" title="No London picks yet" className="py-4">
              Nothing on the list for {name}. Spotted somewhere? Log it with the button above.
            </EmptyState>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {suggestions.map((r) => (
              <li key={r.id}>
                <Card>
                  <Link
                    href={`/restaurant/${r.id}`}
                    prefetch={false}
                    className="flex min-h-11 items-start justify-between gap-3"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{r.name}</span>
                      <span className="block font-mono text-xs text-muted">{r.postcode}</span>
                    </span>
                    <span aria-hidden className="text-muted">
                      ›
                    </span>
                  </Link>
                  {(r.confidence === "flagged" || beenTo.has(r.id)) && (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {r.confidence === "flagged" && <ContestedBadge note={r.curatorNote} />}
                      {beenTo.has(r.id) && <Badge tone="neutral">You&apos;ve been here</Badge>}
                    </div>
                  )}
                  {r.confidence === "flagged" && r.curatorNote && (
                    <p className="mt-2 text-sm text-ink-soft">{r.curatorNote}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4">
                    <ButtonLink href={`/check-in?restaurant=${r.id}`} prefetch={false}>
                      Log a visit
                    </ButtonLink>
                    <MapsLink place={r} look="text" />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="visits-h" className="mb-2">
        <SectionTitle id="visits-h">Your visits</SectionTitle>
        {mine.length === 0 ? (
          <Card tone="sunk">
            <EmptyState emoji="🍽️" title="No visits here yet" className="py-4">
              Log one and it goes in your passport.
            </EmptyState>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {mine.map(({ visit, restaurant }) => (
              <li key={visit.id}>
                <VisitRow visit={visit} title={restaurant.name} dish={dishLabel(visit, seed.dishes)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
