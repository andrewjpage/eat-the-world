"use client";

import { useSyncExternalStore } from "react";
import { buttonClass, type ButtonVariant } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { nudgeUrl } from "./logic";

/**
 * "Nudge the table": a wa.me link with a message and an absolute link to /visit/[id].
 * The base is NEXT_PUBLIC_APP_URL, else the current origin (known only after mount).
 */
export function NudgeButton({
  visitId,
  restaurantName,
  variant = "secondary",
  block = true,
  className,
}: {
  visitId: string;
  restaurantName: string;
  variant?: ButtonVariant;
  block?: boolean;
  className?: string;
}) {
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const base = process.env.NEXT_PUBLIC_APP_URL || origin;

  return (
    <a
      href={nudgeUrl({ visitId, restaurantName, baseUrl: base })}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonClass({ variant, size: "lg", block }), className)}
    >
      <span aria-hidden>💬</span> Nudge the table
    </a>
  );
}
