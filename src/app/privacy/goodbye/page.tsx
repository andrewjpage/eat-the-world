import type { Metadata } from "next";
import { APP_NAME } from "@/lib/app";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Page } from "@/components/ui/Page";

export const metadata: Metadata = { title: "Goodbye" };

// Lives under /privacy so the signed-out proxy allows it. Shown after account deletion.
export default function GoodbyePage() {
  return (
    <Page>
      <EmptyState
        emoji="👋"
        title="Your account is deleted"
        action={
          <ButtonLink href="/login" variant="secondary">
            Back to sign in
          </ButtonLink>
        }
      >
        Your profile, stamps, photos and memberships are gone. Thanks for eating the world with
        us. {APP_NAME} will be here if you ever fancy another lap.
      </EmptyState>
    </Page>
  );
}
