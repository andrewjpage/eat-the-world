"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AddPhoto } from "@/components/photos/AddPhoto";
import { StampMoment } from "@/components/stamp/StampMoment";
import { Avatar, Badge, Button, Card, Flag } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import {
  DishRatingFields,
  EMPTY_DISH_RATING,
  toAttendanceInput,
  type Dish,
  type DishRatingValue,
} from "./DishRatingFields";
import {
  CHECK_IN_ATTEMPTS,
  CHECK_IN_FALLBACK,
  LAST_GROUP_KEY,
  parseStampResult,
  pickDefaultGroup,
  predictStampResult,
  predictVerification,
  retryable,
  retryDelayMs,
  type Fix,
  type StampPrediction,
  type StampResult,
} from "./logic";

export interface FlowMember {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface FlowGroup {
  id: string;
  name: string;
  /** Other members of the group (not the signed-in user). */
  members: FlowMember[];
  /** Members who RSVPed "yes" to a plan for this restaurant today (London date). */
  rsvpYes: string[];
}

export interface FlowRestaurant {
  id: string;
  name: string;
  countryIso2: string;
  countryName: string;
  /** The restaurant's postcode point (public seed data), for the predicted badge only. */
  lat: number;
  lon: number;
  /** Marked closed by the curator. A check-in is never refused at the table. */
  closed: boolean;
}

type Step = "group" | "where" | "who" | "dish";
type Loc = "idle" | "asking" | "ok" | "denied" | "failed" | "skipped";
type Save = "saving" | "saved" | "failed";

const STEP_TITLE: Record<Step, string> = {
  group: "Which group?",
  where: "Are you there now?",
  who: "Who's at the table?",
  dish: "Your order",
};

/** One attempt gets this long before it counts as lost and is retried. */
const ATTEMPT_TIMEOUT_MS = 15_000;
/** Below this accuracy (metres) a fix can't verify, so a cached coarse one is retaken once. */
const COARSE_FIX_M = 500;

function readRemembered(): string | null {
  try {
    return window.localStorage.getItem(LAST_GROUP_KEY);
  } catch {
    return null;
  }
}

function remember(groupId: string) {
  try {
    window.localStorage.setItem(LAST_GROUP_KEY, groupId);
  } catch {
    /* private mode or blocked storage: fine */
  }
}

/** A random v4 uuid, also outside a secure context (where crypto.randomUUID is missing). */
function newClientKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Attempt =
  | { kind: "ok"; result: StampResult }
  | { kind: "final"; error: string }
  | { kind: "retry" };

/** One POST /api/check-in. The body (with the position) goes nowhere else. */
async function postOnce(body: string): Promise<Attempt> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const res = await fetch("/api/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
      body,
    });
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) {
      const parsed = parseStampResult(json);
      return parsed ? { kind: "ok", result: parsed } : { kind: "retry" };
    }
    if (retryable(res.status)) return { kind: "retry" };
    const msg =
      json && typeof json === "object" && "error" in json && typeof json.error === "string"
        ? json.error
        : CHECK_IN_FALLBACK;
    return { kind: "final", error: msg };
  } catch {
    return { kind: "retry" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The check-in stepper (brief section 4 and 6.6): group, location, co-diners, dish and
 * rating, then the stamp moment. One screen per step, back always possible.
 *
 * "Get my stamp" shows the predicted stamp at once and saves in the background, retrying
 * with the same client key, so a lost reply can never make a second visit. The server's
 * StampResult then replaces the prediction.
 *
 * The position lives in a ref until it is sent in the POST body of /api/check-in. It is
 * never put in React state that is rendered, in a URL, in storage or in a log.
 */
export function CheckInFlow({
  restaurant,
  dishes,
  groups,
  prediction,
}: {
  restaurant: FlowRestaurant;
  dishes: Dish[];
  groups: FlowGroup[];
  prediction: StampPrediction;
}) {
  const router = useRouter();
  const several = groups.length > 1;
  const steps: Step[] = several ? ["group", "where", "who", "dish"] : ["where", "who", "dish"];

  const [stepIndex, setStepIndex] = useState(0);
  // The remembered group is read from localStorage after hydration (null on the server).
  const remembered = useSyncExternalStore(
    () => () => {},
    readRemembered,
    () => null,
  );
  const [chosenGroup, setChosenGroup] = useState<string | null>(null);
  const groupId =
    chosenGroup ??
    pickDefaultGroup(
      groups.map((g) => g.id),
      remembered,
    ) ??
    groups[0].id;
  const group = groups.find((g) => g.id === groupId) ?? groups[0];
  // Tags are per group: edits apply to the group they were made in, otherwise the RSVP pre-selection.
  const [edited, setEdited] = useState<{ groupId: string; ids: string[] } | null>(null);
  const tagged = edited?.groupId === group.id ? edited.ids : group.rsvpYes;
  const setTagged = (ids: string[]) => setEdited({ groupId: group.id, ids });
  const [loc, setLoc] = useState<Loc>("idle");
  const fix = useRef<Fix | null>(null);
  // Each location request gets an id; a callback for an older id (after Skip or Back) is ignored.
  const locReq = useRef(0);
  const clientKey = useRef<string | null>(null);
  const [dish, setDish] = useState<DishRatingValue>(EMPTY_DISH_RATING);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StampResult | null>(null);
  const [save, setSave] = useState<Save>("saving");
  const [taggedCount, setTaggedCount] = useState(0);
  const sending = useRef(false);

  const step = steps[stepIndex];
  const title = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(stepIndex);
  // Move focus to the new step's title so screen readers hear the screen change.
  useEffect(() => {
    if (shownStep.current === stepIndex) return;
    shownStep.current = stepIndex;
    title.current?.focus({ preventScroll: true });
  }, [stepIndex]);

  const goNext = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1));

  function cancelLocation() {
    locReq.current++;
    if (loc === "asking") setLoc("idle");
  }

  const goBack = () => {
    setError(null);
    if (step === "where") cancelLocation();
    // Opened from a shared link or the home screen there may be no history: go to the restaurant.
    if (stepIndex === 0) router.push(`/restaurant/${restaurant.id}`);
    else setStepIndex((i) => i - 1);
  };

  function chooseGroup(id: string) {
    const g = groups.find((x) => x.id === id);
    if (!g) return;
    setChosenGroup(id);
    goNext();
  }

  function askLocation() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setLoc("failed");
      return;
    }
    const id = ++locReq.current;
    let retaken = false;
    setLoc("asking");
    const ok = (pos: GeolocationPosition) => {
      if (id !== locReq.current) return;
      // A coarse cached fix (say from the nearby list) can't verify: take a fresh one once.
      if (pos.coords.accuracy > COARSE_FIX_M && !retaken) {
        retaken = true;
        navigator.geolocation.getCurrentPosition(ok, err, {
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 0,
        });
        return;
      }
      fix.current = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
      setLoc("ok");
      setStepIndex((i) => (steps[i] === "where" ? i + 1 : i));
    };
    const err = (e: GeolocationPositionError) => {
      if (id !== locReq.current) return;
      fix.current = null;
      setLoc(e.code === 1 ? "denied" : "failed");
    };
    navigator.geolocation.getCurrentPosition(ok, err, {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 60_000,
    });
  }

  function skipLocation() {
    locReq.current++;
    fix.current = null;
    setLoc("skipped");
    goNext();
  }

  async function send() {
    if (sending.current) return;
    sending.current = true;
    setSave("saving");
    clientKey.current ??= newClientKey();
    const body = JSON.stringify({
      restaurantId: restaurant.id,
      groupId: group.id,
      tagged,
      location: fix.current,
      clientKey: clientKey.current,
      ...toAttendanceInput(dish),
    });
    try {
      for (let n = 1; n <= CHECK_IN_ATTEMPTS; n++) {
        if (n > 1) await sleep(retryDelayMs(n));
        const a = await postOnce(body);
        if (a.kind === "ok") {
          fix.current = null; // the position has done its job
          remember(group.id);
          setResult(a.result);
          setSave("saved");
          // Reload or Back now lands on the saved visit, never on a form that could post again.
          window.history.replaceState(null, "", `/visit/${a.result.visit_id}`);
          return;
        }
        if (a.kind === "final") {
          // The server said no (nothing was saved): back to the form with the reason.
          setResult(null);
          setError(a.error);
          return;
        }
      }
      setSave("failed");
    } finally {
      sending.current = false;
    }
  }

  function getMyStamp() {
    if (sending.current) return;
    setError(null);
    setTaggedCount(tagged.length);
    setResult(
      predictStampResult(prediction, {
        countryIso2: restaurant.countryIso2,
        groupId: group.id,
        dishBonus: !dish.useOther && dish.dishId !== null,
        tagged: tagged.length,
        verification: predictVerification(fix.current, restaurant),
      }),
    );
    void send();
  }

  if (result) {
    const status =
      save === "saving" ? (
        <p role="status" className="mt-3 text-sm text-muted">
          Saving…
        </p>
      ) : save === "failed" ? (
        <div role="alert" className="mt-4 w-full rounded-2xl bg-stamp-red-soft px-4 py-3 text-left">
          <p className="text-[0.95rem] font-semibold text-stamp-red">Not saved yet.</p>
          <p className="text-sm text-ink">
            We couldn&apos;t reach the server. Your check-in is kept here: try again when you have
            signal.
          </p>
          <Button className="mt-3" block onClick={() => void send()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <p role="status" className="sr-only">
            Saved.
          </p>
          {/* Optional and after the save: never holds up the stamp or Done. */}
          <AddPhoto
            key={result.visit_id}
            className="mt-4 w-full text-left"
            visitId={result.visit_id}
            onUploaded={(verification) => setResult((r) => (r ? { ...r, verification } : r))}
          />
        </>
      );
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-paper">
        <div className="mx-auto w-full max-w-md px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <StampMoment
            result={result}
            countryName={restaurant.countryName}
            restaurantName={restaurant.name}
            showNudge={save === "saved" && taggedCount > 0}
            doneDisabled={save !== "saved"}
            status={status}
            names={group.members.filter((m) => tagged.includes(m.id)).map((m) => m.name)}
            onDone={() => router.push("/")}
          />
        </div>
      </div>
    );
  }

  const unverifiedNote =
    loc === "ok" ? (
      <Badge tone="teal">
        <span aria-hidden>◉</span> Location ready
      </Badge>
    ) : (
      <Badge tone="muted">
        <span aria-hidden>○</span> Unverified
      </Badge>
    );

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="mb-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-[0.95rem] font-semibold text-ink-soft active:bg-ink/5"
          >
            <span aria-hidden>‹</span> Back
          </button>
          <p className="text-xs font-semibold text-muted" aria-live="polite">
            Step {stepIndex + 1} of {steps.length}
          </p>
        </div>
        <div className="mt-1 flex gap-1.5" aria-hidden>
          {steps.map((s, i) => (
            <span
              key={s}
              className={cn("h-1.5 flex-1 rounded-full", i <= stepIndex ? "bg-stamp-red" : "bg-line")}
            />
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 text-sm text-ink-soft">
          <Flag iso2={restaurant.countryIso2} size="xs" />
          <span className="truncate font-semibold">{restaurant.name}</span>
          {step !== "group" && several && <span className="shrink-0 text-muted">· {group.name}</span>}
        </div>
        <h1
          ref={title}
          tabIndex={-1}
          className="mt-1 font-display text-[2rem] leading-tight text-ink outline-none"
        >
          {STEP_TITLE[step]}
        </h1>
      </header>

      <div className="flex-1">
        {restaurant.closed && stepIndex === 0 && (
          <Card tone="sunk" className="mb-4">
            <p className="text-[0.95rem] text-ink">
              Marked closed. If it&apos;s open tonight, check in anyway and tell the curator.
            </p>
          </Card>
        )}

        {step === "group" && (
          <ul className="flex flex-col gap-3">
            {groups.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => chooseGroup(g.id)}
                  aria-pressed={g.id === groupId}
                  className={cn(
                    "flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border-2 bg-paper-raised px-4 text-left active:scale-[0.99]",
                    g.id === groupId ? "border-stamp-red" : "border-line",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{g.name}</span>
                    <span className="block text-sm text-muted">
                      {g.members.length + 1} {g.members.length === 0 ? "member" : "members"}
                    </span>
                  </span>
                  <span aria-hidden className="text-xl text-stamp-red">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {step === "where" && (
          <div>
            <p className="text-[0.95rem] text-ink-soft">
              One tap and we check you&apos;re at {restaurant.name}. We measure the distance once and
              keep only whether you&apos;re here, never where you are.
            </p>
            {(loc === "denied" || loc === "failed") && (
              <p role="status" className="mt-4 rounded-2xl bg-paper-sunk px-4 py-3 text-[0.95rem] text-ink">
                {loc === "denied"
                  ? "Location is off for this site. No problem: you can still check in, it just won't show as verified."
                  : "We couldn't get a location signal. You can try again, or carry on unverified."}
              </p>
            )}
          </div>
        )}

        {step === "who" && (
          <div>
            <p className="mb-3 flex items-center gap-2 text-sm text-ink-soft">
              {unverifiedNote}
              <span>Tag who you&apos;re with. They each get a one-tap confirm.</span>
            </p>
            {group.members.length === 0 ? (
              <p className="rounded-2xl bg-paper-sunk px-4 py-3 text-[0.95rem] text-ink">
                You&apos;re the only one in {group.name} so far. Invite friends from the Group tab.
              </p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Members of the group">
                {group.members.map((m) => {
                  const on = tagged.includes(m.id);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => setTagged(on ? tagged.filter((x) => x !== m.id) : [...tagged, m.id])}
                        className={cn(
                          "flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 px-3 text-left transition active:scale-[0.99]",
                          on ? "border-stamp-red bg-stamp-red-soft" : "border-line bg-paper-raised",
                        )}
                      >
                        <Avatar name={m.name} src={m.avatarUrl} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-ink">{m.name}</span>
                          {group.rsvpYes.includes(m.id) && (
                            <span className="text-xs text-muted">RSVPed yes for today</span>
                          )}
                        </span>
                        <span
                          aria-hidden
                          className={cn(
                            "flex size-7 items-center justify-center rounded-full border-2 text-sm font-bold",
                            on
                              ? "border-stamp-red bg-stamp-red text-on-stamp-red"
                              : "border-line text-transparent",
                          )}
                        >
                          ✓
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {step === "dish" && (
          <DishRatingFields
            dishes={dishes}
            value={dish}
            onChange={setDish}
            countryName={restaurant.countryName}
          />
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-2xl bg-stamp-red-soft px-4 py-3 text-[0.95rem] text-stamp-red">
            {error}
          </p>
        )}
      </div>

      {step !== "group" && (
        <footer className="sticky bottom-0 -mx-4 mt-4 flex flex-col gap-2 border-t border-line bg-paper/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
          {step === "where" && (
            <>
              <Button size="lg" block loading={loc === "asking"} onClick={askLocation}>
                {loc === "denied" || loc === "failed" ? "Try again" : "Share my location"}
              </Button>
              <Button variant="ghost" block onClick={skipLocation}>
                {loc === "denied" || loc === "failed" ? "Continue unverified" : "Skip"}
              </Button>
            </>
          )}
          {step === "who" && (
            <Button size="lg" block onClick={goNext}>
              {tagged.length === 0 ? "Just me" : `Next, ${tagged.length} tagged`}
            </Button>
          )}
          {step === "dish" && (
            <Button size="lg" block onClick={getMyStamp}>
              Get my stamp
            </Button>
          )}
        </footer>
      )}
    </div>
  );
}
