import { useMemo } from "react";
import { WorldView } from "@/components/world/WorldView";
import { listedCountries } from "@solo/data/seed";
import { buildWorldData } from "@solo/domain/views";
import { useSolo } from "@solo/state/SoloContext";

/**
 * My stamps on the world map. The shared view is the group app's: it loads its own map lazily and
 * opens a country on tap. It has a "My stamps / My group" switch, which a one-person app has no use
 * for, so the switch is hidden rather than left as a button that can never be pressed.
 */
export default function World() {
  const { seed, stamps } = useSolo();
  const data = useMemo(
    () => buildWorldData({ countries: seed.countries, listed: listedCountries(seed), stamps }),
    [seed, stamps],
  );

  return (
    <>
      <h1 className="sr-only">World view</h1>
      <div className="[&_div:has(>[aria-label='Whose_stamps'])]:hidden">
        <WorldView data={data} />
      </div>
    </>
  );
}
