/**
 * Turns a Postgres `raise exception` into one friendly sentence. An allowlist by SQLSTATE: only
 * our own plpgsql `raise exception` (P0001, which carries a short user-facing sentence) is shown;
 * every other error (constraints, casts, permissions, network) gets the fallback, so no Postgres
 * internals or echoed input ever reach the screen.
 */
export function friendlyError(error: { message?: string; code?: string } | null | undefined, fallback: string): string {
  if (error?.code !== "P0001") return fallback;
  return error.message?.trim() || fallback;
}
