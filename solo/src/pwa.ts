/**
 * Starts the service worker that lets the app open with no connection (see `offlineApp` in
 * vite.config.ts). Only the production build has one: in development the worker would serve stale
 * files, and the build is where the worker is generated.
 *
 * The address is relative, so the worker is found under GitHub Pages' /eat-the-world/ as well as at a
 * root. A failure to register is logged and nothing more: the app works fine without a worker, it just
 * needs a connection to open.
 */
export async function registerOfflineSupport(): Promise<void> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  const report = (error: unknown) => console.error("Eat the World: offline support did not start", error);
  try {
    const { registerSW } = await import("virtual:pwa-register");
    registerSW({
      onRegisterError: report,
      // A new version has taken over the open page, and the old page's own files may no longer be
      // cached, so it has to reload. Doing that at once would throw away a note or photo that is
      // half-entered; the next move to another screen is a point where nothing is in progress.
      onNeedReload: () => window.addEventListener("hashchange", () => window.location.reload(), { once: true }),
    });
  } catch (error) {
    report(error);
  }
}
