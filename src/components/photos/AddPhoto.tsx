"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, useToast } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import {
  PhotoError,
  preparePhoto,
  uploadVisitPhoto,
  type PhotoVerification,
} from "@/lib/photos";

type Phase =
  | { name: "idle" }
  | { name: "preparing" }
  | { name: "uploading" }
  | { name: "done" }
  | { name: "error"; message: string; canRetry: boolean };

/** One automatic second try on a bad connection, then the person decides. */
const AUTO_RETRY_DELAY_MS = 2000;

/**
 * "Add a photo": pick or take a picture, shrink it in the browser, upload it in the
 * background. It never blocks anything: the check-in is already saved when this shows, and
 * a failure leaves a plain retry. The original file never leaves the phone, only the
 * re-encoded JPEG without metadata.
 *
 * `onUploaded` gets the visit's verification as the server now has it ('photo' unless the
 * visit was already geo verified or downgraded).
 */
export function AddPhoto({
  visitId,
  onUploaded,
  className,
}: {
  visitId: string;
  onUploaded?: (verification: PhotoVerification) => void;
  className?: string;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const prepared = useRef<Blob | null>(null);
  const mounted = useRef(true);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      // Leaving the screen does not cancel the upload: the request carries on.
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const set = (p: Phase) => {
    if (mounted.current) setPhase(p);
  };

  async function upload(blob: Blob) {
    set({ name: "uploading" });
    let result = await uploadVisitPhoto(visitId, blob);
    if (!result.ok && result.retry) {
      await new Promise((r) => setTimeout(r, AUTO_RETRY_DELAY_MS));
      result = await uploadVisitPhoto(visitId, blob);
    }
    if (result.ok) {
      prepared.current = null;
      set({ name: "done" });
      // On another screen by now? Say so with a toast instead.
      if (!mounted.current) toast("Photo added to your visit", "success");
      // A retry whose first try did land comes back ok too (already: true): same outcome.
      if (onUploaded) onUploaded(result.verification);
      else router.refresh(); // e.g. /visit/[id]: the badge and the photo are server-rendered
    } else {
      set({ name: "error", message: result.error, canRetry: result.retry });
      if (!mounted.current) toast(result.error, "error");
    }
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    set({ name: "preparing" });
    try {
      const blob = await preparePhoto(file);
      prepared.current = blob;
      if (mounted.current) setPreview(URL.createObjectURL(blob));
      await upload(blob);
    } catch (e) {
      const message = e instanceof PhotoError ? e.message : "We couldn't read that photo.";
      set({ name: "error", message, canRetry: false });
    }
  }

  const busy = phase.name === "preparing" || phase.name === "uploading";

  return (
    <div className={cn("rounded-3xl border border-line bg-paper-raised p-4", className)}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a photo"
        data-testid="photo-input"
        onChange={(e) => {
          void onPick(e.target.files?.[0]);
          e.target.value = ""; // the same file can be picked again after an error
        }}
      />

      {phase.name === "done" ? (
        <div className="flex items-center gap-3" role="status">
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Your photo" className="size-16 shrink-0 rounded-2xl object-cover" />
          )}
          <p className="text-[0.95rem] font-semibold text-verified-teal">
            <span aria-hidden>✓</span> Photo added. Your group can see it now.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="size-16 shrink-0 rounded-2xl object-cover" />
            ) : (
              <span
                aria-hidden
                className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-paper-sunk text-3xl"
              >
                📷
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">Snap the plate</p>
              <p className="text-sm text-ink-soft">
                A photo makes the visit count as verified. Only your group sees it, and we strip
                where it was taken.
              </p>
            </div>
          </div>

          {phase.name === "error" && (
            <p role="alert" className="mt-3 rounded-2xl bg-stamp-red-soft px-4 py-2.5 text-[0.95rem] text-stamp-red">
              {phase.message}
            </p>
          )}
          {busy && (
            <p role="status" className="mt-3 text-sm text-muted">
              {phase.name === "preparing" ? "Getting your photo ready…" : "Uploading…"}
            </p>
          )}

          <div className="mt-3 flex flex-col gap-2">
            {phase.name === "error" && phase.canRetry ? (
              <Button block onClick={() => prepared.current && void upload(prepared.current)}>
                Try again
              </Button>
            ) : null}
            <Button
              block
              variant={phase.name === "error" && phase.canRetry ? "ghost" : "secondary"}
              loading={busy}
              onClick={() => input.current?.click()}
            >
              <span aria-hidden>📷</span> {phase.name === "error" ? "Choose another photo" : "Add a photo"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
