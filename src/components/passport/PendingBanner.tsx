import Link from "next/link";
import { CHECK_IN_LIVE } from "@/lib/app";
import { Flag } from "@/components/ui/Flag";
import type { PendingItem } from "./data";

function title(it: PendingItem): string {
  if (it.kind === "pending") return "Were you at this dinner?";
  // Brief section 2: over the cap, "Stamp waiting: claim it tomorrow".
  return it.claimTomorrow ? "Stamp waiting: claim it tomorrow" : "Stamp waiting: claim it now";
}

const rowClass =
  "flex min-h-14 items-center gap-3 rounded-2xl border border-stamp-red/30 bg-stamp-red-soft px-3 py-2.5";

/** Pending confirmations and waiting stamps, each one tap away from /visit/[id]. */
export function PendingBanner({ items }: { items: PendingItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Needs your attention" className="mb-4 space-y-2">
      {items.map((it) => {
        const body = (
          <>
            {it.countryIso2 ? (
              <Flag iso2={it.countryIso2} size="md" />
            ) : (
              <span aria-hidden>🛂</span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-ink">{title(it)}</span>
              <span className="block truncate text-sm text-ink-soft">
                {it.restaurant}
                {!CHECK_IN_LIVE && " · opens soon"}
              </span>
            </span>
            {CHECK_IN_LIVE && (
              <span aria-hidden className="text-lg text-stamp-red">
                ›
              </span>
            )}
          </>
        );
        const key = `${it.kind}-${it.visitId}`;
        return CHECK_IN_LIVE ? (
          <Link
            key={key}
            href={`/visit/${it.visitId}`}
            prefetch={false}
            className={`${rowClass} active:scale-[0.99]`}
          >
            {body}
          </Link>
        ) : (
          <div key={key} className={rowClass}>
            {body}
          </div>
        );
      })}
    </section>
  );
}
