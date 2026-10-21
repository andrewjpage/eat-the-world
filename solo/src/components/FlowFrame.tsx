import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * The check-in's full-screen layout (the shell shows no top bar or bottom nav here): Back, a step
 * bar, the title, the step, and a footer that stays in thumb reach.
 */
export function FlowFrame({
  step,
  steps,
  title,
  onBack,
  summary,
  footer,
  children,
}: {
  /** 0-based. */
  step: number;
  steps: number;
  title: string;
  onBack: () => void;
  /** A line above the title, such as the chosen place. */
  summary?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(title);
  // A new step: start at the top (the list may have been scrolled), and move focus to its title so a
  // screen reader announces the change.
  useEffect(() => {
    if (shown.current === title) return;
    shown.current = title;
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [title]);

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="mb-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-[0.95rem] font-semibold text-ink-soft active:bg-ink/5"
          >
            <span aria-hidden>‹</span> Back
          </button>
          <p className="text-xs font-semibold text-muted">
            Step {step + 1} of {steps}
          </p>
        </div>
        <div className="mt-1 flex gap-1.5" aria-hidden>
          {Array.from({ length: steps }, (_, i) => (
            <span key={i} className={cn("h-1.5 flex-1 rounded-full", i <= step ? "bg-stamp-red" : "bg-line")} />
          ))}
        </div>
        {summary && <div className="mt-4 flex items-center gap-2 text-sm text-ink-soft">{summary}</div>}
        <h1
          ref={heading}
          tabIndex={-1}
          className={cn("font-display text-[2rem] leading-tight text-ink outline-none", summary ? "mt-1" : "mt-4")}
        >
          {title}
        </h1>
      </header>
      <div className="flex-1 pb-6">{children}</div>
      {footer && (
        <footer className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-line bg-paper/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
          {footer}
        </footer>
      )}
    </div>
  );
}
