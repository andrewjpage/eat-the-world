import { cn } from "./cn";

/** An inked progress bar, e.g. "34 / 86 in London". */
export function ProgressBar({
  value,
  max,
  label,
  tone = "red",
  showCount = true,
  className,
}: {
  value: number;
  max: number;
  label?: string;
  tone?: "red" | "teal" | "ink";
  showCount?: boolean;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const fill = { red: "bg-stamp-red", teal: "bg-verified-teal", ink: "bg-ink" }[tone];
  return (
    <div className={cn("w-full", className)}>
      {(label || showCount) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
          {label && <span className="font-medium text-ink-soft">{label}</span>}
          {showCount && (
            <span className="font-mono text-ink">
              <strong className="font-display text-lg">{value}</strong>
              <span className="text-muted"> / {max}</span>
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
        className="h-3 w-full overflow-hidden rounded-full border border-line bg-paper-sunk"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-700 ease-out", fill)}
          style={{
            width: `${pct}%`,
            backgroundImage:
              "repeating-linear-gradient(-45deg, transparent 0 6px, rgb(255 255 255 / 0.18) 6px 12px)",
          }}
        />
      </div>
    </div>
  );
}
