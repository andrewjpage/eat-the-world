import { EmptyState } from "@/components/ui/EmptyState";

/** Shown instead of the app when the browser will not open the on-device database. */
export function StorageUnavailable() {
  return (
    <main className="flex flex-1 flex-col justify-center">
      <EmptyState emoji="🔒" title="Storage is unavailable in this window">
        Everything is kept on this device, and this window won&apos;t let the app save anything. Private and
        guest windows often block it. Open the app in a normal browser window.
      </EmptyState>
    </main>
  );
}
