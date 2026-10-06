import Link from "next/link";
import { NudgeButton } from "@/components/checkin/NudgeButton";
import { PhotoThumb } from "@/components/photos/PhotoThumb";
import { Stars } from "@/components/restaurant/format";
import { Avatar } from "@/components/ui/Avatar";
import { VerificationBadge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, Eyebrow } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Flag } from "@/components/ui/Flag";
import { stampDate } from "@/components/ui/Stamp";
import type { FeedAttendee, FeedItem } from "./data";
import { ReactionBar } from "./ReactionBar";

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

function statusMark(a: FeedAttendee): { mark: string; label: string; cls: string } {
  if (a.status === "confirmed") {
    return a.stampWaiting
      ? { mark: "⏳", label: "stamp waiting", cls: "border-gold/50 bg-gold-soft text-gold" }
      : { mark: "✓", label: "confirmed", cls: "border-verified-teal/40 bg-verified-teal-soft text-verified-teal" };
  }
  if (a.status === "declined") return { mark: "✕", label: "couldn't make it", cls: "border-line bg-paper-sunk text-muted" };
  return a.waiting
    ? { mark: "…", label: "waiting to confirm", cls: "border-stamp-red/40 bg-stamp-red-soft text-stamp-red" }
    : { mark: "–", label: "no reply", cls: "border-line bg-paper-sunk text-muted" };
}

function FeedCard({ item }: { item: FeedItem }) {
  return (
    <li>
      <Card className="p-0" data-testid="feed-item">
        <Link
          href={`/visit/${item.id}`}
          prefetch={false}
          className="flex items-start gap-3 rounded-t-2xl p-4 pb-3 active:bg-paper-sunk"
        >
          <Flag iso2={item.country.iso2} size="lg" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 font-display text-lg leading-snug text-ink">{item.restaurant.name}</p>
            <p className="text-xs text-muted">
              {item.country.name} · <span className="font-mono whitespace-nowrap">{stampDate(item.visitedAt)}</span>
            </p>
          </div>
          <VerificationBadge verification={item.verification} compact />
          {item.photoUrl && (
            <PhotoThumb
              url={item.photoUrl}
              size="sm"
              alt={`Photo from ${item.restaurant.name}`}
              className="-my-1"
            />
          )}
          <span aria-hidden className="self-center text-muted">
            ›
          </span>
        </Link>

        <div className="space-y-3 px-4 pb-3">
          <ul className="flex flex-wrap gap-1.5" aria-label="Who was there">
            {item.attendees.map((a) => {
              const s = statusMark(a);
              return (
                <li
                  key={a.userId}
                  className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-xs font-semibold ${s.cls}`}
                  title={`${a.name}: ${s.label}`}
                >
                  <Avatar name={a.name} src={a.avatarUrl} size={22} />
                  <span>{first(a.name)}</span>
                  <span aria-hidden>{s.mark}</span>
                  <span className="sr-only">{s.label}</span>
                </li>
              );
            })}
          </ul>

          {item.stamps.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Stamps earned">
              {item.stamps.map((s) => (
                <li
                  key={s.userId}
                  className="rounded-full bg-stamp-red-soft px-2.5 py-0.5 text-xs font-semibold text-stamp-red"
                >
                  {first(s.name)} stamped <span className="font-mono">+{s.points}</span>
                </li>
              ))}
            </ul>
          )}

          {(item.dishes.length > 0 || item.rating) && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
              {item.dishes.length > 0 && (
                <span>
                  <span aria-hidden>🍽️</span> {item.dishes.slice(0, 3).join(", ")}
                  {item.dishes.length > 3 && ` +${item.dishes.length - 3}`}
                </span>
              )}
              {item.rating && (
                <span className="inline-flex items-center gap-1">
                  <Stars rating={item.rating.avg} />
                  <span className="text-xs text-muted">{item.rating.avg.toFixed(1)}</span>
                </span>
              )}
            </p>
          )}

          {item.note && <p className="line-clamp-3 text-sm italic text-ink-soft">&ldquo;{item.note}&rdquo;</p>}
        </div>

        <div className="border-t border-line px-4 py-3">
          <ReactionBar visitId={item.id} initial={item.reactions} />
          {item.pendingCount > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-xs text-muted">
                {item.pendingCount} still to confirm. A nudge goes a long way.
              </p>
              <NudgeButton visitId={item.id} restaurantName={item.restaurant.name} />
            </div>
          )}
        </div>
      </Card>
    </li>
  );
}

/** Recent visits of the group, newest first, with reactions and a nudge where people are pending. */
export function ActivityFeed({ items, checkInHref }: { items: FeedItem[]; checkInHref: string }) {
  return (
    <section aria-labelledby="feed-heading" data-testid="feed">
      <Eyebrow id="feed-heading" className="mb-2 px-1">
        Activity
      </Eyebrow>
      {items.length === 0 ? (
        <Card tone="sunk">
          <EmptyState
            emoji="🍜"
            title="No dinners yet"
            action={
              <ButtonLink href={checkInHref} block>
                Check in somewhere
              </ButtonLink>
            }
          >
            The first check-in in this group will show up here, with reactions and all.
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
