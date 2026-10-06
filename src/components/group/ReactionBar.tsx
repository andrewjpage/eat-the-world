"use client";

import { useState } from "react";
import { setReactionAction, type ReactionEmoji } from "@/app/group/[id]/actions";
import { cn } from "@/components/ui/cn";
import { useToast } from "@/components/ui/Toast";
import type { ReactionCounts } from "./data";

const BUTTONS: { emoji: ReactionEmoji; icon: string; label: string }[] = [
  { emoji: "clap", icon: "👏", label: "Clap" },
  { emoji: "drool", icon: "🤤", label: "Drool" },
  { emoji: "side_eye", icon: "🤨", label: "Side-eye" },
];

/**
 * Clap, drool and side-eye. Counts only, never names (brief section 4). Taps are optimistic
 * and roll back if the server refuses.
 */
export function ReactionBar({ visitId, initial }: { visitId: string; initial: ReactionCounts }) {
  const { toast } = useToast();
  const [counts, setCounts] = useState(initial);
  const [busy, setBusy] = useState<ReactionEmoji | null>(null);

  async function toggle(emoji: ReactionEmoji) {
    if (busy) return;
    const before = counts[emoji];
    const on = !before.mine;
    setBusy(emoji);
    setCounts((c) => ({ ...c, [emoji]: { n: Math.max(0, before.n + (on ? 1 : -1)), mine: on } }));
    const res = await setReactionAction(visitId, emoji, on);
    setBusy(null);
    if (!res.ok) {
      setCounts((c) => ({ ...c, [emoji]: before }));
      toast(res.error, "error");
    }
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Reactions">
      {BUTTONS.map(({ emoji, icon, label }) => {
        const c = counts[emoji];
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => toggle(emoji)}
            aria-pressed={c.mine}
            aria-label={`${label}${c.n ? `, ${c.n}` : ""}`}
            data-testid={`react-${emoji}`}
            className={cn(
              "inline-flex min-h-11 min-w-14 items-center justify-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition active:scale-90",
              c.mine
                ? "border-stamp-red/50 bg-stamp-red-soft text-stamp-red"
                : "border-line bg-paper-sunk text-ink-soft hover:bg-paper",
            )}
          >
            <span aria-hidden className="text-lg leading-none">
              {icon}
            </span>
            {c.n > 0 && <span className="font-mono text-xs">{c.n}</span>}
          </button>
        );
      })}
    </div>
  );
}
