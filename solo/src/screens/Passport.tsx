import { useMemo, useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Card, Eyebrow } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { FlagGrid, parseFilter } from "@/components/passport/FlagGrid";
import { Stamp } from "@/components/ui/Stamp";
import type { PassportCountry } from "@/lib/passport";
import { BackupNudge } from "@solo/components/BackupNudge";
import { listedCountries } from "@solo/data/seed";
import { stampStrip } from "@solo/domain/strip";
import { buildPassport } from "@solo/domain/views";
import Link from "@solo/shims/link";
import { useSearchParams } from "@solo/shims/navigation";
import { useSolo } from "@solo/state/SoloContext";

/**
 * "N / 249 countries" counts visit stamps; "N / 39 London suggestions" sits under it. Countries
 * eaten before the app only count as "stamps anywhere", and lead the card until a first visit
 * stamp exists, so a freshly backfilled passport never opens on a lonely zero.
 */
function SoloPassportHeader({
  visitStamps,
  anywhereStamps,
  londonStamped,
  londonListed,
  countryTotal,
}: {
  visitStamps: number;
  anywhereStamps: number;
  londonStamped: number;
  londonListed: number;
  countryTotal: number;
}) {
  const anywhere = anywhereStamps > visitStamps && (
    <p className="text-sm text-ink-soft">
      <strong className="font-display text-lg text-ink">{anywhereStamps}</strong>{" "}
      {anywhereStamps === 1 ? "stamp" : "stamps"} anywhere
      <span className="text-muted"> (incl. before the app)</span>
    </p>
  );
  const anywhereLeads = visitStamps === 0;

  return (
    <Card perforated className="mb-4">
      <Eyebrow>Passport</Eyebrow>
      <div className="mt-1 space-y-3">
        {anywhereLeads && anywhere}
        <h1 className="font-display text-3xl leading-tight text-ink">
          <span className="text-stamp-red">{visitStamps}</span> / {countryTotal} countries
        </h1>
        <ProgressBar
          value={londonStamped}
          max={londonListed}
          label={`${londonStamped} / ${londonListed} London suggestions`}
          showCount={false}
        />
        {!anywhereLeads && anywhere}
      </div>
    </Card>
  );
}

/**
 * Every stamp, small, above the region grid. The grid ranks regions by how many London listings they
 * hold, so without this a stamp in a quiet region (a first visit to Iceland, a memory of Spain) sits
 * far below the fold. Each tile opens its country, like the grid's.
 */
function StampStrip({ shown, total }: { shown: PassportCountry[]; total: number }) {
  return (
    <section aria-label="Your stamps" className="mb-5">
      <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-line pb-1">
        <h2 className="font-display text-lg text-ink">Your stamps</h2>
        <span className="font-mono text-xs text-muted">{total}</span>
      </div>
      <ul className="grid grid-cols-4 gap-1">
        {shown.map((c) => (
          <li key={c.iso2}>
            <Link
              href={`/country/${c.iso2}`}
              prefetch={false}
              className="block rounded-xl active:scale-95 focus-visible:outline-2 focus-visible:outline-stamp-red"
            >
              {/* No date: at this size it would be too small to read, and the grid below shows it. */}
              <Stamp iso2={c.iso2} name={c.name} state={c.state} />
            </Link>
          </li>
        ))}
      </ul>
      {total > shown.length && (
        <div className="mt-1 text-right">
          <Link
            href="/?show=stamped"
            replace
            scroll={false}
            className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-stamp-red"
          >
            See all {total}
          </Link>
        </div>
      )}
    </section>
  );
}

export default function Passport() {
  const { stamps, seed } = useSolo();
  const filter = parseFilter(useSearchParams().get("show") ?? undefined);
  const [now] = useState(() => new Date());

  const summary = useMemo(
    () => buildPassport({ countries: seed.countries, listed: listedCountries(seed), stamps, now }),
    [seed, stamps, now],
  );
  // Counted from the countries the grid shows, so the headline and the grid cannot disagree.
  const visitStamps = summary.countries.filter((c) => c.state === "stamped").length;
  const strip = stampStrip(summary.countries);

  return (
    <Page>
      <SoloPassportHeader
        visitStamps={visitStamps}
        anywhereStamps={summary.anywhereStamps}
        londonStamped={summary.londonStamped}
        londonListed={summary.londonListed}
        countryTotal={summary.isoTotal}
      />
      <BackupNudge />
      {summary.anywhereStamps === 0 && (
        <Card tone="sunk" className="mb-4 text-center">
          <h2 className="font-display text-xl text-ink">Your passport is blank</h2>
          <p className="mx-auto mt-1 max-w-xs text-sm text-ink-soft">
            Eat your way round the world, one country at a time. Already been places? Add them first.
          </p>
          <div className="mt-4 space-y-2">
            <ButtonLink href="/check-in" block>
              Log your first meal
            </ButtonLink>
            <ButtonLink href="/backfill" variant="secondary" block>
              Add countries you&apos;ve already eaten
            </ButtonLink>
          </div>
        </Card>
      )}
      {/* The Stamped filter lists every stamp in the grid itself, so the strip would only repeat it. */}
      {strip.total > 0 && filter !== "stamped" && <StampStrip {...strip} />}
      <FlagGrid countries={summary.countries} filter={filter} />
    </Page>
  );
}
