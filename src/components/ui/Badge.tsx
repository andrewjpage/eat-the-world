import type { ComponentProps, ReactNode } from "react";
import type { Verification } from "@/lib/scoring";
import { cn } from "./cn";

export type { Verification };

export type BadgeTone = "neutral" | "red" | "teal" | "gold" | "muted";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-ink/10 text-ink",
  red: "bg-stamp-red-soft text-stamp-red",
  teal: "bg-verified-teal-soft text-verified-teal",
  gold: "bg-gold-soft text-gold",
  muted: "bg-paper-sunk text-muted",
};

export function Badge({
  tone = "neutral",
  icon,
  className,
  children,
  ...rest
}: ComponentProps<"span"> & { tone?: BadgeTone; icon?: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold",
        tones[tone],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}

/** Shown on restaurants with confidence = 'flagged' (brief section 2). */
export function ContestedBadge({ note, className }: { note?: string | null; className?: string }) {
  return (
    <Badge tone="gold" className={className} title={note ?? "This pick is up for debate"}>
      <span aria-hidden>⚖︎</span> Contested pick
    </Badge>
  );
}

const verificationCopy: Record<Verification, { label: string; tone: BadgeTone; icon: string }> = {
  geo_verified: { label: "Verified here", tone: "teal", icon: "◉" },
  photo: { label: "Photo", tone: "teal", icon: "▣" },
  self_reported: { label: "Self-reported", tone: "muted", icon: "○" },
};

/** Displayed, never scored (brief section 3). `compact` shows the icon only. */
export function VerificationBadge({
  verification,
  compact,
  className,
}: {
  verification: Verification;
  compact?: boolean;
  className?: string;
}) {
  const v = verificationCopy[verification];
  return (
    <Badge
      tone={v.tone}
      className={className}
      title={v.label}
      aria-label={compact ? v.label : undefined}
    >
      <span aria-hidden>{v.icon}</span>
      {!compact && v.label}
    </Badge>
  );
}

/** "Before the app" marker for backfilled stamps: passport memories worth 0 points. */
export function BackfilledBadge({ className }: { className?: string }) {
  return (
    <Badge tone="muted" className={className} title="Done before the app: a memory, 0 points">
      Before the app
    </Badge>
  );
}
