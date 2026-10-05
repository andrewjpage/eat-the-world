"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { NudgeButton } from "@/components/checkin/NudgeButton";
import { outcomeCopy, type StampResult } from "@/components/checkin/logic";
import { Badge, Button, Stamp, VerificationBadge } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { PointsBreakdown } from "./PointsBreakdown";

/**
 * The stamp moment: the country stamp inks in (instantly under prefers-reduced-motion),
 * a points breakdown from the StampResult, and what to do next. Used after a check-in and
 * after confirming or claiming on /visit/[id].
 *
 * `status` sits under the points (the check-in's "Saving…" line or "Not saved yet" bar).
 * `slot` is reserved for the M4 "Share recap" button.
 */
export function StampMoment({
  result,
  countryName,
  restaurantName,
  showNudge,
  onDone,
  doneLabel = "Done",
  doneDisabled = false,
  stampedAt,
  status,
  slot,
}: {
  result: StampResult;
  countryName: string;
  restaurantName: string;
  /** Someone at the table has not confirmed yet. */
  showNudge: boolean;
  onDone: () => void;
  doneLabel?: string;
  /** While the check-in is still saving, Done waits. */
  doneDisabled?: boolean;
  stampedAt?: Date | string;
  status?: ReactNode;
  slot?: ReactNode;
}) {
  const copy = outcomeCopy(result.outcome);
  const p = result.points;
  const inked = copy.inked;
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    try {
      // Feature-detected: iOS Safari has no vibrate.
      if (inked) navigator.vibrate?.([30, 50, 70]);
      else navigator.vibrate?.(15);
    } catch {
      /* not supported or blocked */
    }
  }, [inked]);

  // The whole screen changed: tell screen readers by moving focus to the title.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section aria-labelledby="stamp-moment-h" className="flex flex-col items-center text-center">
      <div className="w-44">
        <Stamp
          iso2={result.country_iso2}
          name={countryName}
          state={result.outcome === "waiting" ? "listed" : "stamped"}
          date={result.outcome === "waiting" ? null : (stampedAt ?? new Date())}
          verification={result.verification}
          inking={inked}
        />
      </div>

      <h1
        id="stamp-moment-h"
        ref={heading}
        tabIndex={-1}
        className="mt-1 font-display text-[2rem] leading-tight text-ink outline-none"
      >
        {copy.title}
      </h1>
      <p className="mt-0.5 text-[0.95rem] text-ink-soft">
        {countryName} · {restaurantName}
      </p>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <VerificationBadge verification={result.verification} />
        {result.first_in_group && inked && (
          <Badge tone="gold">
            <span aria-hidden>★</span> First in the group!
          </Badge>
        )}
      </div>

      {copy.body && (
        <p
          role="status"
          className={cn(
            "mt-3 rounded-2xl px-4 py-2.5 text-[0.95rem] text-ink",
            result.outcome === "waiting" ? "bg-gold-soft" : "bg-paper-sunk",
          )}
        >
          {copy.body}
        </p>
      )}

      {p && inked && <PointsBreakdown className="mt-4" points={p} tablePending={result.table_pending} />}

      {status}

      {slot}

      <div className="mt-5 flex w-full flex-col gap-3">
        {showNudge && <NudgeButton visitId={result.visit_id} restaurantName={restaurantName} />}
        <Button size="lg" block disabled={doneDisabled} onClick={onDone}>
          {doneLabel}
        </Button>
        {/* M4: the "Share recap" button goes here. */}
      </div>
    </section>
  );
}
