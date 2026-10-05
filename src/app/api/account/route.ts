import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { handleAccountDelete } from "./handle";

/** DELETE /api/account: removes the signed-in user's account and photos (brief section 8). */
export const runtime = "nodejs";

export async function DELETE() {
  const response = await handleAccountDelete({
    supabase: await createClient(),
    admin: createAdminClient(),
  });
  if (response.ok) revalidatePath("/", "layout");
  return response;
}
