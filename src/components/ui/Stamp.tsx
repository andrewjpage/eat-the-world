import type { CSSProperties } from "react";
import type { Verification } from "@/lib/scoring";
import { TIMEZONE } from "@/lib/time";
import { cn } from "./cn";
import { Flag } from "./Flag";

/**
 * How a country shows in the passport (brief section 6.1):
 * - `stamped`: a visit stamp, full colour, inked and rotated
 * - `backfilled`: done before the app; a faded sepia memory, 0 points
 * - `listed`: London has a specialist but you have no stamp yet (outline)
 * - `unlisted`: nobody has checked yet (faint)
 * - `uncharted`: London can't give you this one (greyed out)
 */
export type StampState = "stamped" | "backfilled" | "listed" | "unlisted" | "uncharted";

function hash(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Stable per-country tilt, ink colour and shape, so the passport looks hand-stamped. */
export function stampStyle(iso2: string) {
  const h = hash(iso2.toUpperCase());
  const rotate = ((h % 15) - 7) * 1.2; // -8.4deg .. +8.4deg
  // No gold: a sepia/gold look is reserved for backfilled "before the app" stamps.
  const inks = ["text-stamp-red", "text-ink"] as const;
  const shapes = ["rounded-full", "rounded-[22%]", "rounded-[40%/30%]"] as const;
  return {
    rotate: `${rotate.toFixed(1)}deg`,
    ink: inks[(h >> 3) % inks.length],
    shape: shapes[(h >> 5) % shapes.length],
  };
}

const dateParts = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "numeric",
  year: "numeric",
  timeZone: TIMEZONE,
});
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "05 OCT 2026" in London time, passport style. */
export function stampDate(d: Date | string | number): string {
  const parts = Object.fromEntries(
    dateParts.formatToParts(new Date(d)).map((p) => [p.type, p.value]),
  );
  return `${parts.day} ${MONTHS[Number(parts.month) - 1]} ${parts.year}`;
}

const verificationMark: Record<Verification, { mark: string; label: string }> = {
  geo_verified: { mark: "◉", label: "Verified at the restaurant" },
  photo: { mark: "▣", label: "Photo" },
  self_reported: { mark: "○", label: "Self-reported" },
};

/**
 * A country stamp. Fills the width of its container (it is square), so a grid
 * sets its size. Pass `inking` to play the stamp-in animation (the stamp moment).
 */
export function Stamp({
  iso2,
  name,
  state = "stamped",
  date,
  verification,
  inking,
  className,
}: {
  iso2: string;
  name: string;
  state?: StampState;
  date?: Date | string | number | null;
  verification?: Verification | null;
  inking?: boolean;
  className?: string;
}) {
  const s = stampStyle(iso2);
  const inked = state === "stamped" || state === "backfilled";
  const v = verification ? verificationMark[verification] : null;
  const label = [
    name,
    state === "stamped" && "stamped",
    state === "backfilled" && "before the app",
    state === "listed" && "not stamped yet",
    state === "unlisted" && "no London restaurant listed yet",
    state === "uncharted" && "uncharted in London",
    date && inked ? stampDate(date) : null,
    v && state === "stamped" ? v.label : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      role="img"
      aria-label={label}
      className={cn("relative aspect-square w-full [container-type:inline-size]", className)}
    >
      <div
        style={{ "--stamp-rotate": inked ? s.rotate : "0deg" } as CSSProperties}
        className={cn(
          "absolute inset-[6%] flex flex-col items-center justify-center gap-[3.5cqw] p-[10cqw] text-center",
          s.shape,
          state === "stamped" && cn("stamp-ink", s.ink),
          state === "backfilled" &&
            "stamp-ink border-dotted! text-[#8a6d3b] opacity-80 sepia dark:text-[#c9a86a]",
          state === "listed" && "border-2 border-dashed border-ink/35 text-ink-soft",
          state === "unlisted" && "border border-dashed border-line text-muted opacity-55",
          state === "uncharted" && "border border-line bg-paper-sunk text-muted opacity-60",
          inking && "animate-stamp-in",
        )}
      >
        <Flag
          iso2={iso2}
          size={null}
          className={cn(
            "text-[27cqw]",
            state === "listed" && "opacity-70 grayscale-[35%]",
            (state === "unlisted" || state === "uncharted") && "opacity-60 grayscale",
            state === "backfilled" && "sepia-[45%]",
          )}
        />
        <span
          className={cn(
            "line-clamp-2 max-w-full font-sans font-bold uppercase leading-[1.05] tracking-[0.04em]",
            name.length > 12 ? "text-[8cqw]" : "text-[10cqw]",
          )}
        >
          {name}
        </span>
        {inked && date && (
          <span className="font-mono text-[7cqw] leading-none whitespace-nowrap">
            {stampDate(date)}
            {v && state === "stamped" && (
              <span aria-hidden className="ml-[2cqw]">
                {v.mark}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
