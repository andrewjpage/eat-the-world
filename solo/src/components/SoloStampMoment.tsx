import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Stamp } from "@/components/ui/Stamp";
import type { LogOutcome } from "@solo/domain/types";
import { stampDate } from "@solo/domain/views";
import { outcomeCopy } from "@solo/services/visits";

/**
 * The stamp moment: the country's stamp inks in (instantly under reduced motion), the phone gives a
 * short buzz where it can, and Done goes home. A repeat visit gets the stamp without the fanfare.
 */
export function SoloStampMoment({
  outcome,
  iso2,
  countryName,
  restaurantName,
  earnedOn,
  onDone,
  onView,
}: {
  outcome: LogOutcome;
  iso2: string;
  countryName: string;
  restaurantName: string;
  /** YYYY-MM-DD printed on the stamp: the day the country was first stamped. */
  earnedOn: string;
  onDone: () => void;
  /** Opens the visit that was just saved, for adding a photo or a note. */
  onView: () => void;
}) {
  const copy = outcomeCopy(outcome, countryName);
  const inked = outcome !== "repeat";
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    try {
      // Feature-detected: iOS Safari has no vibrate.
      navigator.vibrate?.(inked ? 40 : 15);
    } catch {
      // Blocked or unsupported: the stamp is enough.
    }
    // The whole screen changed: tell screen readers by moving focus to the title.
    heading.current?.focus({ preventScroll: true });
  }, [inked]);

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <section aria-labelledby="stamp-moment-h" className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="w-52">
          <Stamp iso2={iso2} name={countryName} state="stamped" date={stampDate(earnedOn)} inking={inked} />
        </div>
        <h1
          id="stamp-moment-h"
          ref={heading}
          tabIndex={-1}
          className="mt-2 font-display text-[2rem] leading-tight text-ink outline-none"
        >
          {copy.title}
        </h1>
        <p className="mt-0.5 text-[0.95rem] text-ink-soft">{restaurantName}</p>
        <p role="status" className="mt-4 rounded-2xl bg-paper-sunk px-4 py-2.5 text-[0.95rem] text-balance text-ink">
          {copy.body}
        </p>
      </section>
      <div className="mt-5 flex w-full flex-col gap-2">
        <Button size="lg" block onClick={onDone}>
          Done
        </Button>
        <Button variant="ghost" block onClick={onView}>
          View this visit
        </Button>
      </div>
    </div>
  );
}
