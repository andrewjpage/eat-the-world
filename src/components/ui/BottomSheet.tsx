"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A modal sheet that slides up from the bottom (thumb reach on a phone).
 * Closes on Escape, on the backdrop and on the grab handle; Tab stays inside. Keep the primary
 * action at the bottom of `children` and `footer` for one-handed use.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      // Keep Tab inside the sheet (it is modal).
      if (e.key !== "Tab" || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
      );
      if (focusable.length === 0) {
        e.preventDefault();
        panel.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && panel.current.contains(active);
      if (e.shiftKey && (active === first || active === panel.current || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-ink/40 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative mx-auto flex max-h-[88dvh] w-full max-w-md animate-sheet-up flex-col",
          "rounded-t-3xl border border-b-0 border-line bg-paper-raised outline-none",
          "shadow-[0_-8px_30px_rgb(var(--shadow-ink)/0.18)]",
          className,
        )}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="mx-auto mt-2.5 h-1.5 w-12 shrink-0 rounded-full bg-line"
        />
        <h2 id={titleId} className="px-5 pt-3 font-display text-xl text-ink">
          {title}
        </h2>
        <div className="overflow-y-auto px-5 pt-3 pb-4">{children}</div>
        {footer && (
          <div className="border-t border-line px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
        {!footer && <div className="pb-[env(safe-area-inset-bottom)]" />}
      </div>
    </div>,
    document.body,
  );
}
