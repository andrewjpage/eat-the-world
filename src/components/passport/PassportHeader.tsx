import { Card, Eyebrow } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";

/** London progress, points and stamps anywhere (brief section 2: stamps-anywhere leads while London is 0). */
export function PassportHeader({
  name,
  londonStamped,
  londonListed,
  anywhereStamps,
  points,
  isoTotal,
}: {
  name: string;
  londonStamped: number;
  londonListed: number;
  anywhereStamps: number;
  points: number;
  isoTotal: number;
}) {
  const anywhereLine = (
    <p className="text-sm text-ink-soft">
      <strong className="font-display text-lg text-ink">{anywhereStamps}</strong> stamps anywhere
      <span className="text-muted"> (incl. before the app)</span>
    </p>
  );
  const londonLead = londonStamped === 0;

  return (
    <Card perforated className="mb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>Passport</Eyebrow>
          <h1 className="truncate font-display text-xl text-ink">{name}</h1>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-3xl leading-none text-stamp-red">{points}</p>
          <p className="mt-1 text-[0.7rem] font-bold uppercase tracking-[0.18em] text-muted">
            points
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {londonLead && anywhereLine}
        <ProgressBar value={londonStamped} max={londonListed} label="in London" />
        {!londonLead && anywhereLine}
      </div>

      <p className="mt-3 text-[0.7rem] text-muted">
        {londonListed} of {isoTotal} countries have a London specialist so far.
      </p>
    </Card>
  );
}
