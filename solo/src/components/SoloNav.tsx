import { cn } from "@/components/ui/cn";
import { CHECK_IN_HREF } from "@/components/nav/chrome";
import Link from "@solo/shims/link";
import { usePathname } from "@solo/shims/navigation";
import { matchRoute, type RouteName } from "@solo/router";

type Icon = "passport" | "map" | "world" | "settings";

interface Tab {
  href: string;
  label: string;
  icon: Icon;
  /** The routes that keep this tab lit: a country or a restaurant is still the passport. */
  routes: RouteName[];
}

const PASSPORT: Tab = {
  href: "/",
  label: "Passport",
  icon: "passport",
  routes: ["passport", "country", "restaurant", "visit", "backfill"],
};
const MAP: Tab = { href: "/map", label: "Map", icon: "map", routes: ["map"] };
const WORLD: Tab = { href: "/world", label: "World", icon: "world", routes: ["world"] };
const SETTINGS: Tab = { href: "/settings", label: "Settings", icon: "settings", routes: ["settings"] };

/** Passport and Map, then Check in in the centre, then World and Settings. */
const BEFORE_CENTRE = [PASSPORT, MAP];
const AFTER_CENTRE = [WORLD, SETTINGS];

// The group app's nav draws these icons inside a private function, so they are drawn again here.
function TabIcon({ name }: { name: Icon }) {
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
    case "world":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5Z" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" />
          <circle cx="15" cy="7" r="2" />
          <circle cx="9" cy="12" r="2" />
          <circle cx="17" cy="17" r="2" />
        </svg>
      );
  }
}

function TabLink({ tab, on }: { tab: Tab; on: boolean }) {
  return (
    <Link
      href={tab.href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "relative flex h-16 flex-col items-center justify-center gap-0.5 text-[0.7rem] font-semibold transition-colors",
        on ? "text-stamp-red" : "text-muted hover:text-ink",
      )}
    >
      {on && <span aria-hidden className="absolute top-0 h-[3px] w-10 rounded-b-full bg-stamp-red" />}
      <TabIcon name={tab.icon} />
      {tab.label}
    </Link>
  );
}

/** The centre button: a raised red stamp, thumb height, always one tap from check-in. */
function CheckInButton({ on }: { on: boolean }) {
  return (
    <Link
      href={CHECK_IN_HREF}
      aria-current={on ? "page" : undefined}
      className="relative flex h-16 flex-col items-center justify-end pb-1.5 text-[0.7rem] font-semibold text-stamp-red"
    >
      <span
        aria-hidden
        className={cn(
          "absolute -top-5 grid size-14 place-items-center rounded-full border-4 border-paper-raised bg-stamp-red text-on-stamp-red",
          "shadow-[0_3px_0_rgb(var(--shadow-ink)/0.25)] transition active:scale-95",
          on && "ring-2 ring-stamp-red ring-offset-2 ring-offset-paper-raised",
        )}
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 21s-6-5.3-6-10.5a6 6 0 1 1 12 0C18 15.7 12 21 12 21Z" />
          <path d="m9.6 10.6 1.7 1.7 3.2-3.4" />
        </svg>
      </span>
      Check in
    </Link>
  );
}

export function SoloNav() {
  const route = matchRoute(usePathname()).name;

  return (
    <>
      {/* Keeps the end of the page clear of the fixed nav. */}
      <div aria-hidden className="h-[calc(4rem+env(safe-area-inset-bottom))] shrink-0" />
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {BEFORE_CENTRE.map((tab) => (
            <li key={tab.href}>
              <TabLink tab={tab} on={tab.routes.includes(route)} />
            </li>
          ))}
          <li>
            <CheckInButton on={route === "check-in"} />
          </li>
          {AFTER_CENTRE.map((tab) => (
            <li key={tab.href}>
              <TabLink tab={tab} on={tab.routes.includes(route)} />
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
