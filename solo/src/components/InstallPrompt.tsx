import { useEffect, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { readInstallDismissedAt, recordInstallDismissed, shouldShowInstallPrompt } from "@solo/install-snooze";
import { isStandalone, promptInstall } from "@solo/pwa-install";
import { useInstallAvailable } from "@solo/state/useInstallAvailable";

/** How long after the passport appears the dialog may open, so it does not flash over the first paint. */
const OPEN_AFTER_MS = 1500;

/** Set once the dialog has opened, so it is offered at most once per page load, whatever screens come and go. */
let offeredThisVisit = false;

/**
 * Asks, on the passport, whether to add the app to the home screen. It waits for the browser to offer
 * (Chrome decides when the app is installable), and "Not now" keeps it quiet for 14 days.
 */
export function InstallPrompt() {
  const canInstall = useInstallAvailable();
  const [mountedAt] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (offeredThisVisit) return;
    const now = Date.now();
    if (!shouldShowInstallPrompt({ canInstall, standalone: isStandalone(), dismissedAt: readInstallDismissedAt(), now })) return;

    // An offer that arrives later than that opens at once.
    const timer = window.setTimeout(() => {
      offeredThisVisit = true;
      setOpen(true);
    }, Math.max(0, mountedAt + OPEN_AFTER_MS - now));
    return () => window.clearTimeout(timer);
  }, [canInstall, mountedAt]);

  function notNow() {
    recordInstallDismissed(Date.now());
    setOpen(false);
  }

  async function install() {
    setInstalling(true);
    const outcome = await promptInstall();
    // Closing the browser's own prompt is a no too. Accepting is the end of it: nothing to remember.
    if (outcome === "dismissed") recordInstallDismissed(Date.now());
    setInstalling(false);
    setOpen(false);
  }

  return (
    <BottomSheet
      open={open}
      // The browser's prompt is up, and its answer decides what closing means.
      onClose={installing ? () => {} : notNow}
      title="Install Eat the World?"
      footer={
        <div className="space-y-2">
          <Button block loading={installing} onClick={install}>
            Install
          </Button>
          <Button block variant="secondary" disabled={installing} onClick={notNow}>
            Not now
          </Button>
        </div>
      }
    >
      <p className="text-[0.95rem] text-ink-soft">
        Add it to your home screen to open it like an app, even without a connection.
      </p>
    </BottomSheet>
  );
}
