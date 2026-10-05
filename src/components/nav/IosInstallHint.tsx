"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/app";
import { chromeHidden } from "./chrome";

const STORAGE_KEY = "etw:ios-install-hint-dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Private mode or blocked storage: the hint just comes back next time.
  }
}

/** iOS Safari only (not Chrome/Firefox on iOS, not already installed). */
function isIosSafariBrowser(): boolean {
  const ua = navigator.userAgent;
  const ios =
    /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua)) return false;
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  return !standalone;
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="inline size-4 align-[-2px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8" />
    </svg>
  );
}

/**
 * iOS has no install prompt, so explain "Add to Home Screen" once. Dismissal
 * is remembered in localStorage (wrapped in try/catch).
 */
export function IosInstallHint() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (isIosSafariBrowser() && !readDismissed()) setShow(true);
    }, 2500);
    return () => window.clearTimeout(t);
  }, []);

  if (!show || chromeHidden(pathname)) return null;

  const dismiss = () => {
    writeDismissed();
    setShow(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Install the app"
      className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-sm animate-toast-in rounded-2xl border border-line bg-paper-raised p-4 shadow-[0_10px_30px_rgb(var(--shadow-ink)/0.2)]"
    >
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-stamp-red text-lg text-on-stamp-red">
          ✈︎
        </div>
        <div className="flex-1 text-sm text-ink-soft">
          <p className="font-display text-base text-ink">Keep {APP_NAME} on your phone</p>
          <p className="mt-1">
            Tap <ShareIcon /> <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="-m-2 grid size-11 shrink-0 place-items-center rounded-full text-muted hover:text-ink"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
