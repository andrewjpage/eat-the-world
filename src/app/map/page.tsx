import type { Metadata } from "next";
import { requireUser } from "@/components/auth/session";
import { loadMapData } from "@/components/map/data";
import { MapLoader } from "@/components/map/MapLoader";

export const metadata: Metadata = { title: "Map" };

/**
 * Full-bleed London map. The height is the viewport minus the top bar (3.5rem + 1px border) and
 * the bottom nav (4rem), both with their safe-area insets, so the page itself never scrolls.
 */
export default async function MapPage() {
  const user = await requireUser("/map");
  const pins = await loadMapData(user.id);
  return (
    <div className="h-[calc(100dvh-7.5rem-1px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[22rem] w-full">
      <h1 className="sr-only">London map</h1>
      <MapLoader pins={pins} />
    </div>
  );
}
