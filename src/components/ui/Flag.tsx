import { cn } from "./cn";

const sizes = {
  xs: "text-[0.875rem]",
  sm: "text-[1.125rem]",
  md: "text-[1.5rem]",
  lg: "text-[2.25rem]",
  xl: "text-[3.25rem]",
} as const;

export type FlagSize = keyof typeof sizes;

/**
 * SVG flag from flag-icons (its CSS is imported once in the root layout).
 * 4:3 by default; `square` uses the 1:1 artwork. Sized by font-size.
 */
export function Flag({
  iso2,
  size = "md",
  square,
  label,
  className,
}: {
  iso2: string;
  /** null: size it yourself with a text-* class. */
  size?: FlagSize | null;
  square?: boolean;
  /** Accessible name; omit when the country name is shown next to the flag. */
  label?: string;
  className?: string;
}) {
  const code = iso2.trim().toLowerCase();
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "fi shrink-0 overflow-hidden rounded-[0.15em] shadow-[0_0_0_1px_rgb(var(--shadow-ink)/0.12)]",
        `fi-${code}`,
        square && "fis",
        size && sizes[size],
        className,
      )}
    />
  );
}
