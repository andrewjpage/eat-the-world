import { useSyncExternalStore } from "react";
import { getSnapshot, subscribe } from "@solo/pwa-install";

/** Whether the browser has offered to install the app and the offer has not been used. */
export function useInstallAvailable(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
