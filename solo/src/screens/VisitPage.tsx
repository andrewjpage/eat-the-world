import { useEffect, useMemo, useState } from "react";
import type { DishRatingValue } from "@/components/checkin/DishRatingFields";
import { formatDate } from "@/components/restaurant/format";
import { Badge } from "@/components/ui/Badge";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Flag } from "@/components/ui/Flag";
import { Page } from "@/components/ui/Page";
import { useToast } from "@/components/ui/Toast";
import { displayName } from "@/lib/countries";
import type { CountryOption } from "@solo/components/CountrySelect";
import { PhotoField } from "@solo/components/PhotoField";
import { PlaceDetailsSheet } from "@solo/components/PlaceDetailsSheet";
import { VisitFields } from "@solo/components/VisitFields";
import { VisitSummary } from "@solo/components/VisitSummary";
import { dishesFor } from "@solo/data/seed";
import { dishValueOf, visitFieldsOf } from "@solo/domain/draft";
import { dishLabel } from "@solo/domain/lookup";
import { deriveStamps, localToday } from "@solo/domain/stamps";
import { stampDate } from "@solo/domain/views";
import type { ScreenProps } from "@solo/router";
import { removeVisit, updateRestaurant, updateVisit, VisitError } from "@solo/services/visits";
import Link from "@solo/shims/link";
import { useRouter } from "@solo/shims/navigation";
import { useSolo } from "@solo/state/SoloContext";

/** The visit form while editing. `photo`: undefined keeps the saved one, null removes it, a Blob replaces it. */
interface EditDraft {
  visitedOn: string;
  dish: DishRatingValue;
  photo: Blob | null | undefined;
}

const messageOf = (error: unknown, fallback: string) => (error instanceof VisitError ? error.message : fallback);

/** One visit: read it, edit it, change the place's details or delete it. Stamps follow, because they are derived. */
export default function VisitPage({ params }: ScreenProps) {
  const { data, seed, stamps, store, reload } = useSolo();
  const router = useRouter();
  const { toast } = useToast();

  const visit = data.visits.find((v) => v.id === params.id);
  const restaurant = visit ? data.restaurants.find((r) => r.id === visit.restaurantId) : undefined;

  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const photoId = visit?.photoId ?? null;
  const [loaded, setLoaded] = useState<{ id: string; blob: Blob | null } | null>(null);
  useEffect(() => {
    if (!store || !photoId) return;
    let live = true;
    store
      .getPhoto(photoId)
      .then((blob) => live && setLoaded({ id: photoId, blob }))
      .catch(() => live && setLoaded({ id: photoId, blob: null }));
    return () => {
      live = false;
    };
  }, [store, photoId]);
  const saved = photoId && loaded?.id === photoId ? loaded.blob : null;

  const countries = useMemo<CountryOption[]>(
    () => seed.countries.map((c) => ({ iso2: c.iso2, name: displayName(c) })),
    [seed],
  );

  if (leaving) return null;
  if (!visit) {
    return (
      <EmptyState
        emoji="🧭"
        title="No such visit"
        action={
          <ButtonLink href="/" block>
            Back to my passport
          </ButtonLink>
        }
      >
        That visit isn&apos;t in your passport. It may have been deleted.
      </EmptyState>
    );
  }

  const iso2 = restaurant?.countryIso2 ?? null;
  const countryName = countries.find((c) => c.iso2 === iso2)?.name ?? iso2 ?? "";
  const placeName = restaurant?.name ?? "Unknown place";
  const date = formatDate(stampDate(visit.visitedOn));
  const holdsStamp = stamps.find((s) => s.countryIso2 === iso2)?.visitId === visit.id;

  /** What deleting this visit does to the country's stamp, in words. */
  function stampAfterDelete(): string | null {
    if (!holdsStamp) return null;
    const left = data.visits.filter((v) => v.id !== visit?.id);
    const next = deriveStamps(data.restaurants, left, data.backfills).find((s) => s.countryIso2 === iso2);
    if (!next) return `${countryName} will lose its stamp.`;
    if (next.kind === "backfilled") return `${countryName} goes back to a faded before-the-app memory.`;
    return `The ${countryName} stamp moves to ${formatDate(stampDate(next.earnedOn))}.`;
  }
  const stampNote = stampAfterDelete();

  async function saveEdit() {
    if (!store || !edit || !visit) return;
    setBusy(true);
    try {
      await updateVisit(store, visit.id, {
        visitedOn: edit.visitedOn,
        ...visitFieldsOf(edit.dish),
        ...(edit.photo !== undefined && { photo: edit.photo }),
      });
      await reload().catch(() => {});
      setEdit(null);
      toast("Saved", "success");
    } catch (error) {
      toast(messageOf(error, "Couldn't save the changes. Try again."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function savePlace(patch: { name: string; countryIso2: string; address: string | null }): Promise<boolean> {
    if (!store || !restaurant) return false;
    try {
      await updateRestaurant(store, restaurant.id, patch, seed);
      await reload().catch(() => {});
      toast("Place updated", "success");
      return true;
    } catch (error) {
      toast(messageOf(error, "Couldn't save the place. Try again."), "error");
      return false;
    }
  }

  async function confirmDelete() {
    if (!store || !visit) return;
    setBusy(true);
    try {
      await removeVisit(store, visit.id);
      setLeaving(true);
      await reload().catch(() => {});
      router.replace("/");
      toast("Visit deleted", "success");
    } catch {
      toast("Couldn't delete the visit. Try again.", "error");
      setBusy(false);
    }
  }

  return (
    <Page>
      {iso2 && (
        <Link href={`/country/${iso2}`} className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink-soft">
          <Flag iso2={iso2} size="xs" /> {countryName}
        </Link>
      )}
      <header className="mb-4">
        <h1 className="font-display text-[2rem] leading-tight text-ink">{placeName}</h1>
        <p className="mt-1 font-mono text-sm text-muted">{date}</p>
        {holdsStamp && (
          <Badge tone="red" className="mt-2">
            Earned your {countryName} stamp
          </Badge>
        )}
      </header>

      {edit ? (
        <>
          <VisitFields
            visitedOn={edit.visitedOn}
            onDateChange={(visitedOn) => setEdit({ ...edit, visitedOn })}
            today={localToday(new Date())}
            dish={edit.dish}
            onDishChange={(dish) => setEdit({ ...edit, dish })}
            dishes={dishesFor(seed, iso2 ?? "").map((d) => ({ id: d.id, name: d.name }))}
            countryName={countryName}
          />
          <PhotoField
            className="mt-6"
            value={edit.photo === undefined ? saved : edit.photo}
            onChange={(photo) => setEdit({ ...edit, photo })}
          />
          <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 -mx-4 mt-6 flex gap-3 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur-md">
            <Button variant="ghost" size="lg" disabled={busy} onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button size="lg" block loading={busy} disabled={!edit.visitedOn} onClick={saveEdit}>
              Save changes
            </Button>
          </div>
        </>
      ) : (
        <>
          <VisitSummary
            photo={saved}
            photoMissing={!!photoId && loaded?.id === photoId && loaded.blob === null}
            placeName={placeName}
            rating={visit.rating}
            dish={dishLabel(visit, seed.dishes)}
            note={visit.note}
          />
          <div className="flex flex-col gap-3">
            <Button
              variant="secondary"
              size="lg"
              block
              onClick={() => setEdit({ visitedOn: visit.visitedOn, dish: dishValueOf(visit), photo: undefined })}
            >
              Edit visit
            </Button>
            <Button variant="ghost" block disabled={!restaurant} onClick={() => setPlaceOpen(true)}>
              Change place details
            </Button>
            <Button variant="danger" block onClick={() => setDeleteOpen(true)}>
              Delete visit
            </Button>
          </div>
        </>
      )}

      {placeOpen && restaurant && (
        <PlaceDetailsSheet restaurant={restaurant} countries={countries} onClose={() => setPlaceOpen(false)} onSave={savePlace} />
      )}

      <BottomSheet
        open={deleteOpen}
        onClose={() => !busy && setDeleteOpen(false)}
        title="Delete this visit?"
        footer={
          <div className="flex flex-col gap-2">
            <Button variant="danger" size="lg" block loading={busy} onClick={confirmDelete}>
              Delete visit
            </Button>
            <Button variant="ghost" block disabled={busy} onClick={() => setDeleteOpen(false)}>
              Keep it
            </Button>
          </div>
        }
      >
        <p className="text-[0.95rem] text-ink">
          {placeName} on {date}, and its photo, will be removed from this phone.
        </p>
        {stampNote && <p className="mt-2 text-[0.95rem] text-ink-soft">{stampNote}</p>}
        <p className="mt-2 text-sm text-muted">This can&apos;t be undone.</p>
      </BottomSheet>
    </Page>
  );
}
