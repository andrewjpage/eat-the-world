import { Card, Eyebrow } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";

/** "Together" header (brief 6.7): listed countries stamped by anyone in the group, out of London's total. */
export function Together({ stamped, listed }: { stamped: number; listed: number }) {
  const left = Math.max(0, listed - stamped);
  const line =
    listed === 0
      ? "London hasn't listed any countries yet."
      : left === 0
        ? "The whole of London's menu, eaten. Legends."
        : stamped === 0
          ? "Nothing eaten yet. The first stamp is the best one."
          : `${left} to go. Whoever eats a new country, it counts for the whole table.`;

  return (
    <section aria-labelledby="together-heading" data-testid="together">
      <Card perforated>
        <Eyebrow id="together-heading">Together</Eyebrow>
        <p className="mt-1 mb-4 text-[0.95rem] text-ink-soft">{line}</p>
        <ProgressBar value={stamped} max={listed} label="Countries eaten in London" />
      </Card>
    </section>
  );
}
