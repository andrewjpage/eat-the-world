"use client";

import Link from "next/link";
import { Badge, Button, Card, Eyebrow } from "@/components/ui";
import { resolveClosureReportAction, setRestaurantStatusAction } from "@/app/curator/actions";
import type { RestaurantStatus } from "./logic";
import { useRun } from "./useRun";

export interface ClosureView {
  reportId: string;
  restaurantId: string;
  restaurantName: string;
  postcode: string;
  status: RestaurantStatus;
  countryName: string;
  eligibleCount: number;
  note: string | null;
  reporter: string;
  when: string;
}

const STATUS_LABEL: Record<RestaurantStatus, string> = {
  active: "Active",
  reported_closed: "Reported closed",
  closed: "Closed",
  pending: "Pending",
};

export function ClosureCard({ c }: { c: ClosureView }) {
  const status = useRun();
  const resolve = useRun();
  const eligible = c.status === "active" || c.status === "reported_closed";
  const impact = eligible
    ? c.eligibleCount <= 1
      ? `The only eligible ${c.countryName} restaurant: marking it closed makes ${c.countryName} unlisted. A single report on its own doesn't delist it.`
      : `${c.countryName} has ${c.eligibleCount} eligible restaurants, so it stays listed either way.`
    : c.eligibleCount === 0
      ? `${c.countryName} has no eligible restaurant right now. Setting this one active lists it again.`
      : `${c.countryName} stays listed through its other ${c.eligibleCount} restaurant${c.eligibleCount === 1 ? "" : "s"}.`;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/restaurant/${c.restaurantId}`} className="font-semibold text-ink underline-offset-2 hover:underline">
            {c.restaurantName}
          </Link>
          <p className="font-mono text-xs text-muted">{c.postcode}</p>
        </div>
        <Badge tone={c.status === "active" ? "teal" : c.status === "closed" ? "red" : "gold"}>{STATUS_LABEL[c.status]}</Badge>
      </div>
      <Eyebrow className="mt-2 font-mono normal-case tracking-normal">
        Reported by {c.reporter} · {c.when}
      </Eyebrow>
      {c.note && <p className="mt-2 rounded-xl bg-paper-sunk px-3 py-2 text-sm text-ink-soft">{c.note}</p>}
      <p className="mt-3 text-sm text-ink-soft">{impact}</p>

      {(status.error || resolve.error) && (
        <p role="alert" className="mt-3 text-sm text-stamp-red">
          {status.error ?? resolve.error}
        </p>
      )}

      <Eyebrow className="mt-4 mb-2">Set restaurant status</Eyebrow>
      <div className="grid grid-cols-3 gap-2">
        {(["reported_closed", "closed", "active"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === "closed" ? "danger" : "secondary"}
            disabled={c.status === s || status.pending}
            onClick={() => status.run(() => setRestaurantStatusAction(c.restaurantId, s))}
            className="px-2"
          >
            {s === "reported_closed" ? "Reported" : s === "closed" ? "Closed" : "Active"}
          </Button>
        ))}
      </div>
      <Button
        block
        className="mt-2"
        loading={resolve.pending}
        onClick={() => resolve.run(() => resolveClosureReportAction(c.reportId))}
      >
        Resolve report
      </Button>
    </Card>
  );
}
