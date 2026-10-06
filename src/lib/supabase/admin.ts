import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverRealtimeOptions } from "./node-realtime";

/** Service-role client. Server only: bypasses RLS. Never import from client code. */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient must not be used in the browser");
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: serverRealtimeOptions(),
  });
}
