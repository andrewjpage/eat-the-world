import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Catches a screen that fails to load or to render, most often a lazy chunk that is not cached and
 * cannot be fetched offline, so the page never goes blank. Retry reloads the page: after a failed
 * import Chrome remembers the failure and does not ask the network again, so only a reload fetches
 * the chunk afresh. Everything the app keeps is in IndexedDB, so a reload loses nothing.
 */
export class RouteBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <EmptyState
        emoji="📡"
        title="This page didn't open"
        action={
          <Button block onClick={() => window.location.reload()}>
            Retry
          </Button>
        }
      >
        A page you haven&apos;t opened before may need a connection the first time. Your passport is safe on
        this phone.
      </EmptyState>
    );
  }
}
