import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "teal" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold transition " +
  "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 " +
  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ink/20";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-stamp-red text-on-stamp-red shadow-[0_2px_0_rgb(var(--shadow-ink)/0.25)] hover:brightness-110",
  secondary: "border-2 border-ink/80 bg-paper-raised text-ink hover:bg-paper-sunk",
  ghost: "text-ink hover:bg-ink/5",
  teal: "bg-verified-teal text-paper-raised hover:brightness-110",
  danger: "border-2 border-stamp-red/60 text-stamp-red hover:bg-stamp-red-soft",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3.5 text-sm",
  md: "min-h-11 px-5 text-[0.95rem]",
  lg: "min-h-13 px-6 text-base",
};

interface StyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

export function buttonClass({ variant = "primary", size = "md", block }: StyleProps = {}) {
  return cn(base, variants[variant], sizes[size], block && "w-full");
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export function Button({
  variant,
  size,
  block,
  loading,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ComponentProps<"button"> & StyleProps & { loading?: boolean }) {
  return (
    <button
      type={type}
      className={cn(buttonClass({ variant, size, block }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/** A Next.js Link styled as a button. */
export function ButtonLink({
  variant,
  size,
  block,
  className,
  children,
  ...rest
}: ComponentProps<typeof Link> & StyleProps & { children: ReactNode }) {
  return (
    <Link className={cn(buttonClass({ variant, size, block }), className)} {...rest}>
      {children}
    </Link>
  );
}
