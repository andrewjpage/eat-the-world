"use client";

import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Page } from "@/components/ui/Page";

/**
 * Any page that throws (often a dropped connection on poor signal). `retry`
 * re-fetches and re-renders the segment (Next 16 error.js).
 */
export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <Page>
      <EmptyState
        emoji="📡"
        title="Lost the signal"
        action={
          <div className="space-y-3">
            <Button size="lg" block onClick={() => retry()}>
              Try again
            </Button>
            <ButtonLink href="/" variant="secondary" block>
              Back to my passport
            </ButtonLink>
          </div>
        }
      >
        Something went wrong loading this page. Check your connection and try again.
      </EmptyState>
    </Page>
  );
}
