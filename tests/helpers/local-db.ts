/**
 * Tests that write to a database run only against the local Supabase stack. SUPABASE_DB_URL
 * is also the name of the production secret, so an exported production URL must never be
 * enough to make a test commit rows (scripts/dev-fixtures.ts has the same guard).
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/;

export function isLocalUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    return LOCAL_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
