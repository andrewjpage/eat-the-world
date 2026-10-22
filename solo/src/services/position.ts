import type { LatLon } from "@/lib/geo";

/** How long one position request may take before the screen carries on without it. */
export const POSITION_TIMEOUT_MS = 8000;

/**
 * One position reading, asked for when a button is tapped. It rejects when the browser has no
 * location, the person says no, there is no signal, or nothing comes back within 8 seconds.
 *
 * The point goes to the caller and nowhere else: this module keeps no copy and sends nothing.
 */
export function currentPosition({ precise = false }: { precise?: boolean } = {}): Promise<LatLon> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(new Error("This browser has no location."));
      return;
    }
    // A browser's own timeout only starts once the permission prompt is answered; this one does not.
    const timer = setTimeout(() => reject(new Error("No location in time.")), POSITION_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        resolve({ lat: position.coords.latitude, lon: position.coords.longitude });
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
      { enableHighAccuracy: precise, timeout: POSITION_TIMEOUT_MS, maximumAge: 30_000 },
    );
  });
}
