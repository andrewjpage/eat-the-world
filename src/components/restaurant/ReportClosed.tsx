"use client";

import { useState, useTransition } from "react";
import { BottomSheet, Button, useToast } from "@/components/ui";
import { reportClosedAction } from "./actions";

export function ReportClosed({ restaurantId, name }: { restaurantId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { toast } = useToast();

  function submit() {
    setError(null);
    start(async () => {
      const res = await reportClosedAction(restaurantId, note);
      if (res.ok) {
        setOpen(false);
        setNote("");
        toast("Thanks! A curator will take a look.", "success");
      } else {
        setError(res.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Report closed
      </Button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Report closed"
        footer={
          <Button block size="lg" loading={pending} onClick={submit}>
            Send report
          </Button>
        }
      >
        <p className="mb-3 text-[0.95rem] text-ink-soft">
          Has {name} shut down or moved? Tell us and a curator will check.
        </p>
        <label htmlFor="closure-note" className="mb-1 block text-sm font-semibold text-ink">
          Note (optional)
        </label>
        <textarea
          id="closure-note"
          className="input min-h-24"
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Shutters down and a to-let sign on Saturday"
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-stamp-red">
            {error}
          </p>
        )}
      </BottomSheet>
    </>
  );
}
