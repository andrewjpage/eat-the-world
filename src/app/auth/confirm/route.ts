import type { EmailOtpType } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { redirectTo, safeNext } from "@/lib/app";

const TYPES: EmailOtpType[] = ["email", "magiclink", "signup", "invite", "recovery", "email_change"];

/**
 * Email templates pass `next={{ .RedirectTo }}`, an absolute URL that Supabase
 * Auth has already checked against the redirect allow-list. Keep only its path
 * and query; safeNext then makes sure the result stays on this site.
 */
function pathOf(raw: string | null): string | null {
  if (!raw || !/^https?:/i.test(raw)) return raw;
  try {
    const u = new URL(raw);
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

/**
 * The link in sign-in emails (and from scripts/dev-login.ts):
 * /auth/confirm?token_hash=...&type=email&next=/join/ABCD1234
 * Verifies the token, sets the session cookie, then goes to a safe relative `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(pathOf(searchParams.get("next")), "/");

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return redirectTo(next);
    }
  }

  const params = new URLSearchParams({ error: "link" });
  if (next !== "/") params.set("next", next);
  return redirectTo(`/login?${params}`);
}
