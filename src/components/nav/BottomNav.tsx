"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { activeTab, chromeHidden, NAV_TABS, type NavTab } from "./chrome";

function Icon({ name }: { name: NavTab["icon"] }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "passport":
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <circle cx="12" cy="10.5" r="3.2" />
          <path d="M8.8 10.5h6.4M12 7.3c-1 1-1.4 2-1.4 3.2s.4 2.2 1.4 3.2c1-1 1.4-2 1.4-3.2S13 8.3 12 7.3" />
          <path d="M9 17h6" />
        </svg>
      );
    case "map":
      return (
        <svg {...common}>
          <path d="M12 21s-6-5.3-6-10.5a6 6 0 1 1 12 0C18 15.7 12 21 12 21Z" />
          <circle cx="12" cy="10.5" r="2.2" />
        </svg>
      );
    case "group":
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="3" />
          <circle cx="16.5" cy="10" r="2.4" />
          <path d="M3.5 19c.6-3 2.8-4.7 5.5-4.7s4.9 1.7 5.5 4.7M14.5 15.2c.6-.3 1.3-.4 2-.4 2.1 0 3.6 1.3 4 4.2" />
        </svg>
      );
    case "world":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5Z" />
        </svg>
      );
  }
}

/** The four main tabs, fixed to the bottom with the iPhone safe area. */
export function BottomNav() {
  const pathname = usePathname();
  if (chromeHidden(pathname)) return null;
  const active = activeTab(pathname);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {NAV_TABS.map((t) => {
          const on = active === t.href;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "relative flex h-16 flex-col items-center justify-center gap-0.5 text-[0.7rem] font-semibold transition-colors",
                  on ? "text-stamp-red" : "text-muted hover:text-ink",
                )}
              >
                {on && (
                  <span
                    aria-hidden
                    className="absolute top-0 h-[3px] w-10 rounded-b-full bg-stamp-red"
                  />
                )}
                <Icon name={t.icon} />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
