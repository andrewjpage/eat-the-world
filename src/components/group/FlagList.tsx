"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { downgradeVisitAction, dismissFlagAction } from "@/app/group/[id]/actions";
import { VerificationBadge } from "@/components/ui/Badge";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Card, Eyebrow } from "@/components/ui/Card";
import { Flag } from "@/components/ui/Flag";
import { stampDate } from "@/components/ui/Stamp";
import { useToast } from "@/components/ui/Toast";
import type { FlaggedItem } from "./data";

/**
 * The owner's private list of visits that got a side-eye. Nobody else sees it, and nobody sees
 * who reacted. Two outcomes: downgrade to self-reported, or dismiss the flag.
 */
export function FlagList({ groupId, items }: { groupId: string; items: FlaggedItem[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<FlaggedItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function run(kind: "downgrade" | "dismiss", item: FlaggedItem) {
    setBusyId(item.id);
    startTransition(async () => {
      const res =
        kind === "downgrade"
          ? await downgradeVisitAction(groupId, item.id)
          : await dismissFlagAction(groupId, item.id);
      setBusyId(null);
      setConfirm(null);
      toast(res.ok ? (res.message ?? "Done") : res.error, res.ok ? "success" : "error");
    });
  }

  return (
    <section aria-labelledby="flags-heading" data-testid="flag-list">
      <Eyebrow id="flags-heading" className="mb-2 px-1">
        Raised eyebrows · only you see this
      </Eyebrow>
      <Card tone="sunk" className="mb-3">
        <p className="text-sm text-ink-soft">
          When a friend 🤨s a visit, it lands here, privately. Nobody can see who reacted. Have a
          look and decide: <strong className="text-ink">downgrade</strong> it to self-reported (the stamps
          stay, just without the verified mark), or <strong className="text-ink">dismiss</strong> the flag.
          A fresh 🤨 later will bring it back.
        </p>
      </Card>

      {items.length === 0 ? (
        <p className="px-1 text-sm text-muted" data-testid="flag-empty">
          All quiet. No visit has a raised eyebrow right now.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <Card data-testid="flag-item">
                <Link
                  href={`/visit/${item.id}`}
                  prefetch={false}
                  className="flex items-start gap-3 active:opacity-70"
                >
                  <Flag iso2={item.country.iso2} size="lg" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg leading-snug text-ink">{item.restaurantName}</p>
                    <p className="text-xs text-muted">
                      {item.checkedInBy} · <span className="font-mono">{stampDate(item.visitedAt)}</span> ·{" "}
                      {item.sideEyes} <span aria-hidden>🤨</span>
                      <span className="sr-only">side-eyes</span>
                    </p>
                  </div>
                </Link>
                <div className="mt-2">
                  <VerificationBadge verification={item.verification} />
                </div>
                <div className="mt-3 grid gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => run("dismiss", item)}
                    loading={pending && busyId === item.id}
                    disabled={pending}
                  >
                    Dismiss
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => setConfirm(item)}
                    disabled={pending}
                  >
                    Downgrade to self-reported
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <BottomSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="Downgrade to self-reported?"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Leave it
            </Button>
            <Button
              onClick={() => confirm && run("downgrade", confirm)}
              loading={pending}
              data-testid="downgrade-confirm"
            >
              Downgrade
            </Button>
          </div>
        }
      >
        <p className="text-ink-soft">
          {confirm ? `${confirm.restaurantName} will show as self-reported` : "This visit will show as self-reported"}{" "}
          for everyone at the table, and a photo added later won&rsquo;t raise it again. Points stay, but verified-only leaderboards stop counting it.
        </p>
      </BottomSheet>
    </section>
  );
}
