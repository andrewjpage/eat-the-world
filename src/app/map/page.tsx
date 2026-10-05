import type { Metadata } from "next";
import { requireUser } from "@/components/auth/session";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Page } from "@/components/ui/Page";

export const metadata: Metadata = { title: "Map" };

/** Placeholder until M5 ships the London map. */
export default async function MapPage() {
  await requireUser("/map");
  return (
    <Page>
      <EmptyState
        emoji="📍"
        title="The map arrives soon"
        action={
          <ButtonLink href="/" block>
            Back to my passport
          </ButtonLink>
        }
      >
        Every listed restaurant in London, pinned. Until then, tap a flag in your passport to
        find somewhere to eat.
      </EmptyState>
    </Page>
  );
}
