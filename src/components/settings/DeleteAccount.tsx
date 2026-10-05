"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

/** Settings > Delete account (brief section 8): a confirm sheet, then DELETE /api/account. */
export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string };
      if (res.ok && body.redirect) {
        // A full navigation: the session is gone, so drop every cached screen.
        window.location.assign(body.redirect);
        return;
      }
      setError(body.error ?? "We couldn't delete your account. Please try again, or ask Andrew.");
    } catch {
      setError("We couldn't reach the server. Check your signal and try again.");
    }
    setBusy(false);
  }

  return (
    <Card tone="sunk" className="mb-6">
      <p className="font-display text-lg text-ink">Delete account</p>
      <p className="mt-1 mb-3 text-sm text-ink-soft">
        Remove your profile, stamps and photos for good.
      </p>
      <Button type="button" variant="secondary" block onClick={() => setOpen(true)}>
        Delete my account…
      </Button>

      <BottomSheet
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
        title="Delete your account?"
        footer={
          <div className="space-y-2">
            {error && (
              <p role="alert" className="text-sm font-medium text-stamp-red">
                {error}
              </p>
            )}
            <Button type="button" variant="danger" size="lg" block loading={busy} onClick={confirmDelete}>
              Yes, delete everything
            </Button>
            <Button type="button" variant="ghost" block disabled={busy} onClick={() => setOpen(false)}>
              Keep my account
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-[0.95rem] text-ink-soft">
          <p>This cannot be undone. These are removed:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Your profile and group memberships</li>
            <li>Your stamps, set awards and passport memories</li>
            <li>Your attendances, ratings, dishes and notes</li>
            <li>Your reactions and plan RSVPs</li>
            <li>The photos on visits you created</li>
          </ul>
          <p>
            <strong className="text-ink">Friends keep their stamps.</strong> If others were at the
            table, the visit stays for them with your name and photo removed, and their points
            never change. If you run a group, it passes to its longest-standing member; a group
            with nobody else in it is deleted.
          </p>
        </div>
      </BottomSheet>
    </Card>
  );
}
