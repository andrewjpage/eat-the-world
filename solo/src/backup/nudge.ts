import type { Backfill, SoloVisit } from "@solo/domain/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const MANY_NEW = 10;
const LONG_AGO_DAYS = 30;

/**
 * Whether to suggest a backup: at least 10 visits or countries added since the last one, or at least
 * one and 30 days since it. With no backup yet, everything counts as new and the 30 days run from
 * the oldest record.
 */
export function shouldNudgeBackup({
  visits,
  backfills,
  lastExportAt,
  now,
}: {
  visits: readonly SoloVisit[];
  backfills: readonly Backfill[];
  lastExportAt: string | null;
  now: Date;
}): boolean {
  const added = [...visits, ...backfills].map((record) => Date.parse(record.createdAt)).filter((at) => !Number.isNaN(at));
  const exportedAt = lastExportAt === null ? NaN : Date.parse(lastExportAt);
  const since = Number.isNaN(exportedAt) ? null : exportedAt;

  const fresh = added.filter((at) => since === null || at > since).length;
  if (fresh >= MANY_NEW) return true;
  if (fresh === 0) return false;

  const start = since ?? added.reduce((oldest, at) => Math.min(oldest, at));
  return now.getTime() - start >= LONG_AGO_DAYS * DAY_MS;
}
