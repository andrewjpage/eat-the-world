const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
});

export function formatDate(ts: string): string {
  return dateFmt.format(new Date(ts));
}

/** Read-only star rating, e.g. 4 -> four filled stars out of five. */
export function Stars({ rating, className }: { rating: number; className?: string }) {
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className={className} role="img" aria-label={`${rating.toFixed(1)} out of 5`}>
      <span aria-hidden className="text-gold">
        {"★".repeat(n)}
      </span>
      <span aria-hidden className="text-line">
        {"★".repeat(5 - n)}
      </span>
    </span>
  );
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
