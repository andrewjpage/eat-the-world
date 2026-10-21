import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { ToastProvider } from "@/components/ui/Toast";
import { RouteBoundary } from "@solo/components/RouteBoundary";
import { Shell } from "@solo/components/Shell";
import { StorageUnavailable } from "@solo/components/StorageUnavailable";
import { matchRoute } from "@solo/router";
import { renderScreen } from "@solo/screens";
import { usePathname } from "@solo/shims/navigation";
import { SoloProvider, useSolo } from "@solo/state/SoloContext";

function Routes() {
  const { status } = useSolo();
  const pathname = usePathname();

  if (status === "unavailable") return <StorageUnavailable />;
  if (status === "loading") return <PageSkeleton label="Opening your passport" />;

  return (
    <Shell>
      {/* Keyed by route, so a failure on one screen is left behind when you move to another. */}
      <RouteBoundary key={pathname}>
        <Suspense fallback={<PageSkeleton label="Loading" />}>{renderScreen(matchRoute(pathname))}</Suspense>
      </RouteBoundary>
    </Shell>
  );
}

export default function App() {
  return (
    <SoloProvider>
      <ToastProvider>
        <Routes />
      </ToastProvider>
    </SoloProvider>
  );
}
