import { Card } from "@/components/ui/Card";
import { formatDate, Stars } from "@/components/restaurant/format";
import type { SoloVisit } from "@solo/domain/types";
import { stampDate } from "@solo/domain/views";
import Link from "@solo/shims/link";

/** One of my visits, opening its visit page. With a `title` (the restaurant) the date sits under it; without, the date leads. */
export function VisitRow({ visit, title, dish }: { visit: SoloVisit; title?: string; dish?: string | null }) {
  const date = formatDate(stampDate(visit.visitedOn));
  return (
    <Link href={`/visit/${visit.id}`} prefetch={false} className="block">
      <Card className="py-3 transition active:scale-[0.99]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{title ?? date}</p>
            {title && <p className="font-mono text-xs text-muted">{date}</p>}
          </div>
          <span aria-hidden className="text-muted">
            ›
          </span>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
          {visit.rating === null ? <span className="text-muted">Not rated</span> : <Stars rating={visit.rating} />}
          {dish && <span>Had the {dish}</span>}
        </p>
      </Card>
    </Link>
  );
}
