// A copy of Legend and PinCard in src/components/map/LondonMap.tsx. KEEP IN STEP with them; delete this
// and SoloMap.tsx once LondonMap takes optional props for the wording and the check-in link. Why it is a
// copy, and the other two copies: docs/solo.md, "Known copies of shared components".
// Intentional differences from LondonMap:
//  - the ring reads "You've been here", not "A friend's been" (legend) / "A friend has been" (card);
//  - the card's action is "Log a visit", linking to /check-in?restaurant=<id>, not "Check in" to /check-in/<id>;
//  - no "Reported closed" badge (solo restaurants have no status).
import { Badge, ContestedBadge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Flag } from "@/components/ui/Flag";
import { pinSvg, type Pin } from "@/components/map/pins";

/**
 * The map's two overlays. The group app's map draws its own, worded for friends ("A friend's been")
 * and linked to its check-in route, so the solo map has these. The pin artwork is the shared one.
 */

export function Legend() {
  const item = (state: "new" | "stamped", ring: boolean, label: string) => (
    <li className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="grid h-[22px] w-5 shrink-0 place-items-center [&>svg]:h-[22px] [&>svg]:w-auto [&>svg]:overflow-visible"
        dangerouslySetInnerHTML={{ __html: pinSvg(state, ring) }}
      />
      {label}
    </li>
  );
  return (
    <div
      aria-label="Legend"
      role="group"
      className="pointer-events-auto rounded-xl border border-line bg-paper-raised/95 px-2.5 py-2 text-xs font-semibold text-ink shadow-[0_1px_6px_rgb(var(--shadow-ink)/0.18)]"
    >
      <ul className="space-y-0.5">
        {item("new", false, "New country")}
        {item("stamped", false, "Stamped")}
        {item("new", true, "You've been here")}
      </ul>
    </div>
  );
}

/** `friendVisited` is the shared name for the ring; in solo it means I have eaten there. */
export function PinCard({ pin, onClose, distance }: { pin: Pin; onClose: () => void; distance: string | null }) {
  const place = [pin.address, pin.postcode].filter(Boolean).join(", ");
  return (
    <section
      aria-label={`${pin.name}, ${pin.countryName}`}
      className="pointer-events-auto animate-sheet-up rounded-2xl border border-line bg-paper-raised p-4 shadow-[0_-4px_20px_rgb(var(--shadow-ink)/0.2)]"
    >
      <div className="flex items-start gap-3">
        <Flag iso2={pin.country_iso2} size="lg" label={pin.countryName} />
        <div className="min-w-0 flex-1">
          <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-muted">
            {pin.countryName}
            {distance && <span className="normal-case tracking-normal"> · {distance} away</span>}
          </p>
          <h2 className="font-display text-xl leading-tight text-ink">{pin.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-full text-xl text-muted hover:bg-ink/5"
        >
          <span aria-hidden>×</span>
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {pin.state === "new" ? <Badge tone="red">New stamp for you</Badge> : <Badge tone="muted">Already stamped</Badge>}
        {pin.friendVisited && <Badge tone="neutral">You&apos;ve been here</Badge>}
        {pin.confidence === "flagged" && <ContestedBadge note={pin.curator_note} />}
      </div>
      {place && <p className="mt-2 text-sm text-ink-soft">{place}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <ButtonLink href={`/check-in?restaurant=${pin.id}`} prefetch={false} block>
          Log a visit
        </ButtonLink>
        <ButtonLink href={`/restaurant/${pin.id}`} prefetch={false} variant="secondary" block>
          Details
        </ButtonLink>
      </div>
    </section>
  );
}
