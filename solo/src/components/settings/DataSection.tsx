import { useId, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import Link from "@solo/shims/link";
import { useSolo } from "@solo/state/SoloContext";
import { Section } from "./Section";
import { plural } from "./text";

const CONFIRMATION = "DELETE";

function DeleteSheet({ onClose }: { onClose: () => void }) {
  const { store, reload } = useSolo();
  const { toast } = useToast();
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function deleteEverything() {
    if (!store) return;
    setDeleting(true);
    try {
      await store.clearAll();
      await reload();
      toast("Everything was deleted.", "success");
      onClose();
    } catch (error) {
      console.error("Eat the World: the data could not be deleted", error);
      toast("Couldn't delete everything. Try again.", "error");
      setDeleting(false);
    }
  }

  return (
    <BottomSheet
      open
      onClose={deleting ? () => {} : onClose}
      title="Delete everything?"
      footer={
        <div className="space-y-2">
          <Button
            block
            variant="danger"
            loading={deleting}
            disabled={typed !== CONFIRMATION}
            onClick={deleteEverything}
          >
            Delete everything
          </Button>
          <Button block variant="ghost" disabled={deleting} onClick={onClose}>
            Cancel
          </Button>
        </div>
      }
    >
      <p className="text-[0.95rem] text-ink-soft">
        This erases every visit, photo, restaurant and country from this phone. It can&apos;t be undone, so export a
        backup first if you might want any of it back.
      </p>
      <label htmlFor={inputId} className="mt-4 mb-1 block text-sm font-semibold text-ink">
        Type {CONFIRMATION} to confirm
      </label>
      <input
        id={inputId}
        className="input"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
      />
    </BottomSheet>
  );
}

/** The countries added before the app, and the way to start over. */
export function DataSection() {
  const { data } = useSolo();
  const [deleting, setDeleting] = useState(false);

  return (
    <Section title="Your data">
      <Link
        href="/backfill"
        className="flex min-h-11 items-center justify-between gap-3 rounded-xl text-ink active:bg-paper-sunk"
      >
        <span>
          <span className="block font-semibold">Countries from before the app</span>
          <span className="text-sm text-ink-soft">
            {data.backfills.length === 0
              ? "Add the ones you've already eaten"
              : `${plural(data.backfills.length, "country", "countries")} added. Tap to change.`}
          </span>
        </span>
        <span aria-hidden className="text-xl text-muted">
          ›
        </span>
      </Link>
      <Button block variant="danger" onClick={() => setDeleting(true)}>
        Delete everything
      </Button>
      {deleting && <DeleteSheet onClose={() => setDeleting(false)} />}
    </Section>
  );
}
