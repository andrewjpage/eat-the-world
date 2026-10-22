import { useMemo } from "react";
import { displayName } from "@/lib/countries";
import { MapView } from "@solo/components/MapView";
import { soloPins } from "@solo/domain/views";
import { useSolo } from "@solo/state/SoloContext";

/** The London suggestions and my own restaurants with a position, pinned; countries I have stamped go quiet. */
export default function MapScreen() {
  const { seed, data, stamps } = useSolo();

  const pins = useMemo(
    () =>
      soloPins({
        suggestions: seed.restaurants,
        own: data.restaurants,
        visits: data.visits,
        stamps,
        countryNames: new Map(seed.countries.map((c) => [c.iso2, displayName(c)])),
      }),
    [seed, data.restaurants, data.visits, stamps],
  );

  return <MapView pins={pins} />;
}
