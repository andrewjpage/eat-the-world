import { useId, type ReactNode } from "react";
import { Card, Eyebrow } from "@/components/ui/Card";

/** One block of the Settings screen: a small-caps heading over a card. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mb-6">
      <Eyebrow id={headingId} role="heading" aria-level={2} className="mb-2 px-1">
        {title}
      </Eyebrow>
      <Card className="space-y-3 text-[0.95rem] text-ink-soft">{children}</Card>
    </section>
  );
}
