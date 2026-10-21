import { useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { LatLon } from "@/lib/geo";
import { currentPosition } from "@solo/services/position";
import { CountrySelect, type CountryOption } from "./CountrySelect";

export interface NewPlaceDraft {
  name: string;
  countryIso2: string;
  address: string;
  /** The place's pin, from "I'm here". Held only until the visit is saved. */
  coords: LatLon | null;
}

/** Shown with the country picker. A hint, never a rule. */
export const SPECIALIST_HINT = "The bulk of the menu should be this country's cuisine.";

export const isPlaceReady = (draft: NewPlaceDraft) => draft.name.trim() !== "" && draft.countryIso2 !== "";

/** Name, country and address of a place that isn't on the list, with an optional "I'm here" pin. */
export function NewPlaceForm({
  countries,
  value,
  onChange,
  pin = true,
}: {
  countries: readonly CountryOption[];
  value: NewPlaceDraft;
  /** A patch, merged into the latest draft, so a slow location answer can't undo typing. */
  onChange: (patch: Partial<NewPlaceDraft>) => void;
  /** Offer "I'm here". Off when changing the details of a place that is already saved. */
  pin?: boolean;
}) {
  const uid = useId();
  const { toast } = useToast();
  const [locating, setLocating] = useState(false);

  async function imHere() {
    setLocating(true);
    try {
      onChange({ coords: await currentPosition({ precise: true }) });
    } catch {
      toast("Couldn't get your location; you can still save", "info");
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor={`${uid}-name`} className="mb-1.5 block text-sm font-bold text-ink">
          Name of the place
        </label>
        <input
          id={`${uid}-name`}
          className="input"
          maxLength={120}
          autoComplete="off"
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>

      <div>
        <p className="mb-1 text-sm font-bold text-ink">Which country&apos;s food?</p>
        <p className="mb-2.5 text-sm text-ink-soft">{SPECIALIST_HINT}</p>
        <CountrySelect countries={countries} value={value.countryIso2} onChange={(iso2) => onChange({ countryIso2: iso2 })} />
      </div>

      <div>
        <label htmlFor={`${uid}-address`} className="mb-1.5 block text-sm font-bold text-ink">
          Address <span className="font-normal text-muted">Optional</span>
        </label>
        <input
          id={`${uid}-address`}
          className="input"
          maxLength={200}
          autoComplete="off"
          value={value.address}
          onChange={(e) => onChange({ address: e.target.value })}
        />
      </div>

      {pin && (
        <div className="rounded-3xl border border-line bg-paper-raised p-4">
          <p className="font-semibold text-ink">Pin it on your map</p>
          <p className="text-sm text-ink-soft">
            Standing there now? Tap once. Your location stays on this phone and is used for this pin only.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="secondary" loading={locating} onClick={imHere}>
              <span aria-hidden>📍</span> I&apos;m here
            </Button>
            {value.coords && (
              <>
                <Badge tone="neutral">Pin set</Badge>
                <Button variant="ghost" size="sm" onClick={() => onChange({ coords: null })}>
                  Clear
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
