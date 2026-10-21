import { Stars } from "@/components/restaurant/format";
import { Card } from "@/components/ui/Card";
import { BlobImage } from "./BlobImage";

/** A saved visit as it reads: the photo, then the rating, what you had and the note. */
export function VisitSummary({
  photo,
  photoMissing,
  placeName,
  rating,
  dish,
  note,
}: {
  photo: Blob | null;
  /** The visit names a photo that isn't on this phone (a backup restored without photos). */
  photoMissing: boolean;
  placeName: string;
  rating: number | null;
  dish: string | null;
  note: string | null;
}) {
  return (
    <>
      {photo && (
        <BlobImage blob={photo} alt={`The meal at ${placeName}`} className="mb-4 max-h-96 w-full rounded-3xl object-cover" />
      )}
      {photoMissing && <p className="mb-4 text-sm text-muted">The photo for this visit isn&apos;t on this phone.</p>}
      <Card className="mb-6">
        <dl className="space-y-3">
          <div>
            <dt className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-muted">Rating</dt>
            <dd className="mt-0.5 text-ink">{rating === null ? <span className="text-muted">Not rated</span> : <Stars rating={rating} />}</dd>
          </div>
          {dish && (
            <div>
              <dt className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-muted">What you had</dt>
              <dd className="mt-0.5 text-ink">{dish}</dd>
            </div>
          )}
          {note && (
            <div>
              <dt className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-muted">Note</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-ink">{note}</dd>
            </div>
          )}
        </dl>
      </Card>
    </>
  );
}
