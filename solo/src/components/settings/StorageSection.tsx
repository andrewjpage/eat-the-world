import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { requestPersistence, type PersistenceStatus } from "@solo/db/persist";
import { formatBytes } from "./bytes";
import { Section } from "./Section";

/** Whether the browser has already promised not to clear this origin's storage. */
async function currentPersistence(): Promise<PersistenceStatus> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (typeof storage?.persisted !== "function") return typeof storage?.persist === "function" ? "denied" : "unsupported";
  try {
    return (await storage.persisted()) ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

/** Bytes used and the most the browser will allow, when the browser says. */
async function currentUsage(): Promise<{ used: number; quota: number | null } | null> {
  if (typeof navigator === "undefined" || typeof navigator.storage?.estimate !== "function") return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return typeof usage === "number" ? { used: usage, quota: typeof quota === "number" ? quota : null } : null;
  } catch {
    return null;
  }
}

/** Whether the browser will keep the data, and how much of the phone it takes. */
export function StorageSection() {
  const { toast } = useToast();
  const [persistence, setPersistence] = useState<PersistenceStatus | null>(null);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof currentUsage>>>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([currentPersistence(), currentUsage()]).then(([status, used]) => {
      if (!live) return;
      setPersistence(status);
      setUsage(used);
    });
    return () => {
      live = false;
    };
  }, []);

  async function protect() {
    const status = await requestPersistence();
    setPersistence(status);
    if (status !== "granted") toast("The browser said no for now. Keep a recent backup.", "info");
  }

  return (
    <Section title="Storage">
      {persistence === "granted" && (
        <p>
          <strong className="text-verified-teal">Protected.</strong> The browser won&apos;t clear your passport to free
          up space.
        </p>
      )}
      {persistence === "denied" && (
        <>
          <p>
            <strong className="text-ink">Not protected yet.</strong> If this phone runs short of space, the browser may
            clear your passport. A recent backup is the safe answer.
          </p>
          <Button block variant="secondary" onClick={protect}>
            Ask the browser to protect it
          </Button>
        </>
      )}
      {persistence === "unsupported" && (
        <p>This browser doesn&apos;t say whether your passport is protected. Keep a recent backup.</p>
      )}
      {usage && (
        <p className="text-sm">
          Using <strong className="text-ink">{formatBytes(usage.used)}</strong>
          {usage.quota !== null && <> of the {formatBytes(usage.quota)} this browser allows</>}.
        </p>
      )}
    </Section>
  );
}
