import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Pin } from "@/components/map/pins";
import dynamic from "@solo/shims/dynamic";
import Link from "@solo/shims/link";

/** Leaflet touches `window` and is heavy, so the map's chunk loads only when this screen is opened. */
const SoloMap = dynamic(() => import("./SoloMap"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-paper-sunk text-sm font-semibold text-muted">
      Unrolling the map…
    </div>
  ),
});

/**
 * Full-bleed London map. The height is the viewport minus the top bar (3.5rem) and the bottom nav
 * (4rem), their 1px borders and the safe-area insets, so the page itself never scrolls and the map
 * ends exactly where the nav begins. With no pins there is nothing to frame, so it says so instead
 * of showing an empty map.
 */
export function MapView({ pins }: { pins: Pin[] }) {
  return (
    <>
      <h1 className="sr-only">London map</h1>
      {pins.length === 0 ? (
        <EmptyState
          emoji="📍"
          title="No pins yet"
          action={
            <Link href="/check-in" className={buttonClass({ block: true })}>
              Log a visit
            </Link>
          }
        >
          Restaurants with a known position are pinned here. Log a visit and your first one goes on the map.
        </EmptyState>
      ) : (
        <div className="h-[calc(100dvh-7.5rem-2px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[22rem] w-full">
          <SoloMap pins={pins} />
        </div>
      )}
    </>
  );
}
