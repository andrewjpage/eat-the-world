"use client";

import { useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card, Eyebrow } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import type { LeaderRow } from "./data";
import { rankRows, seasonLabel } from "./leaderboard";

const MEDALS = ["🥇", "🥈", "🥉"];
/** Season / all-time toggle, medals for the top 3, and the verified-only note. */
export function Leaderboard({
  season,
  allTime,
  seasonStart,
  seasonEnd,
  verifiedOnly,
  meId,
  action,
}: {
  season: LeaderRow[];
  allTime: LeaderRow[];
  seasonStart: string | null;
  seasonEnd: string | null;
  verifiedOnly: boolean;
  meId: string;
  /** Owner-only button slot (opens the settings sheet). */
  action?: ReactNode;
}) {
  const label = seasonLabel(seasonStart, seasonEnd);
  const [mode, setMode] = useState<"season" | "all">(label ? "season" : "all");
  const rows = mode === "season" ? season : allTime;
  const ranked = rankRows(rows);

  return (
    <section aria-labelledby="leaderboard-heading" data-testid="leaderboard">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <Eyebrow id="leaderboard-heading">Leaderboard</Eyebrow>
        {action}
      </div>
      <Card className="p-0">
        <div className="p-3 pb-0">
          <div role="tablist" aria-label="Leaderboard period" className="grid grid-cols-2 rounded-full bg-paper-sunk p-1">
            {(
              [
                ["season", "This season"],
                ["all", "All time"],
              ] as const
            ).map(([id, text]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                onClick={() => setMode(id)}
                className={cn(
                  "min-h-10 rounded-full text-sm font-semibold transition",
                  mode === id ? "bg-stamp-red text-on-stamp-red shadow-sm" : "text-ink-soft hover:text-ink",
                )}
              >
                {text}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted" data-testid="leaderboard-note">
            {mode === "season"
              ? label
                ? `Season: ${label} (London dates, inclusive).`
                : "No season dates set, so this counts everything."
              : "Every stamp and set the group has ever earned."}
          </p>
          {verifiedOnly && (
            <p className="mt-1.5" data-testid="verified-only-note">
              <Badge tone="teal" icon={<span aria-hidden>◉</span>}>
                Verified only
              </Badge>
              <span className="ml-2 text-xs text-muted">Only location-checked or photo stamps count. Set bonuses always do.</span>
            </p>
          )}
        </div>

        <ol className="mt-2 divide-y divide-line">
          {ranked.map(({ row, rank }) => {
            const medal = row.points > 0 && rank <= 3 ? MEDALS[rank - 1] : null;
            const me = row.user_id === meId;
            return (
              <li
                key={row.user_id}
                className={cn("flex items-center gap-3 px-4 py-3", me && "bg-stamp-red-soft/40")}
              >
                <span className="w-7 text-center font-display text-lg text-muted" aria-label={`Rank ${rank}`}>
                  {medal ?? rank}
                </span>
                <Avatar name={row.display_name} size={36} />
                <p className="min-w-0 flex-1 truncate font-semibold text-ink">
                  {row.display_name}
                  {me && <span className="font-normal text-muted"> (you)</span>}
                </p>
                <div className="text-right leading-tight">
                  <p className="font-display text-lg text-ink">
                    {row.points}
                    <span className="ml-1 text-xs font-sans text-muted">pts</span>
                  </p>
                  <p className="text-xs text-muted">
                    {row.countries} {row.countries === 1 ? "country" : "countries"}
                  </p>
                </div>
              </li>
            );
          })}
          {ranked.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No members yet.</li>}
        </ol>
      </Card>
    </section>
  );
}
