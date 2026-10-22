import type { SoloStore } from "@solo/db/store";
import type { BackupFile } from "./format";

function toBlob({ type, base64 }: { type: string; base64: string }): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Writes a parsed backup into the store in one transaction (the store does the merging: what is
 * already here wins). `replace` empties the store first but keeps this phone's settings, since a
 * backup does not carry any, and keeps the photos already here that the file's visits name.
 *
 * Only photos that a visit will actually use are written, so a merge never leaves one nothing refers to.
 */
export async function applyImport(store: SoloStore, backup: BackupFile, mode: "merge" | "replace"): Promise<void> {
  const current = await store.load();

  // The visits as they will stand afterwards: in a merge, one already here keeps its own version.
  const after = new Map(backup.visits.map((v) => [v.id, v]));
  if (mode === "merge") for (const v of current.visits) after.set(v.id, v);
  const used = new Set([...after.values()].map((v) => v.photoId));

  const photos = new Map<string, Blob>();
  for (const [id, photo] of Object.entries(backup.photos ?? {})) {
    if (used.has(id)) photos.set(id, toBlob(photo));
  }

  // Replace clears the photos store, so a photo the file leaves out (a backup made without photos) would be
  // lost along with the rest. Carry over the ones this phone has for the visits it is about to keep.
  if (mode === "replace") {
    for (const { photoId } of backup.visits) {
      if (photoId === null || photos.has(photoId)) continue;
      const here = await store.getPhoto(photoId);
      if (here) photos.set(photoId, here);
    }
  }

  await store.importData(
    {
      restaurants: backup.restaurants,
      visits: backup.visits,
      backfills: backup.backfills,
      settings: current.settings,
    },
    { mode, photos },
  );
}
