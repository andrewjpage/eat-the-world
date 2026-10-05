"use client";

import { useState } from "react";
import { BottomSheet, Button, Card, Eyebrow, Flag } from "@/components/ui";
import { approveSubmissionAction, rejectSubmissionAction } from "@/app/curator/actions";
import { useRun } from "./useRun";

export interface SubmissionView {
  id: string;
  name: string;
  address: string | null;
  postcode: string;
  note: string | null;
  website: string | null;
  mapHref: string;
  iso2: string;
  countryName: string;
  submitter: string;
  when: string;
  /** What approving changes, e.g. "Approving makes Japan listed in London." */
  impact: string;
  willList: boolean;
}

export function SubmissionCard({ s }: { s: SubmissionView }) {
  const approve = useRun();
  const reject = useRun();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  return (
    <Card>
      <div className="flex items-start gap-3">
        <Flag iso2={s.iso2} size="md" label={s.countryName} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{s.name}</p>
          <p className="text-sm text-ink-soft">{s.address ? `${s.address}, ` : ""}<span className="font-mono">{s.postcode}</span></p>
          <Eyebrow className="mt-1 font-mono normal-case tracking-normal">
            {s.countryName} · from {s.submitter} · {s.when}
          </Eyebrow>
        </div>
      </div>

      {s.note && <p className="mt-3 rounded-xl bg-paper-sunk px-3 py-2 text-sm text-ink-soft">{s.note}</p>}

      <p className={`mt-3 text-sm ${s.willList ? "font-semibold text-verified-teal" : "text-ink-soft"}`}>{s.impact}</p>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a href={s.mapHref} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline underline-offset-2">
          Open in Maps
        </a>
        {s.website && (
          <a href={s.website} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-ink underline underline-offset-2">
            Website
          </a>
        )}
      </div>

      {approve.error && (
        <p role="alert" className="mt-3 text-sm text-stamp-red">
          {approve.error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button className="flex-1" loading={approve.pending} onClick={() => approve.run(() => approveSubmissionAction(s.id))}>
          Approve
        </Button>
        <Button className="flex-1" variant="secondary" onClick={() => setOpen(true)}>
          Reject
        </Button>
      </div>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Reject ${s.name}?`}
        footer={
          <Button
            block
            size="lg"
            variant="danger"
            loading={reject.pending}
            onClick={() =>
              reject.run(
                () => rejectSubmissionAction(s.id, note),
                () => setOpen(false),
              )
            }
          >
            Reject suggestion
          </Button>
        }
      >
        <label htmlFor={`rej-${s.id}`} className="mb-1 block text-sm font-semibold text-ink">
          Note for the record (optional)
        </label>
        <textarea
          id={`rej-${s.id}`}
          className="input min-h-24"
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Pan-Asian menu, not a single-country specialist"
        />
        {reject.error && (
          <p role="alert" className="mt-2 text-sm text-stamp-red">
            {reject.error}
          </p>
        )}
      </BottomSheet>
    </Card>
  );
}
