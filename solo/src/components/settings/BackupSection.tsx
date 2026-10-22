import { useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { buildBackup } from "@solo/backup/build";
import { backupFileName, parseBackup, type BackupFile } from "@solo/backup/format";
import { shareOrDownload } from "@solo/backup/share";
import { useSolo } from "@solo/state/SoloContext";
import { ImportSheet } from "./ImportSheet";
import { Section } from "./Section";
import { formatDay, plural } from "./text";

/** Export a backup file, or pick one to bring back. Nothing leaves the phone except what is shared on purpose. */
export function BackupSection() {
  const { data, store, reload } = useSolo();
  const { toast } = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const [includePhotos, setIncludePhotos] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<BackupFile | null>(null);

  const photoCount = data.visits.filter((v) => v.photoId).length;
  const lastExportAt = data.settings.lastExportAt;

  async function exportBackup() {
    if (!store) return;
    setExporting(true);
    try {
      const now = new Date();
      // Read just now, so a visit saved in another window a moment ago is in the file.
      const backup = await buildBackup(await store.load(), store, includePhotos, now);
      const outcome = await shareOrDownload(backupFileName(now), JSON.stringify(backup));
      if (outcome === "cancelled") return;
      // The snapshot's own time, so a visit saved while the share sheet was open still counts as new.
      await store.setSettings({ lastExportAt: backup.exportedAt });
      await reload();
      toast(outcome === "shared" ? "Backup shared." : "Backup saved to your downloads.", "success");
    } catch (error) {
      console.error("Eat the World: the backup could not be made", error);
      toast("Couldn't make the backup. Try again.", "error");
    } finally {
      setExporting(false);
    }
  }

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // the same file can be picked again after a problem
    if (!file) return;

    setProblem(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setProblem("Couldn't read that file. Try picking it again.");
      return;
    }
    const result = parseBackup(text);
    if (result.ok) setChosen(result.backup);
    else setProblem(result.message);
  }

  return (
    <Section title="Backup">
      <p>
        Your passport lives only on this phone. A backup file is the one way to get it back if the phone is lost or
        wiped, or to move it to a new one.
      </p>
      <p className="text-sm" data-testid="last-backup">
        {lastExportAt ? `Last backup: ${formatDay(lastExportAt)}.` : "No backup yet."}
      </p>

      {photoCount > 0 && (
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={includePhotos}
            onChange={(e) => setIncludePhotos(e.target.checked)}
            className="mt-1 size-6 shrink-0 accent-stamp-red"
          />
          <span className="text-sm">
            <span className="block font-semibold text-ink">Include photos</span>
            You have {plural(photoCount, "photo")}. Photos make the file much larger, so leave them out for a small
            file.
          </span>
        </label>
      )}

      <Button block loading={exporting} onClick={exportBackup}>
        Export backup
      </Button>

      <input
        ref={picker}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-label="Backup file"
        onChange={onPick}
      />
      <Button block variant="secondary" onClick={() => picker.current?.click()}>
        Import a backup
      </Button>
      {problem && (
        <p role="alert" className="text-sm font-semibold text-stamp-red">
          {problem}
        </p>
      )}

      {chosen && <ImportSheet backup={chosen} onClose={() => setChosen(null)} />}
    </Section>
  );
}
