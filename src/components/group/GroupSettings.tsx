"use client";

import { useId, useState, useTransition } from "react";
import { updateGroupSettingsAction } from "@/app/group/[id]/actions";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export interface GroupSettingsValues {
  name: string;
  verifiedOnly: boolean;
  seasonStart: string | null;
  seasonEnd: string | null;
}

/** Owner-only settings sheet: name, verified-only, and the season's inclusive London dates. */
export function GroupSettings({
  groupId,
  initial,
  label = "Settings",
  variant = "link",
}: {
  groupId: string;
  initial: GroupSettingsValues;
  label?: string;
  variant?: "link" | "button";
}) {
  const { toast } = useToast();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const [name, setName] = useState(initial.name);
  const [verifiedOnly, setVerifiedOnly] = useState(initial.verifiedOnly);
  const [start, setStart] = useState(initial.seasonStart ?? "");
  const [end, setEnd] = useState(initial.seasonEnd ?? "");
  const [error, setError] = useState<string | null>(null);

  function openSheet() {
    setName(initial.name);
    setVerifiedOnly(initial.verifiedOnly);
    setStart(initial.seasonStart ?? "");
    setEnd(initial.seasonEnd ?? "");
    setError(null);
    setOpen(true);
  }

  function save() {
    if (start && end && end < start) {
      setError("The season has to end on or after its start.");
      return;
    }
    setError(null);
    startSave(async () => {
      const res = await updateGroupSettingsAction(groupId, {
        name,
        verifiedOnly,
        seasonStart: start || null,
        seasonEnd: end || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      toast(res.message ?? "Settings saved", "success");
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        data-testid="group-settings-open"
        className={
          variant === "button"
            ? "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border-2 border-ink/80 bg-paper-raised px-5 text-[0.95rem] font-semibold text-ink active:scale-[0.97]"
            : "min-h-11 px-2 text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline"
        }
      >
        <span aria-hidden>⚙︎</span> {label}
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Group settings"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} data-testid="group-settings-save">
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <div>
            <label htmlFor={`${uid}-name`} className="mb-1 block text-sm font-semibold text-ink">
              Group name
            </label>
            <input
              id={`${uid}-name`}
              className="input"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="flex items-start gap-3">
            <input
              id={`${uid}-verified`}
              type="checkbox"
              checked={verifiedOnly}
              onChange={(e) => setVerifiedOnly(e.target.checked)}
              className="mt-1 size-6 shrink-0 accent-stamp-red"
            />
            <label htmlFor={`${uid}-verified`} className="text-sm">
              <span className="block font-semibold text-ink">Verified only</span>
              <span className="text-ink-soft">
                The leaderboards count only stamps with a location check or a photo. Self-reported ones stay in
                the passport, just off the table.
              </span>
            </label>
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-ink">Season</legend>
            <p className="mb-2 text-sm text-ink-soft">
              The season leaderboard counts visits and set awards between these dates, both included, in
              London time. Leave both empty for no season.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={`${uid}-start`} className="mb-1 block text-xs text-muted">
                  Starts
                </label>
                <input
                  id={`${uid}-start`}
                  type="date"
                  className="input"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-end`} className="mb-1 block text-xs text-muted">
                  Ends
                </label>
                <input
                  id={`${uid}-end`}
                  type="date"
                  className="input"
                  value={end}
                  min={start || undefined}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>
            {(start || end) && (
              <button
                type="button"
                onClick={() => {
                  setStart("");
                  setEnd("");
                }}
                className="mt-2 min-h-11 text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline"
              >
                Clear the season
              </button>
            )}
          </fieldset>

          {error && (
            <p role="alert" className="text-sm font-medium text-stamp-red">
              {error}
            </p>
          )}
        </div>
      </BottomSheet>
    </>
  );
}
