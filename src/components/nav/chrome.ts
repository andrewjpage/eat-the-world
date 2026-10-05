/** Routes that render without the TopBar and BottomNav (full-screen flows). */
export const CHROME_HIDDEN_PREFIXES = ["/login", "/auth/"];

export function chromeHidden(pathname: string | null): boolean {
  if (!pathname) return false;
  return CHROME_HIDDEN_PREFIXES.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`),
  );
}

export interface NavTab {
  href: "/" | "/map" | "/group" | "/world";
  label: string;
  icon: "passport" | "map" | "group" | "world";
}

export const NAV_TABS: NavTab[] = [
  { href: "/", label: "Passport", icon: "passport" },
  { href: "/map", label: "Map", icon: "map" },
  { href: "/group", label: "Group", icon: "group" },
  { href: "/world", label: "World", icon: "world" },
];

/** Which tab a path belongs to: /country and /restaurant live under Passport. */
export function activeTab(pathname: string | null): NavTab["href"] | null {
  if (!pathname) return null;
  if (pathname === "/" || pathname.startsWith("/country") || pathname.startsWith("/restaurant")) {
    return "/";
  }
  for (const t of NAV_TABS) {
    if (t.href !== "/" && (pathname === t.href || pathname.startsWith(`${t.href}/`))) return t.href;
  }
  return null;
}
