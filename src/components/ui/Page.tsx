import type { ReactNode } from "react";
import { cn } from "./cn";

/** Standard page column: phone width, 16px gutters. Full-bleed screens (the map) skip it. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-md px-4 pt-4 pb-6", className)}>{children}</div>;
}

/** Page heading in the display serif, with an optional kicker and right-hand action. */
export function PageHeader({
  title,
  kicker,
  action,
  children,
}: {
  title: string;
  kicker?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-5">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {kicker && (
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-stamp-red">
              {kicker}
            </p>
          )}
          <h1 className="font-display text-[2rem] leading-tight text-ink">{title}</h1>
        </div>
        {action}
      </div>
      {children && <div className="mt-2 text-[0.95rem] text-ink-soft">{children}</div>}
    </header>
  );
}
