import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { useToast } from "@/components/ui/Toast";
import { PhotoError, preparePhoto } from "@/lib/photos";
import { BlobImage } from "./BlobImage";

/**
 * "Add a photo": pick or take a picture, shrink it here (the camera's location tags go with it), and
 * hand the small JPEG up. It never blocks saving: a picture that can't be read is a toast, and the
 * form carries on without it. The original file is never kept.
 */
export function PhotoField({
  value,
  onChange,
  className,
}: {
  /** The photo to show, or null for none. */
  value: Blob | null;
  onChange: (next: Blob | null) => void;
  className?: string;
}) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setPreparing(true);
    try {
      onChange(await preparePhoto(file));
    } catch (error) {
      toast(error instanceof PhotoError ? error.message : "We couldn't read that photo. You can still save.", "error");
    } finally {
      setPreparing(false);
    }
  }

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
          void pick(e.target.files?.[0]);
          e.target.value = ""; // the same file can be picked again
        }}
      />
      <div className="flex items-center gap-3">
        {value ? (
          <BlobImage blob={value} alt="Your photo" className="size-16 shrink-0 rounded-2xl object-cover" />
        ) : (
          <span aria-hidden className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-paper-sunk text-3xl">
            📷
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{value ? "Photo ready" : "Snap the plate"}</p>
          <p className="text-sm text-ink-soft">Optional. It stays on this phone.</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button block variant="secondary" loading={preparing} onClick={() => input.current?.click()}>
          <span aria-hidden>📷</span> {value ? "Change photo" : "Add a photo"}
        </Button>
        {value && (
          <Button variant="ghost" disabled={preparing} onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
