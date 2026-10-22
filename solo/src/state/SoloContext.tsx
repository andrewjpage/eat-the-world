import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { seed } from "@solo/data/seed";
import { DEFAULT_SETTINGS, type SoloData } from "@solo/db/schema";
import { openSoloStore, type SoloStore } from "@solo/db/store";
import { deriveStamps } from "@solo/domain/stamps";
import type { SeedData, SoloStamp } from "@solo/domain/types";

export interface SoloContextValue {
  /** `unavailable`: the browser would not open the database (private window, blocked storage). */
  status: "loading" | "ready" | "unavailable";
  data: SoloData;
  /** Derived from `data` on every change; never stored. */
  stamps: SoloStamp[];
  seed: SeedData;
  /** Null until the database is open. */
  store: SoloStore | null;
  /** Re-reads storage. Rejects if storage cannot be read, so a caller that just wrote can say so. */
  reload(): Promise<void>;
}

const EMPTY_DATA: SoloData = { restaurants: [], visits: [], backfills: [], settings: DEFAULT_SETTINGS };

const SoloContext = createContext<SoloContextValue | null>(null);

/**
 * Opens the on-device database once and keeps what is in it. A second window (the installed app
 * beside a Chrome tab) can write to the same database, so storage is read again whenever this
 * window becomes visible or gains focus.
 */
export function SoloProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SoloContextValue["status"]>("loading");
  const [data, setData] = useState<SoloData>(EMPTY_DATA);
  const [store, setStore] = useState<SoloStore | null>(null);
  // Kept in a ref so a double-run effect (React strict mode) still opens the database once.
  const opening = useRef<Promise<SoloStore> | null>(null);
  const latestLoad = useRef(0);

  useEffect(() => {
    let live = true;
    opening.current ??= openSoloStore();
    opening.current
      .then(async (opened) => {
        const loaded = await opened.load();
        if (!live) return;
        setStore(opened);
        setData(loaded);
        setStatus("ready");
      })
      .catch((error) => {
        if (!live) return;
        // The screen only says storage is unavailable; the console says why (a blocked window, a bad row).
        console.error("Eat the World: storage could not be opened or read", error);
        setStatus("unavailable");
      });
    return () => {
      live = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!store) return;
    const mine = ++latestLoad.current;
    const loaded = await store.load();
    // Overlapping reads can finish out of order; only the latest one may replace what is shown.
    if (mine === latestLoad.current) setData(loaded);
  }, [store]);

  useEffect(() => {
    if (!store) return;
    const refresh = () => {
      if (document.visibilityState === "visible") reload().catch(() => {});
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [store, reload]);

  const stamps = useMemo(
    () => deriveStamps(data.restaurants, data.visits, data.backfills),
    [data.restaurants, data.visits, data.backfills],
  );

  const value = useMemo(
    () => ({ status, data, stamps, seed, store, reload }),
    [status, data, stamps, store, reload],
  );

  return <SoloContext.Provider value={value}>{children}</SoloContext.Provider>;
}

export function useSolo(): SoloContextValue {
  const value = useContext(SoloContext);
  if (!value) throw new Error("useSolo must be used inside <SoloProvider>");
  return value;
}
