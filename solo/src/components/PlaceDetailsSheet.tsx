import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import type { SoloRestaurant } from "@solo/domain/types";
import type { CountryOption } from "./CountrySelect";
import { isPlaceReady, NewPlaceForm, type NewPlaceDraft } from "./NewPlaceForm";

/**
 * Rename a saved place, move it to another country (its stamp moves with it) or fix its address.
 * Mount it when it should open; it starts from the place as it is now.
 */
export function PlaceDetailsSheet({
  restaurant,
  countries,
  onClose,
  onSave,
}: {
  restaurant: SoloRestaurant;
  countries: readonly CountryOption[];
  onClose: () => void;
  /** Resolves true when saved, after telling the person what went wrong if not. */
  onSave: (patch: { name: string; countryIso2: string; address: string | null }) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<NewPlaceDraft>({
    name: restaurant.name,
    countryIso2: restaurant.countryIso2,
    address: restaurant.address ?? "",
    coords: null,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const saved = await onSave({
      name: draft.name,
      countryIso2: draft.countryIso2,
      address: draft.address.trim() || null,
    });
    setSaving(false);
    if (saved) onClose();
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title="Change place details"
      footer={
        <Button size="lg" block loading={saving} disabled={!isPlaceReady(draft)} onClick={save}>
          Save place
        </Button>
      }
    >
      <NewPlaceForm
        countries={countries}
        value={draft}
        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        pin={false}
      />
    </BottomSheet>
  );
}
