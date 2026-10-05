/**
 * DEV ONLY: print a one-click sign-in URL for a local user.
 *
 *   npm run dev:login -- alice@example.com [--port 3101] [--next /group]
 *
 * Creates the user (email confirmed) through the admin API if missing, then
 * uses auth.admin.generateLink to mint a magic-link token and prints
 * http://127.0.0.1:<port>/auth/confirm?token_hash=...&type=magiclink&next=/
 * Refuses to run unless NEXT_PUBLIC_SUPABASE_URL points at localhost.
 */
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { serverRealtimeOptions } from "../src/lib/supabase/node-realtime";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(`dev-login: ${message}`);
  process.exit(1);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

  const host = new URL(url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    fail(`refusing to run against ${host}: dev-login is for the local Supabase stack only`);
  }

  const flagValues = new Set(["--port", "--next"].map((f) => arg(f.slice(2))));
  const email = process.argv
    .slice(2)
    .find((a) => !a.startsWith("--") && !flagValues.has(a))
    ?.trim()
    .toLowerCase();
  if (!email || !email.includes("@")) {
    fail("usage: npm run dev:login -- <email> [--port 3000] [--next /path]");
  }
  const port = arg("port") ?? process.env.PORT ?? "3000";
  if (!/^\d{2,5}$/.test(port)) fail(`bad port ${port}`);
  const next = arg("next") ?? "/";
  if (!next.startsWith("/") || next.startsWith("//")) fail("--next must be a relative path");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: serverRealtimeOptions(),
  });

  // Create the user if missing. "already registered" just means they exist.
  const { error: createError } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (createError && !/already|exists|registered/i.test(createError.message)) {
    fail(`createUser failed: ${createError.message}`);
  }

  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) {
    fail(`generateLink failed: ${error?.message ?? "no token returned"}`);
  }

  const link = new URL(`http://127.0.0.1:${port}/auth/confirm`);
  link.searchParams.set("token_hash", data.properties.hashed_token);
  link.searchParams.set("type", "magiclink");
  link.searchParams.set("next", next);
  console.log(link.toString());
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
