export type PersistenceStatus = "granted" | "denied" | "unsupported";

/**
 * Asks the browser not to evict this origin's storage under pressure. "unsupported" when the browser
 * has no storage manager (or there is no navigator at all); a refusal or a failure is "denied".
 */
export async function requestPersistence(): Promise<PersistenceStatus> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (typeof storage?.persist !== "function") return "unsupported";
  try {
    return (await storage.persist()) ? "granted" : "denied";
  } catch {
    return "denied";
  }
}
