import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/app";

/** Pages anyone can open signed out. Everything else redirects to /login. */
const PUBLIC_PREFIXES = ["/login", "/auth/", "/privacy", "/credits"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Refreshes the Supabase session cookie on every request (Next 16 "proxy",
 * formerly middleware) and sends signed-out visitors of app pages to /login.
 * Route handlers under /api check auth themselves and are never redirected.
 * Pages and server actions must still check the user: this is an optimistic gate.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers ?? {}).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // Do not put code between createServerClient and getClaims: it refreshes the session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) return response;

  const redirectTo = (target: string) => {
    const url = request.nextUrl.clone();
    const [path, query = ""] = target.split("?");
    url.pathname = path;
    url.search = query ? `?${query}` : "";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (!signedIn && !isPublic(pathname)) {
    const next = safeNext(pathname + search, "/");
    return redirectTo(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
  }

  if (signedIn && pathname === "/login") {
    return redirectTo(safeNext(request.nextUrl.searchParams.get("next"), "/"));
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals, the manifest, icons and static files.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
