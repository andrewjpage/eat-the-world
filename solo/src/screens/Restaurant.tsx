import { Badge, ContestedBadge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, Eyebrow } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Flag } from "@/components/ui/Flag";
import { Page } from "@/components/ui/Page";
import { displayName } from "@/lib/countries";
import { Stars } from "@/components/restaurant/format";
import type { ScreenProps } from "@solo/router";
import { dishLabel, resolvePlace, visitsAt } from "@solo/domain/lookup";
import { MapsLink } from "@solo/components/MapsLink";
import { VisitRow } from "@solo/components/VisitRow";
import Link from "@solo/shims/link";
import { useSolo } from "@solo/state/SoloContext";

export default function Restaurant({ params }: ScreenProps) {
  const { seed, data } = useSolo();
  const id = params.id;
  const place = resolvePlace(id, seed, data.restaurants);

  if (!place) {
    return (
      <EmptyState
        emoji="🧭"
        title="No such restaurant"
        action={
          <ButtonLink href="/" block>
            Back to my passport
          </ButtonLink>
        }
      >
        This restaurant isn&apos;t on the London list or in your passport.
      </EmptyState>
    );
  }

  const country = seed.countries.find((c) => c.iso2 === place.countryIso2);
  const visits = place.own ? visitsAt(place.own.id, data.visits) : [];
  const ratings = visits.flatMap((v) => (v.rating === null ? [] : [v.rating]));
  const average = ratings.length > 0 ? ratings.reduce((sum, n) => sum + n, 0) / ratings.length : null;

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
        <h1 className="font-display text-[2rem] leading-tight text-ink">{place.name}</h1>
        <p className="mt-1 text-[0.95rem] text-ink-soft">{[place.address, place.postcode].filter(Boolean).join(", ")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {place.confidence === "flagged" && <ContestedBadge note={place.curatorNote} />}
          {visits.length > 0 && <Badge tone="neutral">You&apos;ve been here</Badge>}
          {average !== null && (
            <span className="inline-flex items-center gap-1 text-sm text-ink-soft">
              <Stars rating={average} /> {average.toFixed(1)} ({ratings.length})
            </span>
          )}
        </div>
      </header>

      {place.curatorNote && (
        <Card tone="sunk" className="mb-4">
          <Eyebrow className="mb-1">Curator&apos;s note</Eyebrow>
          <p className="text-[0.95rem] text-ink">{place.curatorNote}</p>
        </Card>
      )}

      <div className="mb-6 flex flex-col gap-3">
        <ButtonLink href={`/check-in?restaurant=${id}`} prefetch={false} size="lg" block>
          Log a visit
        </ButtonLink>
        <MapsLink place={place} />
      </div>

      <section aria-labelledby="visits-h" className="mb-2">
        <h2 id="visits-h" className="mb-3 font-display text-xl text-ink">
          Your visits
        </h2>
        {visits.length === 0 ? (
          <Card tone="sunk">
            <EmptyState emoji="🍽️" title="No visits yet" className="py-4">
              You haven&apos;t eaten here yet.
            </EmptyState>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {visits.map((visit) => (
              <li key={visit.id}>
                <VisitRow visit={visit} dish={dishLabel(visit, seed.dishes)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
