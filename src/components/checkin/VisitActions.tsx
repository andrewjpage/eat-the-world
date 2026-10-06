"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  claimStampAction,
  confirmAttendanceAction,
  declineAttendanceAction,
} from "@/app/visit/actions";
import { StampMoment } from "@/components/stamp/StampMoment";
import { BottomSheet, Button, Card, Eyebrow, useToast } from "@/components/ui";
import {
  DishRatingFields,
  EMPTY_DISH_RATING,
  toAttendanceInput,
  type Dish,
  type DishRatingValue,
} from "./DishRatingFields";
import type { StampResult } from "./logic";

export type VisitMode = "pending" | "waiting" | "none";

const NO_SIGNAL = "We couldn't reach the server. Check your signal and try again.";

/**
 * What the signed-in user can do on /visit/[id]: confirm (dish, rating and note above a
 * big Confirm, or "Not me") while pending, or claim a waiting stamp. The result opens as a
 * full-screen stamp moment; "Done" returns to the page, refreshed.
 */
export function VisitActions({
  visitId,
  mode,
  capFull,
  dishes,
  countryName,
  restaurantName,
  pendingOthers,
  visitedAt,
  otherNames = [],
}: {
  visitId: string;
  mode: VisitMode;
  /** Three new stamps already today (London): a claim would keep waiting. */
  capFull: boolean;
  dishes: Dish[];
  countryName: string;
  restaurantName: string;
  /** Other attendees who still have not confirmed (inside the 7-day window). */
  pendingOthers: number;
  /** The visit date: a stamp is dated by its visit (earned_at), also when claimed later. */
  visitedAt: string;
  /** The other people at the table (confirmed, or pending inside the window), for the recap. */
  otherNames?: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [sheet, setSheet] = useState(mode === "pending");
  // BottomSheet portals into document.body, so it must not render during hydration.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [dish, setDish] = useState<DishRatingValue>(EMPTY_DISH_RATING);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StampResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, start] = useTransition();

  // SQL replays a repeated confirm or claim as the stamp it made; "no_change" is left for
  // a row that has nothing to stamp, so there is no stamp moment to show.
  function show(r: StampResult) {
    if (r.outcome === "no_change") {
      toast("You're all set.", "success");
      router.refresh();
    } else setResult(r);
  }

  // A dropped connection rejects the action. Catch it here: unhandled, it would reach the
  // error boundary and lose the dish and rating typed into the sheet.
  function confirm() {
    setError(null);
    start(async () => {
      try {
        const res = await confirmAttendanceAction(visitId, toAttendanceInput(dish));
        if (res.ok) {
          setSheet(false);
          show(res.result);
        } else setError(res.error);
      } catch {
        setError(NO_SIGNAL);
      }
    });
  }

  function claim() {
    setError(null);
    start(async () => {
      try {
        const res = await claimStampAction(visitId);
        if (res.ok) show(res.result);
        else setError(res.error);
      } catch {
        setError(NO_SIGNAL);
      }
    });
  }

  function decline() {
    setError(null);
    start(async () => {
      try {
        const res = await declineAttendanceAction(visitId);
        if (res.ok) {
          setSheet(false);
          setAsking(false);
          toast("Okay, we've taken you off this visit.", "info");
          router.refresh();
        } else setError(res.error);
      } catch {
        setError(NO_SIGNAL);
      }
    });
  }

  if (result) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-paper">
        <div className="mx-auto w-full max-w-md px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <StampMoment
            result={result}
            countryName={countryName}
            restaurantName={restaurantName}
            stampedAt={visitedAt}
            showNudge={pendingOthers > 0}
            names={otherNames}
            onDone={() => {
              setResult(null);
              router.refresh();
            }}
          />
        </div>
      </div>
    );
  }

  if (mode === "none") return null;

  if (mode === "waiting") {
    return (
      <Card perforated className="mb-5">
        <Eyebrow>Stamp waiting</Eyebrow>
        <h2 className="mt-1 font-display text-2xl text-ink">Claim your stamp</h2>
        <p className="mt-1 text-[0.95rem] text-ink-soft">
          {capFull
            ? "You've already collected three new stamps today, which is the daily limit. Your visit is saved: come back tomorrow and claim it in one tap."
            : "You hit the daily limit when you checked in. You're clear to claim it now, and your points are kept."}
        </p>
        <Button className="mt-4" size="lg" block loading={busy} disabled={capFull} onClick={claim}>
          Claim stamp
        </Button>
        {error && (
          <p role="alert" className="mt-3 text-sm text-stamp-red">
            {error}
          </p>
        )}
      </Card>
    );
  }

  return (
    <>
      <Card perforated className="mb-5">
        <Eyebrow>You were tagged</Eyebrow>
        <h2 className="mt-1 font-display text-2xl text-ink">Were you at {restaurantName}?</h2>
        <p className="mt-1 text-[0.95rem] text-ink-soft">
          One tap to confirm earns your stamp and helps the table bonus.
        </p>
        <Button className="mt-4" size="lg" block onClick={() => setSheet(true)}>
          Confirm I was there
        </Button>
        {asking ? (
          <div className="mt-3 rounded-2xl bg-paper-sunk p-3 text-center">
            <p className="text-sm text-ink">Take yourself off this visit? You can&apos;t undo it.</p>
            <div className="mt-2 flex gap-2">
              <Button variant="ghost" block onClick={() => setAsking(false)}>
                Keep it
              </Button>
              <Button variant="danger" block loading={busy} onClick={decline}>
                Yes, not me
              </Button>
            </div>
          </div>
        ) : (
          <Button className="mt-1" variant="ghost" block onClick={() => setAsking(true)}>
            Not me
          </Button>
        )}
        {error && !sheet && (
          <p role="alert" className="mt-3 text-sm text-stamp-red">
            {error}
          </p>
        )}
      </Card>

      <BottomSheet
        open={sheet && hydrated}
        onClose={() => setSheet(false)}
        title="Confirm you were there"
        footer={
          <div>
            {error && (
              <p role="alert" className="mb-2 text-sm text-stamp-red">
                {error}
              </p>
            )}
            <Button size="lg" block loading={busy} onClick={confirm}>
              Confirm
            </Button>
          </div>
        }
      >
        <DishRatingFields dishes={dishes} value={dish} onChange={setDish} countryName={countryName} />
      </BottomSheet>
    </>
  );
}
