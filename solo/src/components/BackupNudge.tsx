import { useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { shouldNudgeBackup } from "@solo/backup/nudge";
import { useSolo } from "@solo/state/SoloContext";

/** Set once dismissed, and kept until the app is closed, so the reminder doesn't nag between screens. */
let dismissedThisSession = false;

/** A quiet note on the passport: it has been a while, or a lot is new, since the last backup. */
export function BackupNudge() {
  const { data } = useSolo();
  const [now] = useState(() => new Date());
  const [dismissed, setDismissed] = useState(dismissedThisSession);

  const due = shouldNudgeBackup({
    visits: data.visits,
    backfills: data.backfills,
    lastExportAt: data.settings.lastExportAt,
    now,
  });
  if (dismissed || !due) return null;

  return (
    <Card tone="sunk" className="mb-4 flex items-center gap-2 py-3 pr-2" role="note" aria-label="Backup reminder">
      <p className="flex-1 text-sm text-ink-soft">Your passport only lives on this phone. Time for a backup?</p>
      <ButtonLink href="/settings" size="md" variant="secondary">
        Back up
      </ButtonLink>
      <button
        type="button"
        aria-label="Dismiss the backup reminder"
        onClick={() => {
          dismissedThisSession = true;
          setDismissed(true);
        }}
        className="grid size-11 shrink-0 place-items-center rounded-full text-xl text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ink/20"
      >
        <span aria-hidden>×</span>
      </button>
    </Card>
  );
}
