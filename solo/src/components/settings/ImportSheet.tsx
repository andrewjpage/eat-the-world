import { useMemo, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { applyImport } from "@solo/backup/apply";
import { summariseImport, type BackupFile } from "@solo/backup/format";
import { requestPersistence } from "@solo/db/persist";
import { useSolo } from "@solo/state/SoloContext";
import { formatDay, plural } from "./text";

function Count({ n, label }: { n: number; label: string }) {
  return (
    <li className="flex items-baseline gap-2">
      <strong className="w-8 text-right font-display text-lg text-ink">{n}</strong>{" "}
      <span>{label}</span>
    </li>
  );
}

/**
 * What a chosen backup file would do, with the two ways to bring it in. Merge adds what is not here
 * and keeps what is; Replace swaps everything for the file and asks once more first.
 */
export function ImportSheet({ backup, onClose }: { backup: BackupFile; onClose: () => void }) {
  const { data, store, reload } = useSolo();
  const { toast } = useToast();
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const [busy, setBusy] = useState<"merge" | "replace" | null>(null);
  const [failed, setFailed] = useState(false);

  const summary = useMemo(() => summariseImport(data, backup), [data, backup]);
  const nothingNew = summary.newVisits + summary.newRestaurants + summary.newBackfills === 0;

  async function run(mode: "merge" | "replace") {
    if (!store) return;
    setBusy(mode);
    setFailed(false);
    try {
      await applyImport(store, backup, mode);
      // A phone restored from a backup has not logged a visit here yet, so nothing else would ask.
      void requestPersistence();
      await reload();
      toast(mode === "merge" ? "Added what was new." : "Backup restored.", "success");
      onClose();
    } catch (error) {
      console.error("Eat the World: the backup could not be imported", error);
      setFailed(true);
      setBusy(null);
      reload().catch((reloadError) => console.error("Eat the World: storage could not be read again", reloadError));
    }
  }

  const footer = confirmingReplace ? (
    <div className="space-y-2">
      <Button block variant="danger" loading={busy === "replace"} onClick={() => run("replace")}>
        Yes, replace everything
      </Button>
      <Button block variant="ghost" disabled={busy !== null} onClick={() => setConfirmingReplace(false)}>
        Back
      </Button>
    </div>
  ) : (
    <div className="space-y-2">
      <Button block loading={busy === "merge"} disabled={nothingNew || busy !== null} onClick={() => run("merge")}>
        Merge
      </Button>
      <Button block variant="danger" disabled={busy !== null} onClick={() => setConfirmingReplace(true)}>
        Replace everything
      </Button>
    </div>
  );

  return (
    <BottomSheet
      open
      onClose={busy ? () => {} : onClose}
      title={confirmingReplace ? "Replace everything?" : "Import this backup"}
      footer={footer}
    >
      {confirmingReplace ? (
        <p className="text-[0.95rem] text-ink-soft">
          This erases the {plural(data.visits.length, "visit")} and {plural(data.backfills.length, "country", "countries")}{" "}
          from before the app that are on this phone, and puts the file&apos;s{" "}
          {plural(backup.visits.length, "visit")} and {plural(backup.backfills.length, "country", "countries")} in
          their place. Photos on this phone that the file&apos;s visits use are kept. Any other photos on this phone
          are removed. It can&apos;t be undone.
        </p>
      ) : (
        <div className="space-y-3 text-[0.95rem] text-ink-soft">
          <p>Made on {formatDay(backup.exportedAt)}. Here is what Merge would do.</p>
          <ul className="space-y-1">
            <Count n={summary.newVisits} label={summary.newVisits === 1 ? "new visit" : "new visits"} />
            <Count n={summary.newRestaurants} label={summary.newRestaurants === 1 ? "new restaurant" : "new restaurants"} />
            <Count
              n={summary.newBackfills}
              label={summary.newBackfills === 1 ? "new country from before the app" : "new countries from before the app"}
            />
            <Count n={summary.alreadyHere} label="already on this phone" />
          </ul>
          {summary.photos > 0 && <p>The file includes {plural(summary.photos, "photo")}.</p>}
          {nothingNew && <p className="font-semibold text-ink">Nothing new: everything in this file is already here.</p>}
          <p>Merge keeps what is on this phone. Replace swaps it all for the file.</p>
        </div>
      )}
      {failed && (
        <p role="alert" className="mt-3 text-sm font-semibold text-stamp-red">
          Couldn&apos;t import that backup. Nothing was changed. Try again.
        </p>
      )}
    </BottomSheet>
  );
}
