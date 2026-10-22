const DAY_MS = 24 * 60 * 60 * 1000;

/** How long "Not now" keeps the install dialog away. */
export const INSTALL_SNOOZE_DAYS = 14;

/** Where the time of the last "Not now" is kept: epoch milliseconds, as text. */
export const INSTALL_DISMISSED_KEY = "eat-the-world-solo:install-dismissed-at";

/**
 * The same time, kept for the life of the page. `localStorage` throws in a private window or when site
 * data is blocked, and a "Not now" that could not be stored must still hold for the rest of the visit.
 */
let dismissedInMemory: number | null = null;

/**
 * Whether to offer to install: the browser has an install on offer, the app is not already running as
 * an installed app, and "Not now" was not said in the last 14 days. A time in the future (the clock
 * has been set back since) says nothing about how long ago it was, so it does not hold the dialog off.
 */
export function shouldShowInstallPrompt({
  canInstall,
  standalone,
  dismissedAt,
  now,
}: {
  canInstall: boolean;
  standalone: boolean;
  dismissedAt: number | null;
  now: number;
}): boolean {
  if (!canInstall || standalone) return false;
  if (dismissedAt === null) return true;
  const since = now - dismissedAt;
  return since < 0 || since >= INSTALL_SNOOZE_DAYS * DAY_MS;
}

/** A stored time, or null for anything that is not one (nothing else writes the key, but a hand edit happens). */
function parseTime(raw: string | null): number | null {
  if (raw === null) return null;
  const at = Number(raw.trim());
  return Number.isFinite(at) && at > 0 ? at : null;
}

/** When "Not now" was last said, or null: from storage, and from this visit if storage would not take it. */
export function readInstallDismissedAt(): number | null {
  let stored: number | null = null;
  try {
    stored = parseTime(localStorage.getItem(INSTALL_DISMISSED_KEY));
  } catch {
    // Blocked, or no storage at all: this visit's own answer, if any, stands in.
  }
  if (stored === null) return dismissedInMemory;
  return dismissedInMemory === null ? stored : Math.max(stored, dismissedInMemory);
}

/** Remembers "Not now" at `now`. Never throws: a failed write leaves the answer in memory for this visit. */
export function recordInstallDismissed(now: number): void {
  dismissedInMemory = now;
  try {
    localStorage.setItem(INSTALL_DISMISSED_KEY, String(now));
  } catch {
    // The in-memory time above is all there is.
  }
}
