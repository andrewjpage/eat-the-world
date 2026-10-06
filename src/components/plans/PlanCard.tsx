"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/browser";
import { Badge, Button, Card, Eyebrow, buttonClass, cn, useToast } from "@/components/ui";
import { saveRsvp } from "./rsvp";
import { formatWhen, planWhatsAppUrl, type PlanRsvpSummary, type PlanStatus, type Rsvp } from "./logic";

export interface PlanCardData {
  id: string;
  status: PlanStatus;
  proposedFor: string;
  restaurantId: string;
  restaurantName: string;
  proposerName: string | null;
  canManage: boolean;
  rsvps: PlanRsvpSummary;
  mine: Rsvp | null;
  groupUrl: string;
}

const choices: { value: Rsvp; label: string; emoji: string }[] = [
  { value: "yes", label: "I'm in", emoji: "🙌" },
  { value: "maybe", label: "Maybe", emoji: "🤔" },
  { value: "no", label: "Can't", emoji: "😢" },
];

/** One dinner plan: RSVP, who is coming, calendar and WhatsApp, and (for the proposer or owner) status. */
export function PlanCard({ plan, userId }: { plan: PlanCardData; userId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [mine, setMine] = useState<Rsvp | null>(plan.mine);

  function rsvp(value: Rsvp) {
    const before = mine;
    setMine(value);
    start(async () => {
      const ok = await saveRsvp(createClient(), plan.id, userId, value);
      if (!ok) {
        setMine(before);
        toast("Couldn't save your answer. Try again.", "error");
        return;
      }
      router.refresh();
    });
  }

  function setStatus(status: PlanStatus) {
    start(async () => {
      const { error } = await createClient().from("plans").update({ status }).eq("id", plan.id);
      if (error) {
        toast("Couldn't update the plan. Try again.", "error");
        return;
      }
      toast(status === "booked" ? "Marked as booked" : status === "done" ? "Marked as done" : "Plan cancelled", "success");
      router.refresh();
    });
  }

  const { yes, maybe, no } = plan.rsvps;
  // The local answer wins until the refresh brings the counts back.
  const counts = { yes: yes.length, maybe: maybe.length, no: no.length };

  return (
    <Card data-testid="plan-card" data-plan-id={plan.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>{formatWhen(plan.proposedFor)}</Eyebrow>
          <Link
            href={`/restaurant/${plan.restaurantId}`}
            prefetch={false}
            className="mt-0.5 block font-display text-xl leading-snug text-ink"
          >
            {plan.restaurantName}
          </Link>
          {plan.proposerName && <p className="text-xs text-muted">Proposed by {plan.proposerName}</p>}
        </div>
        {plan.status === "booked" ? <Badge tone="teal">Booked</Badge> : <Badge tone="gold">Proposed</Badge>}
      </div>

      <div role="group" aria-label="Are you coming?" className="mt-3 grid grid-cols-3 gap-2">
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={mine === c.value}
            disabled={pending}
            onClick={() => rsvp(c.value)}
            className={cn(
              "min-h-11 rounded-full border-2 px-2 text-sm font-semibold transition active:scale-[0.97] disabled:opacity-60",
              mine === c.value
                ? "border-stamp-red bg-stamp-red text-on-stamp-red"
                : "border-ink/30 bg-paper-raised text-ink hover:bg-paper-sunk",
            )}
          >
            <span aria-hidden>{c.emoji}</span> {c.label}
          </button>
        ))}
      </div>

      <p className="mt-3 text-sm text-ink-soft" data-testid="rsvp-counts">
        <strong className="text-ink">{counts.yes} yes</strong> · {counts.maybe} maybe · {counts.no} no
      </p>
      {yes.length > 0 && <p className="text-sm text-ink">Coming: {yes.join(", ")}</p>}
      {maybe.length > 0 && <p className="text-xs text-muted">Maybe: {maybe.join(", ")}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {/* No `download`: iOS opens an inline text/calendar in the Add to Calendar sheet. */}
        <a href={`/api/plans/${plan.id}/ics`} className={buttonClass({ variant: "secondary", size: "sm" })}>
          <span aria-hidden>📅</span> Add to calendar
        </a>
        <a
          href={planWhatsAppUrl({
            restaurantName: plan.restaurantName,
            proposedFor: plan.proposedFor,
            groupUrl: plan.groupUrl,
          })}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          <span aria-hidden>💬</span> Share to WhatsApp
        </a>
      </div>

      {plan.canManage && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          {plan.status === "proposed" && (
            <Button size="sm" variant="teal" disabled={pending} onClick={() => setStatus("booked")}>
              Mark booked
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setStatus("done")}>
            Mark done
          </Button>
          <Button size="sm" variant="danger" disabled={pending} onClick={() => setStatus("cancelled")}>
            Cancel
          </Button>
        </div>
      )}
    </Card>
  );
}
