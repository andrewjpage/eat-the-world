"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, Eyebrow } from "@/components/ui/Card";
import { Flag } from "@/components/ui/Flag";
import { cn } from "@/components/ui/cn";
import { proposeDinnerHref, pickIndex, spinDelays, spinPick, type GapCountry, type GapRestaurant } from "./spin";

type Landed = { country: GapCountry; restaurant: GapRestaurant | null };

/**
 * Spin the globe: a flag slot-machine that slows to a stop on a random gap, then suggests a
 * restaurant and offers to plan the dinner. With prefers-reduced-motion it lands straight away.
 */
export function SpinGlobe({ groupId, gaps }: { groupId: string; gaps: GapCountry[] }) {
  const [spinning, setSpinning] = useState(false);
  const [shown, setShown] = useState<GapCountry | null>(null);
  const [landed, setLanded] = useState<Landed | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /** A small buzz when the pick lands, like the stamp moment (iOS has no vibrate). */
  function land(pick: NonNullable<ReturnType<typeof spinPick>>) {
    setShown(pick.country);
    setLanded(pick);
    try {
      navigator.vibrate?.(40);
    } catch {
      /* not supported or blocked */
    }
  }

  function spin() {
    if (spinning || gaps.length === 0) return;
    const pick = spinPick(gaps, landed?.country.iso2 ?? null);
    if (!pick) return;
    setLanded(null);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || gaps.length === 1) {
      land(pick);
      return;
    }

    setSpinning(true);
    const delays = spinDelays();
    let step = 0;
    const tick = () => {
      if (step >= delays.length) {
        land(pick);
        setSpinning(false);
        return;
      }
      // Flicker through other gaps; the last tick is the winner (set above).
      setShown(gaps[pickIndex(gaps.length)]);
      timer.current = setTimeout(tick, delays[step++]);
    };
    tick();
  }

  if (gaps.length === 0) {
    return (
      <Card tone="sunk" className="text-center" data-testid="spin-empty">
        <p className="font-display text-lg text-ink">No gaps left</p>
        <p className="mt-1 text-sm text-ink-soft">
          Between you, the group has eaten every country London lists. Time to ask the curator for more.
        </p>
      </Card>
    );
  }

  return (
    <Card perforated data-testid="spin-card">
      <Eyebrow>Spin the globe</Eyebrow>
      <p className="mt-1 text-[0.95rem] text-ink-soft">
        Can&rsquo;t decide where to eat? Let the globe pick a country nobody in the group has tried.
      </p>

      <div
        className="mt-4 flex min-h-36 flex-col items-center justify-center rounded-2xl bg-paper-sunk px-3 py-5 text-center"
        aria-live="polite"
        data-testid="spin-stage"
      >
        {shown ? (
          <>
            <div className={cn("stamp-ink rounded-full p-3 text-stamp-red/80", spinning && "opacity-80")}>
              <Flag iso2={shown.iso2} size="xl" />
            </div>
            <p
              className={cn(
                "mt-3 font-display text-2xl text-ink",
                spinning && "blur-[1px]",
              )}
              data-testid="spin-country"
            >
              {shown.name}
            </p>
          </>
        ) : (
          <>
            <span aria-hidden className="text-5xl">
              🌍
            </span>
            <p className="mt-2 text-sm text-muted">{gaps.length} countries are waiting</p>
          </>
        )}
      </div>

      {landed && (
        <div className="mt-4 text-center" data-testid="spin-result">
          {landed.restaurant ? (
            <>
              <p className="text-sm text-ink-soft">Try</p>
              <Link
                href={`/restaurant/${landed.restaurant.id}`}
                prefetch={false}
                className="font-display text-xl text-ink underline decoration-stamp-red/40 underline-offset-4"
              >
                {landed.restaurant.name}
              </Link>
            </>
          ) : (
            <p className="text-sm text-ink-soft">No restaurant to suggest yet.</p>
          )}
          {landed.restaurant && (
            <ButtonLink
              href={proposeDinnerHref(groupId, landed.restaurant.id)}
              prefetch={false}
              size="lg"
              block
              className="mt-4"
            >
              Propose a dinner
            </ButtonLink>
          )}
        </div>
      )}

      <Button
        variant={landed ? "secondary" : "primary"}
        size="lg"
        block
        className="mt-3"
        onClick={spin}
        disabled={spinning}
        data-testid="spin-button"
      >
        <span aria-hidden className={cn(spinning && "inline-block animate-spin motion-reduce:animate-none")}>
          🌍
        </span>
        {spinning ? "Spinning…" : landed ? "Spin again" : "Spin the globe"}
      </Button>
    </Card>
  );
}
