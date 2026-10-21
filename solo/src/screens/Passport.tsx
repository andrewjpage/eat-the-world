import { useMemo, useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Card, Eyebrow } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { FlagGrid, parseFilter } from "@/components/passport/FlagGrid";
import { listedCountries } from "@solo/data/seed";
import { buildPassport } from "@solo/domain/views";
import { useSearchParams } from "@solo/shims/navigation";
import { useSolo } from "@solo/state/SoloContext";

/**
 * "N / 249 countries" counts visit stamps; "N / 39 London suggestions" sits under it. Countries
 * eaten before the app only count as "stamps anywhere", and lead the card until a first visit
 * stamp exists, so a freshly backfilled passport never opens on a lonely zero.
 */
function PassportHeader({
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

  return (
    <Page>
      <PassportHeader
        visitStamps={visitStamps}
        anywhereStamps={summary.anywhereStamps}
        londonStamped={summary.londonStamped}
        londonListed={summary.londonListed}
        countryTotal={summary.isoTotal}
      />
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
      <FlagGrid countries={summary.countries} filter={filter} />
    </Page>
  );
}
