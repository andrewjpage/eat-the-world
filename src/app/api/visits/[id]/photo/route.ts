import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { handlePhotoUpload } from "./handle";

/**
 * POST /api/visits/[id]/photo: the raw JPEG/PNG/WebP as the request body.
 *
 * Node runtime (sharp is native). All the work is in handle.ts so the integration test runs
 * the same path. The body is never logged and never echoed.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/visits/[id]/photo">) {
  const { id } = await ctx.params;
  const response = await handlePhotoUpload(request, id, {
    supabase: await createClient(),
    admin: createAdminClient(),
  });
  if (response.ok) revalidatePath(`/visit/${id}`);
  return response;
}
