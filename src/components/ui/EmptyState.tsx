import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn";

/** Friendly empty screen: a big inked stamp, a title, one line and an action. */
export function EmptyState({
  emoji = "🌍",
  title,
  children,
  action,
  className,
}: {
  emoji?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-10 text-center", className)}>
      <div
        aria-hidden
        className="stamp-ink mb-5 grid size-24 place-items-center rounded-full text-4xl text-stamp-red/70"
        style={{ "--stamp-rotate": "-8deg" } as CSSProperties}
      >
        {emoji}
      </div>
      <h2 className="font-display text-2xl text-ink">{title}</h2>
      {children && <div className="mt-2 max-w-xs text-[0.95rem] text-ink-soft">{children}</div>}
      {action && <div className="mt-6 w-full max-w-xs">{action}</div>}
    </div>
  );
}
