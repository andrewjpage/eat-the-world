import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { MAX_NEW_STAMPS_PER_DAY } from "@/lib/scoring";
import { serverRealtimeOptions } from "@/lib/supabase/node-realtime";

// Runs against the local stack when .env.local exists; skips cleanly otherwise.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!url || !key)("TypeScript and SQL constants agree", () => {
  it("max_new_stamps_per_day() equals MAX_NEW_STAMPS_PER_DAY", async () => {
    const db = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: serverRealtimeOptions(),
    });
    const { data, error } = await db.rpc("max_new_stamps_per_day");
    expect(error).toBeNull();
    expect(data).toBe(MAX_NEW_STAMPS_PER_DAY);
  });
});
