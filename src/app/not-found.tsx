import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Page } from "@/components/ui/Page";

export const metadata: Metadata = { title: "Not found" };

/** Unknown URLs, and pages that call notFound() (including groups you aren't in). */
export default function NotFound() {
  return (
    <Page>
      <EmptyState
        emoji="🧭"
        title="Off the map"
        action={
          <div className="space-y-3">
            <ButtonLink href="/" block>
              Back to my passport
            </ButtonLink>
            <ButtonLink href="/group" variant="secondary" block>
              My groups
            </ButtonLink>
          </div>
        }
      >
        This page doesn&apos;t exist, or it belongs to a group you&apos;re not in.
      </EmptyState>
    </Page>
  );
}
