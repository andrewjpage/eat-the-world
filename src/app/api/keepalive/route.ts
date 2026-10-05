import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/keepalive: a daily ping (Vercel Cron, backed up by a GitHub Actions schedule) that
 * keeps the free Supabase project from pausing. Needs `Authorization: Bearer <CRON_SECRET>`
 * (Vercel sends it on its own) and does a real database read.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Constant-time compare: hashing first gives both sides the same length. */
function secretMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const sha = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(sha(header), sha(`Bearer ${secret}`));
}

export async function GET(request: Request) {
  if (!secretMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  const { count, error } = await createAdminClient()
    .from("cities")
    .select("id", { count: "exact", head: true });
  if (error || count === null) {
    return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
  return Response.json({ ok: true }, { headers: NO_STORE });
}
