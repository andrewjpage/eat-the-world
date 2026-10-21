import { useMemo, useSyncExternalStore } from "react";

/** Stands in for `next/navigation`: routes live in the URL hash (`#/country/FR`). */

const EXTERNAL_OR_ANCHOR = /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i;

/** An app path as a hash route. External URLs, `mailto:` and in-page anchors pass through. */
export function toHref(href: string): string {
  if (EXTERNAL_OR_ANCHOR.test(href)) return href;
  return `#${href.startsWith("/") ? href : `/${href}`}`;
}

function hashBody(hash: string): string {
  return hash.startsWith("#") ? hash.slice(1) : hash;
}

/** The route path in a location hash; "/" when the hash is empty or not a route. */
export function pathFromHash(hash: string): string {
  const path = hashBody(hash).split("?", 1)[0];
  return path.startsWith("/") ? path : "/";
}

/** The query string that follows the route path in a location hash. */
export function searchFromHash(hash: string): URLSearchParams {
  const body = hashBody(hash);
  const at = body.indexOf("?");
  return new URLSearchParams(at === -1 ? "" : body.slice(at + 1));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const currentHash = () => window.location.hash;

export function usePathname(): string {
  return pathFromHash(useSyncExternalStore(subscribe, currentHash));
}

export function useSearchParams(): URLSearchParams {
  const hash = useSyncExternalStore(subscribe, currentHash);
  return useMemo(() => searchFromHash(hash), [hash]);
}

const router = {
  push: (href: string) => window.location.assign(toHref(href)),
  replace: (href: string) => window.location.replace(toHref(href)),
  back: () => window.history.back(),
  /** Nothing is server-rendered here, so there is no server data to refetch. */
  refresh: () => {},
};

/** One stable object, so callers can keep it in refs and effect dependencies. */
export function useRouter(): typeof router {
  return router;
}
