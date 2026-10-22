import { buttonClass } from "@/components/ui/Button";
import { mapsUrl } from "@/lib/maps-url";

/**
 * Opens the place in Google Maps in a new tab: by its place id when the seed has one, else by name
 * and address. The only thing sent is the search, when you tap it.
 */
export function MapsLink({
  place,
  look = "button",
}: {
  place: { name: string; address: string | null; googlePlaceId: string | null };
  /** `button` is a full-width secondary button; `text` is a compact link for a list row. */
  look?: "button" | "text";
}) {
  return (
    <a
      href={mapsUrl({ name: place.name, address: place.address, google_place_id: place.googlePlaceId })}
      target="_blank"
      rel="noopener noreferrer"
      className={
        look === "button"
          ? buttonClass({ variant: "secondary", block: true })
          : "inline-flex min-h-11 items-center text-sm font-semibold text-ink-soft underline decoration-line underline-offset-4"
      }
    >
      Open in Google Maps
    </a>
  );
}
