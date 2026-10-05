import type { RealtimeClientOptions } from "@supabase/supabase-js";

/**
 * Realtime options for server-side clients that never subscribe to channels.
 *
 * supabase-js resolves a WebSocket constructor when the client is created and
 * throws on Node < 22, which has no global WebSocket. CI and Vercel run Node 22+,
 * so this returns {} there. On older Node it supplies a transport that fails only
 * if something actually tries to open a Realtime connection.
 */
export function serverRealtimeOptions(): RealtimeClientOptions {
  if (typeof globalThis.WebSocket !== "undefined") return {};
  class RealtimeUnavailable {
    constructor() {
      throw new Error("Supabase Realtime needs Node.js 22+ (no global WebSocket)");
    }
  }
  return { transport: RealtimeUnavailable as unknown as RealtimeClientOptions["transport"] };
}
