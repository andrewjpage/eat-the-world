import type { Metadata } from "next";
import { requireUser } from "@/components/auth/session";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Page } from "@/components/ui/Page";

export const metadata: Metadata = { title: "World" };

/** Placeholder until M5 ships the world map. */
export default async function WorldPage() {
  await requireUser("/world");
  return (
    <Page>
      <EmptyState
        emoji="🌍"
        title="The world map arrives soon"
        action={
          <ButtonLink href="/" block>
            Back to my passport
          </ButtonLink>
        }
      >
        Your stamps, coloured in across the globe. Until then, your passport has them all.
      </EmptyState>
    </Page>
  );
}
