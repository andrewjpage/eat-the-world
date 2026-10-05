import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "visit-photos";
/** Short-lived on purpose: a link that leaks is dead within a quarter of an hour. */
export const SIGNED_URL_SECONDS = 15 * 60;

/**
 * Signed URLs for stored visit photos, made as the signed-in user (the storage policy lets
 * members of the visit's group read). A path the caller can't read, or that is gone, is
 * simply missing from the result. Pass every path of a page in one call.
 */
export async function signPhotoUrls(
  supabase: SupabaseClient,
  paths: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
  }
  return out;
}

export async function signPhotoUrl(
  supabase: SupabaseClient,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  return (await signPhotoUrls(supabase, [path])).get(path) ?? null;
}
