import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { redirectTo, safeNext } from "@/lib/app";

/**
 * OAuth (Google) return URL: /api/auth/callback?code=...&next=/join/ABCD1234
 * Exchanges the PKCE code for a session cookie, then goes to a safe relative `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"), "/");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return redirectTo(next);
    }
  }

  const params = new URLSearchParams({ error: "oauth" });
  if (next !== "/") params.set("next", next);
  return redirectTo(`/login?${params}`);
}
