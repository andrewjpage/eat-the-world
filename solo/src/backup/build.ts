import type { SoloData } from "@solo/db/schema";
import type { SoloStore } from "@solo/db/store";
import { BACKUP_APP, BACKUP_SCHEMA_VERSION, type BackupFile } from "./format";

/** A multiple of 3, so each chunk encodes to base64 with no padding and the pieces simply join. */
const CHUNK_BYTES = 3 * 8192;

/** Standard base64 of `bytes`, encoded a chunk at a time so a big photo never needs one huge argument list. */
function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let at = 0; at < bytes.length; at += CHUNK_BYTES) {
    out += btoa(String.fromCharCode.apply(null, bytes.subarray(at, at + CHUNK_BYTES) as unknown as number[]));
  }
  return out;
}

/**
 * Everything in `data` as a backup file. With photos, each one is read, encoded and let go before the
 * next, so the phone never holds more than one photo's bytes besides the text built so far.
 * The settings are not part of a backup: they describe this phone, not the passport.
 */
export async function buildBackup(
  data: SoloData,
  store: SoloStore,
  includePhotos: boolean,
  now: Date = new Date(),
): Promise<BackupFile> {
  const backup: BackupFile = {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    restaurants: data.restaurants,
    visits: data.visits,
    backfills: data.backfills,
  };
  if (!includePhotos) return backup;

  const photos = new Map<string, { type: string; base64: string }>();
  for (const { photoId } of data.visits) {
    if (!photoId || photos.has(photoId)) continue;
    const blob = await store.getPhoto(photoId);
    if (!blob) continue;
    // Photos are resized to JPEG when taken; a blob that lost its type is one of those.
    photos.set(photoId, { type: blob.type || "image/jpeg", base64: toBase64(new Uint8Array(await blob.arrayBuffer())) });
  }
  return { ...backup, photos: Object.fromEntries(photos) };
}
