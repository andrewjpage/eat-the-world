import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const KEY = "eat-the-world-solo:install-dismissed-at";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

/** The snooze module as a freshly opened page sees it: nothing remembered in memory. */
async function freshSnooze() {
  vi.resetModules();
  return import("@solo/install-snooze");
}

/** The install module as a freshly opened page sees it. */
async function freshInstall() {
  vi.resetModules();
  return import("@solo/pwa-install");
}

/** A working `localStorage`, with the values it holds exposed for the test to read and seed. */
function workingStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, String(value)),
    removeItem: (key: string) => void values.delete(key),
  };
}

/** What Chrome gives a page that has blocked site data: every use of `localStorage` throws. */
function stubBlockedStorage() {
  const blocked = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
}

describe("shouldShowInstallPrompt", () => {
  const base = { canInstall: true, standalone: false, dismissedAt: null as number | null, now: NOW };

  it("keeps the snooze at two weeks", async () => {
    const { INSTALL_SNOOZE_DAYS } = await freshSnooze();
    expect(INSTALL_SNOOZE_DAYS).toBe(14);
  });

  it("shows when an install is on offer, the app is in a browser tab, and nobody has said no", async () => {
    const { shouldShowInstallPrompt } = await freshSnooze();
    expect(shouldShowInstallPrompt(base)).toBe(true);
  });

  it("stays quiet when the browser has not offered an install", async () => {
    const { shouldShowInstallPrompt } = await freshSnooze();
    expect(shouldShowInstallPrompt({ ...base, canInstall: false })).toBe(false);
  });

  it("stays quiet when the app is already running installed", async () => {
    const { shouldShowInstallPrompt } = await freshSnooze();
    expect(shouldShowInstallPrompt({ ...base, standalone: true })).toBe(false);
  });

  it("stays quiet for 14 days after Not now, and asks again on the 14th", async () => {
    const { shouldShowInstallPrompt } = await freshSnooze();
    expect(shouldShowInstallPrompt({ ...base, dismissedAt: NOW })).toBe(false);
    expect(shouldShowInstallPrompt({ ...base, dismissedAt: NOW - 13 * DAY_MS })).toBe(false);
    expect(shouldShowInstallPrompt({ ...base, dismissedAt: NOW - 14 * DAY_MS + 1 })).toBe(false);
    expect(shouldShowInstallPrompt({ ...base, dismissedAt: NOW - 14 * DAY_MS })).toBe(true);
    expect(shouldShowInstallPrompt({ ...base, dismissedAt: NOW - 20 * DAY_MS })).toBe(true);
  });

  it("is not held off for good by a clock that was once set ahead", async () => {
    const { shouldShowInstallPrompt } = await freshSnooze();
    expect(shouldShowInstallPrompt({ ...base, dismissedAt: NOW + 400 * DAY_MS })).toBe(true);
  });

  it("needs every condition at once", async () => {
    const { shouldShowInstallPrompt } = await freshSnooze();
    expect(shouldShowInstallPrompt({ canInstall: false, standalone: true, dismissedAt: NOW, now: NOW })).toBe(false);
    expect(shouldShowInstallPrompt({ canInstall: true, standalone: true, dismissedAt: NOW - 30 * DAY_MS, now: NOW })).toBe(false);
    expect(shouldShowInstallPrompt({ canInstall: false, standalone: false, dismissedAt: NOW - 30 * DAY_MS, now: NOW })).toBe(false);
  });
});

describe("the remembered Not now", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", workingStorage());
  });

  it("uses the key the browser tests set", async () => {
    const { INSTALL_DISMISSED_KEY } = await freshSnooze();
    expect(INSTALL_DISMISSED_KEY).toBe(KEY);
  });

  it("is empty until someone says Not now", async () => {
    const { readInstallDismissedAt } = await freshSnooze();
    expect(readInstallDismissedAt()).toBeNull();
  });

  it("is written as epoch milliseconds, and is still there in the next session", async () => {
    const storage = workingStorage();
    vi.stubGlobal("localStorage", storage);
    const first = await freshSnooze();
    first.recordInstallDismissed(NOW);
    expect(storage.values.get(KEY)).toBe(String(NOW));
    expect(first.readInstallDismissedAt()).toBe(NOW);

    // A new page load has an empty memory but the same storage.
    const second = await freshSnooze();
    expect(second.readInstallDismissedAt()).toBe(NOW);
  });

  it("reads what another visit stored", async () => {
    vi.stubGlobal("localStorage", workingStorage({ [KEY]: String(NOW - 15 * DAY_MS) }));
    const { readInstallDismissedAt } = await freshSnooze();
    expect(readInstallDismissedAt()).toBe(NOW - 15 * DAY_MS);
  });

  it("ignores a stored value that is not a time", async () => {
    for (const corrupt of ["banana", "", "   ", "NaN", "Infinity", "-5", "0", "{}", "null", "12px"]) {
      vi.stubGlobal("localStorage", workingStorage({ [KEY]: corrupt }));
      const { readInstallDismissedAt } = await freshSnooze();
      expect(readInstallDismissedAt(), JSON.stringify(corrupt)).toBeNull();
    }
  });

  it("writes over a corrupt value", async () => {
    const storage = workingStorage({ [KEY]: "banana" });
    vi.stubGlobal("localStorage", storage);
    const { readInstallDismissedAt, recordInstallDismissed } = await freshSnooze();
    recordInstallDismissed(NOW);
    expect(storage.values.get(KEY)).toBe(String(NOW));
    expect(readInstallDismissedAt()).toBe(NOW);
  });
});

describe("the remembered Not now when the browser will not store it", () => {
  it("never throws when localStorage throws on every use, and still remembers for the session", async () => {
    stubBlockedStorage();
    const { readInstallDismissedAt, recordInstallDismissed } = await freshSnooze();

    expect(readInstallDismissedAt()).toBeNull();
    expect(() => recordInstallDismissed(NOW)).not.toThrow();
    expect(readInstallDismissedAt()).toBe(NOW);
  });

  it("never throws when merely touching localStorage throws", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    try {
      const { readInstallDismissedAt, recordInstallDismissed } = await freshSnooze();
      expect(readInstallDismissedAt()).toBeNull();
      expect(() => recordInstallDismissed(NOW)).not.toThrow();
      expect(readInstallDismissedAt()).toBe(NOW);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it("never throws when there is no localStorage at all", async () => {
    // Node 20 has none, so this is the plain environment.
    const { readInstallDismissedAt, recordInstallDismissed } = await freshSnooze();
    expect(readInstallDismissedAt()).toBeNull();
    expect(() => recordInstallDismissed(NOW)).not.toThrow();
    expect(readInstallDismissedAt()).toBe(NOW);
  });

  it("prefers the session's own Not now to an older stored one when writing fails", async () => {
    const stale = workingStorage({ [KEY]: String(NOW - 20 * DAY_MS) });
    vi.stubGlobal("localStorage", {
      ...stale,
      setItem: () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      },
    });
    const { readInstallDismissedAt, recordInstallDismissed } = await freshSnooze();

    expect(readInstallDismissedAt()).toBe(NOW - 20 * DAY_MS);
    expect(() => recordInstallDismissed(NOW)).not.toThrow();
    expect(readInstallDismissedAt()).toBe(NOW);
  });
});

/** A `beforeinstallprompt` the way Chrome hands it over: cancelable, with `prompt()` and `userChoice`. */
function installEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn(async () => {});
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  return { event, prompt };
}

describe("the install store", () => {
  it("has nothing to offer until the browser fires beforeinstallprompt", async () => {
    const { createInstallPrompt } = await freshInstall();
    const store = createInstallPrompt(new EventTarget());
    expect(store.getSnapshot()).toBe(false);
    expect(await store.promptInstall()).toBe("unavailable");
  });

  it("holds the event, and keeps Chrome's own mini-infobar away", async () => {
    const { createInstallPrompt } = await freshInstall();
    const target = new EventTarget();
    const store = createInstallPrompt(target);
    const { event, prompt } = installEvent();

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(store.getSnapshot()).toBe(true);
    // Holding it is not showing it: the browser's prompt is for the user's tap.
    expect(prompt).not.toHaveBeenCalled();
  });

  it("tells subscribers when an install becomes available, and not after they unsubscribe", async () => {
    const { createInstallPrompt } = await freshInstall();
    const target = new EventTarget();
    const store = createInstallPrompt(target);
    const heard = vi.fn();
    const unsubscribe = store.subscribe(heard);

    target.dispatchEvent(installEvent().event);
    expect(heard).toHaveBeenCalledTimes(1);

    unsubscribe();
    target.dispatchEvent(installEvent().event);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("shows the browser's prompt exactly once and returns what the user chose", async () => {
    const { createInstallPrompt } = await freshInstall();
    const target = new EventTarget();
    const store = createInstallPrompt(target);
    const { event, prompt } = installEvent("accepted");
    target.dispatchEvent(event);

    expect(await store.promptInstall()).toBe("accepted");
    expect(prompt).toHaveBeenCalledTimes(1);

    // A deferred event can be used only once, so it is gone.
    expect(store.getSnapshot()).toBe(false);
    expect(await store.promptInstall()).toBe("unavailable");
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("returns dismissed when the user closes the browser's prompt", async () => {
    const { createInstallPrompt } = await freshInstall();
    const target = new EventTarget();
    const store = createInstallPrompt(target);
    const { event } = installEvent("dismissed");
    target.dispatchEvent(event);

    expect(await store.promptInstall()).toBe("dismissed");
    expect(store.getSnapshot()).toBe(false);
  });

  it("starts the browser's prompt in the same tick as the tap (a user gesture is needed)", async () => {
    const { createInstallPrompt } = await freshInstall();
    const target = new EventTarget();
    const store = createInstallPrompt(target);
    const { event, prompt } = installEvent();
    target.dispatchEvent(event);

    const pending = store.promptInstall();
    expect(prompt).toHaveBeenCalledTimes(1);
    await pending;
  });

  it("does not show the prompt twice when the button is tapped twice", async () => {
    const { createInstallPrompt } = await freshInstall();
    const target = new EventTarget();
    const store = createInstallPrompt(target);
    const { event, prompt } = installEvent();
    target.dispatchEvent(event);

    const results = await Promise.all([store.promptInstall(), store.promptInstall()]);

    expect(results.sort()).toEqual(["accepted", "unavailable"]);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("answers unavailable, and does not throw, when the browser refuses to show the prompt", async () => {
    const { createInstallPrompt } = await freshInstall();
    const target = new EventTarget();
    const store = createInstallPrompt(target);
    const { event, prompt } = installEvent();
    prompt.mockRejectedValue(new DOMException("Not allowed without a user gesture.", "InvalidStateError"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    target.dispatchEvent(event);

    expect(await store.promptInstall()).toBe("unavailable");
    expect(store.getSnapshot()).toBe(false);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("clears the held event when the app is installed", async () => {
    const { createInstallPrompt } = await freshInstall();
    const target = new EventTarget();
    const store = createInstallPrompt(target);
    const heard = vi.fn();
    store.subscribe(heard);
    target.dispatchEvent(installEvent().event);
    expect(store.getSnapshot()).toBe(true);

    target.dispatchEvent(new Event("appinstalled"));

    expect(store.getSnapshot()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(await store.promptInstall()).toBe("unavailable");
  });

  it("uses the newest event when the browser fires another before the first was used", async () => {
    const { createInstallPrompt } = await freshInstall();
    const target = new EventTarget();
    const store = createInstallPrompt(target);
    const first = installEvent();
    const second = installEvent();
    target.dispatchEvent(first.event);
    target.dispatchEvent(second.event);

    await store.promptInstall();

    expect(first.prompt).not.toHaveBeenCalled();
    expect(second.prompt).toHaveBeenCalledTimes(1);
  });
});

describe("loading pwa-install", () => {
  it("starts listening on window as soon as it loads, before anything renders", async () => {
    const fakeWindow = new EventTarget();
    vi.stubGlobal("window", fakeWindow);
    const install = await freshInstall();
    expect(install.getSnapshot()).toBe(false);

    const { event, prompt } = installEvent("accepted");
    fakeWindow.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(install.getSnapshot()).toBe(true);
    expect(await install.promptInstall()).toBe("accepted");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(install.getSnapshot()).toBe(false);
  });

  it("loads without a window (the unit tests, a build step) and offers nothing", async () => {
    const install = await freshInstall();
    expect(install.getSnapshot()).toBe(false);
    expect(await install.promptInstall()).toBe("unavailable");
    expect(() => install.subscribe(() => {})()).not.toThrow();
  });
});

describe("isStandalone", () => {
  /** A window stand-in: an event target (the module listens on it as it loads) that answers media queries. */
  const media = (matches: boolean) =>
    Object.assign(new EventTarget(), { matchMedia: vi.fn((query: string) => ({ media: query, matches })) });

  it("is true when the page is displayed as an installed app", async () => {
    const window = media(true);
    vi.stubGlobal("window", window);
    const { isStandalone } = await freshInstall();
    expect(isStandalone()).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith("(display-mode: standalone)");
  });

  it("is false in a browser tab", async () => {
    vi.stubGlobal("window", media(false));
    vi.stubGlobal("navigator", {});
    const { isStandalone } = await freshInstall();
    expect(isStandalone()).toBe(false);
  });

  it("is true on a home-screen app that only sets navigator.standalone (Safari)", async () => {
    vi.stubGlobal("window", media(false));
    vi.stubGlobal("navigator", { standalone: true });
    const { isStandalone } = await freshInstall();
    expect(isStandalone()).toBe(true);
  });

  it("is false when navigator.standalone is false", async () => {
    vi.stubGlobal("window", media(false));
    vi.stubGlobal("navigator", { standalone: false });
    const { isStandalone } = await freshInstall();
    expect(isStandalone()).toBe(false);
  });

  it("works where matchMedia is missing", async () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("navigator", {});
    const { isStandalone } = await freshInstall();
    expect(isStandalone()).toBe(false);

    vi.stubGlobal("navigator", { standalone: true });
    expect(isStandalone()).toBe(true);
  });

  it("is false when matchMedia throws", async () => {
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        matchMedia: () => {
          throw new Error("nope");
        },
      }),
    );
    vi.stubGlobal("navigator", {});
    const { isStandalone } = await freshInstall();
    expect(isStandalone()).toBe(false);
  });

  it("is false with no window at all", async () => {
    const { isStandalone } = await freshInstall();
    expect(isStandalone()).toBe(false);
  });
});
