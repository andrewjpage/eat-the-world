"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { useToast } from "@/components/ui/Toast";
import { recapText, recapWhatsAppUrl } from "./logic";

/**
 * "Share recap": fetches the recap PNG from /api/visits/[id]/recap and shares it.
 *
 * The PNG is fetched ahead of the tap, so the tap handler can call navigator.share()
 * straight away (browsers only allow it from a user gesture). Where files cannot be shared
 * (most desktops), the tap downloads the PNG; a wa.me text link is always offered as well.
 * Render it only once the server has confirmed `visitId`.
 */
export function ShareRecapButton({
  visitId,
  restaurantName,
  countryName,
  names = [],
  totalPoints = 0,
  block = true,
  className,
}: {
  visitId: string;
  restaurantName: string;
  countryName: string;
  /** Other people at the table, for the share text. */
  names?: string[];
  totalPoints?: number;
  block?: boolean;
  className?: string;
}) {
  const { toast } = useToast();
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const base = process.env.NEXT_PUBLIC_APP_URL || origin;
  const text = recapText({ restaurantName, countryName, names, totalPoints, link: `${base}/visit/${visitId}` });

  const file = useRef<File | null>(null);
  const loading = useRef<Promise<File | null> | null>(null);
  const [busy, setBusy] = useState(false);

  function load(): Promise<File | null> {
    if (file.current) return Promise.resolve(file.current);
    loading.current ??= fetch(`/api/visits/${visitId}/recap`, { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) return null;
        const blob = await r.blob();
        file.current = new File([blob], `eat-the-world-${visitId.slice(0, 8)}.png`, { type: "image/png" });
        return file.current;
      })
      .catch(() => null)
      .finally(() => {
        loading.current = null;
      });
    return loading.current;
  }

  // Warm the PNG so the tap can share synchronously, but only once the phone is idle: right
  // after a check-in the photo upload gets the signal first. A tap before then still loads it.
  useEffect(() => {
    const warm = () => void load();
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);

  function download(f: File) {
    const url = URL.createObjectURL(f);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function onShare() {
    setBusy(true);
    try {
      const f = file.current ?? (await load());
      if (!f) {
        toast("Couldn't make the recap card. Try again in a moment.", "error");
        return;
      }
      const data: ShareData = { files: [f], text };
      if (typeof navigator.canShare === "function" && navigator.canShare(data) && navigator.share) {
        try {
          await navigator.share(data);
        } catch (e) {
          // Closing the share sheet is not an error.
          if (!(e instanceof DOMException && e.name === "AbortError")) {
            download(f);
            toast("Saved the recap card to your downloads.", "info");
          }
        }
        return;
      }
      download(f);
      toast("Saved the recap card. Add it to your chat.", "success");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", block && "w-full", className)} data-testid="share-recap">
      <Button variant="secondary" size="lg" block={block} loading={busy} onClick={() => void onShare()}>
        <span aria-hidden>📸</span> Share recap
      </Button>
      <a
        href={recapWhatsAppUrl(text)}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonClass({ variant: "ghost", size: "md", block }))}
      >
        Send as a WhatsApp message
      </a>
    </div>
  );
}
