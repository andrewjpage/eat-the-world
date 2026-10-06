import { tableHint } from "@/components/checkin/logic";
import type { PointsBreakdown as Points } from "@/lib/scoring";
import { Card } from "@/components/ui";
import { cn } from "@/components/ui/cn";

function Row({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-baseline justify-between gap-3 py-1.5 text-[0.95rem]",
        muted ? "text-muted" : "text-ink",
        strong && "border-t border-line pt-2.5 font-bold",
      )}
    >
      <span>{label}</span>
      <span className={cn("font-mono tabular-nums", strong && "font-display text-2xl")}>{value}</span>
    </li>
  );
}

/**
 * Base, rarity, table, dish and total, as in a StampResult or a stamp row.
 * While the table bonus is still open it shows "+5 when N more confirm".
 */
export function PointsBreakdown({
  points,
  tablePending = 0,
  className,
}: {
  points: Points;
  tablePending?: number;
  className?: string;
}) {
  const hint = tableHint(tablePending);
  return (
    <Card className={cn("w-full text-left", className)} aria-label="Points">
      <ul>
        <Row label="New country" value={`+${points.base}`} />
        <Row label="Rarity" value={`+${points.rarity}`} muted={points.rarity === 0} />
        {points.table > 0 ? (
          <Row label="Table bonus" value={`+${points.table}`} />
        ) : (
          hint && <Row label="Table bonus" value={hint} muted />
        )}
        {points.dish > 0 && <Row label="Signature dish" value={`+${points.dish}`} />}
        <Row label="Total" value={`${points.total}`} strong />
      </ul>
    </Card>
  );
}
