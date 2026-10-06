"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/app";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/components/ui/cn";
import { chromeHidden } from "./chrome";

/** Small inked roundel used as the wordmark's logo. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2.2" />
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M16 7.5v17M7.5 16h17M16 7.5c-3 2.4-4.4 5.2-4.4 8.5s1.4 6.1 4.4 8.5c3-2.4 4.4-5.2 4.4-8.5S19 9.9 16 7.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

/** APP_NAME on the left, the signed-in user's avatar (to /settings) on the right. */
export function TopBar({ name, avatarUrl }: { name: string | null; avatarUrl?: string | null }) {
  const pathname = usePathname();
  if (chromeHidden(pathname)) return null;

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-stamp-red">
          <LogoMark className="-rotate-12" />
          <span className="font-display text-xl font-semibold tracking-tight text-ink">
            {APP_NAME}
          </span>
        </Link>
        {name && (
          <Link
            href="/settings"
            aria-label="Settings and profile"
            className={cn(
              "inline-flex size-11 items-center justify-center rounded-full transition active:scale-95",
              pathname?.startsWith("/settings") && "ring-2 ring-stamp-red ring-offset-2 ring-offset-paper",
            )}
          >
            <Avatar name={name} src={avatarUrl} size={34} />
          </Link>
        )}
      </div>
    </header>
  );
}
