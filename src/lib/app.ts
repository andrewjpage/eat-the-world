/** The app's name, everywhere it is shown (brief section 11). */
export const APP_NAME = "Eat the World";

export const APP_DESCRIPTION =
  "A private passport of the world's cuisines, eaten across London with friends.";

/** Paper and ink: used for the PWA manifest and the browser theme colour. */
export const THEME_LIGHT = "#f6efe1";
export const THEME_DARK = "#14171f";

/**
 * Returns `next` if it is a safe same-origin relative path, else `fallback`.
 * Rejects absolute URLs, protocol-relative URLs (`//evil.com`), backslash
 * tricks (`/\evil.com`), dot-segment tricks (`/..//evil.com`) and control
 * characters, so a sign-in link can never bounce the user to another site.
 * Idempotent: safeNext(safeNext(x)) === safeNext(x).
 */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const base = "http://local.invalid";
    const url = new URL(next, base);
    if (url.origin !== base) return fallback;
    // Check again after URL has resolved dot segments: "/..//evil.com" becomes "//evil.com".
    const out = url.pathname + url.search + url.hash;
    return out.startsWith("//") || out.startsWith("/\\") ? fallback : out;
  } catch {
    return fallback;
  }
}

/** The /login URL that returns to `path` afterwards. */
export function loginUrl(path: string): string {
  const next = safeNext(path, "/");
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}

/**
 * A same-origin redirect for route handlers. The Location is relative, so it
 * never depends on how the server sees its own host (request.url can say
 * "localhost" when the browser used 127.0.0.1, which would lose the cookie).
 * Cookies set through next/headers cookies() are added to this response.
 */
export function redirectTo(path: string, status: 303 | 307 = 307): Response {
  return new Response(null, { status, headers: { Location: safeNext(path, "/") } });
}
