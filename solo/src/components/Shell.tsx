import { useEffect, type ReactNode } from "react";
import { APP_NAME } from "@/lib/app";
import { LogoMark } from "@/components/nav/TopBar";
import { matchRoute } from "@solo/router";
import Link from "@solo/shims/link";
import { usePathname } from "@solo/shims/navigation";
import { SoloNav } from "./SoloNav";

/** The app name on the left; the group app's header without the avatar. 3.5rem tall, which the sticky bars below assume. */
function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-md items-center px-4">
        <Link href="/" className="flex items-center gap-2 text-stamp-red">
          <LogoMark className="-rotate-12" />
          <span className="font-display text-xl font-semibold tracking-tight text-ink">{APP_NAME}</span>
        </Link>
      </div>
    </header>
  );
}

/**
 * The top bar, the routed screen and the bottom nav. The check-in is a full-screen flow without
 * them, so a stray thumb on the nav can't throw away a half-done check-in.
 */
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const chrome = matchRoute(pathname).name !== "check-in";

  // A hash change keeps the scroll position; a new screen starts at the top. The braces matter:
  // Chrome's scrollTo returns a Promise, and an effect must not return one.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <>
      {chrome && <TopBar />}
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
      {chrome && <SoloNav />}
    </>
  );
}
