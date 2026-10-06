"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/ui";
import type { CuratorResult } from "@/app/curator/actions";

/**
 * Runs a curator server action with a pending flag, a toast and an inline error.
 * `onOk` runs after a success (close a sheet, reset a form). The page refreshes itself:
 * each action revalidates /curator.
 */
export function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  function run(action: () => Promise<CuratorResult>, onOk?: () => void) {
    setError(null);
    start(async () => {
      let res: CuratorResult;
      try {
        res = await action();
      } catch {
        res = { error: "Something went wrong. Please try again." };
      }
      if (res.ok) {
        toast(res.message ?? "Done.", "success");
        onOk?.();
      } else {
        const msg = res.error ?? "Something went wrong. Please try again.";
        setError(msg);
        toast(msg, "error");
      }
    });
  }

  return { run, pending, error, clearError: () => setError(null) };
}
