import type { ComponentProps } from "react";
import { cn } from "./cn";

/**
 * A passport page. `perforated` adds a torn-edge top; `tone="sunk"` is for
 * secondary panels inside a page.
 */
export function Card({
  className,
  perforated,
  tone = "raised",
  ...rest
}: ComponentProps<"div"> & { perforated?: boolean; tone?: "raised" | "sunk" }) {
  return (
    <div
      className={cn(
        "relative rounded-2xl border border-line p-4",
        tone === "raised"
          ? "bg-paper-raised shadow-[0_1px_0_rgb(var(--shadow-ink)/0.06)]"
          : "bg-paper-sunk",
        perforated && "perforated pt-5",
        className,
      )}
      {...rest}
    />
  );
}

/** Small uppercase label used above card content and list sections. */
export function Eyebrow({ className, ...rest }: ComponentProps<"p">) {
  return (
    <p
      className={cn("text-[0.7rem] font-bold uppercase tracking-[0.18em] text-muted", className)}
      {...rest}
    />
  );
}
