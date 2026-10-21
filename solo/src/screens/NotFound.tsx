import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export default function NotFound() {
  return (
    <EmptyState
      emoji="🧭"
      title="Nothing here"
      action={
        <ButtonLink href="/" block>
          Back to my passport
        </ButtonLink>
      }
    >
      That page doesn&apos;t exist.
    </EmptyState>
  );
}
