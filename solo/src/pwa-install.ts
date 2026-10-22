/**
 * Holds Chrome's offer to install the app until the person asks for it. Chrome fires
 * `beforeinstallprompt` once the app is installable, and only lets the page show its prompt once, from
 * a tap. The event can arrive before any component has mounted, so main.tsx imports this module first
 * and the listeners below are in place from the moment it loads.
 */

/** Chrome's `beforeinstallprompt` event. TypeScript's DOM types do not have it. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

/**
 * Listens on `target` (the window, in the app) and keeps the latest install offer. `subscribe` and
 * `getSnapshot` make it a store for `useSyncExternalStore`; the snapshot is whether an offer is held.
 */
export function createInstallPrompt(target: Pick<EventTarget, "addEventListener">) {
  let held: BeforeInstallPromptEvent | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  target.addEventListener("beforeinstallprompt", (event) => {
    // Without this Chrome shows its own mini-infobar as well as the app's dialog.
    event.preventDefault();
    held = event as BeforeInstallPromptEvent;
    notify();
  });
  target.addEventListener("appinstalled", () => {
    held = null;
    notify();
  });

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot: (): boolean => held !== null,

    /**
     * Shows the browser's install prompt and says what the person chose. Call it from a tap: the
     * browser refuses otherwise. An offer works once, so it is gone as soon as it has been used, and a
     * second tap while the prompt is up finds nothing to use.
     */
    async promptInstall(): Promise<InstallOutcome> {
      const event = held;
      if (!event) return "unavailable";
      try {
        // First, in the tap's own tick; the browser does not count a prompt that waits for a later one.
        const shown = event.prompt();
        held = null;
        notify();
        await shown;
        return (await event.userChoice).outcome;
      } catch (error) {
        console.error("Eat the World: the install prompt could not be shown", error);
        held = null;
        notify();
        return "unavailable";
      }
    },
  };
}

// Outside a browser (the unit tests, a build step) there is no window, and so never an offer.
const installPrompt = createInstallPrompt(typeof window === "undefined" ? new EventTarget() : window);

export const subscribe = installPrompt.subscribe;
export const getSnapshot = installPrompt.getSnapshot;
export const promptInstall = installPrompt.promptInstall;

/** Whether the page is running as an installed app rather than in a browser tab. */
export function isStandalone(): boolean {
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      if (window.matchMedia("(display-mode: standalone)").matches) return true;
    }
    // Safari's home-screen apps say so here instead.
    return typeof navigator !== "undefined" && (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}
