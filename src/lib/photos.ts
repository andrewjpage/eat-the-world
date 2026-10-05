/**
 * Photo preparation in the browser (brief section 4, Photo): decode, apply the camera's
 * orientation, scale to at most 1600 px on the long edge and re-encode as JPEG through a
 * canvas. Re-encoding drops every metadata block (EXIF, GPS, XMP), and keeps the upload far
 * below the 4.5 MB request limit. The server strips again with sharp: this is the first
 * of two layers, never the only one.
 *
 * The constants and pure helpers are also used by the route handler, so this module has
 * no top-level browser access.
 */

export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_JPEG_QUALITY = 0.8;
/** The route refuses bigger requests before reading them (Vercel's body limit is 4.5 MB). */
export const PHOTO_MAX_UPLOAD_BYTES = 4_500_000;

/** A friendly, user-facing failure. The message is safe to show as is. */
export class PhotoError extends Error {
  constructor(
    message: string,
    readonly retry = false,
  ) {
    super(message);
    this.name = "PhotoError";
  }
}

/** Size that fits width x height inside max x max, never enlarging. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_EDGE) {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decodeWithBitmap(file: Blob): Promise<Decoded> {
  // 'from-image' applies the EXIF orientation, so the pixels come out the right way up. An
  // engine that rejects it throws here, and decode() falls back to an <img>, which always
  // applies orientation (a bare createImageBitmap(file) might not, and the canvas would then
  // drop the EXIF the server needs to turn it upright).
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
}

/** Fallback for engines without createImageBitmap: an <img> applies orientation itself. */
function decodeWithImage(file: Blob): Promise<Decoded> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () =>
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      return await decodeWithBitmap(file);
    } catch {
      /* try the <img> route before giving up (it reads a few more formats) */
    }
  }
  return decodeWithImage(file);
}

async function encode(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  if (typeof OffscreenCanvas === "function") {
    try {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(source, 0, 0, width, height);
        return await canvas.convertToBlob({ type: "image/jpeg", quality: PHOTO_JPEG_QUALITY });
      }
    } catch {
      /* fall through to a DOM canvas */
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      "image/jpeg",
      PHOTO_JPEG_QUALITY,
    ),
  );
}

const CANT_READ =
  "We couldn't read that photo. Try a JPEG or PNG, or set your camera to its most compatible format.";

/**
 * Turns a picked file into a small JPEG without metadata. Throws a PhotoError with a
 * message fit to show. The original file is never uploaded.
 */
export async function preparePhoto(file: File | Blob): Promise<Blob> {
  if (file.type && !file.type.startsWith("image/")) {
    throw new PhotoError("That doesn't look like a photo.");
  }
  let decoded: Decoded;
  try {
    decoded = await decode(file);
  } catch {
    throw new PhotoError(CANT_READ);
  }
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height);
    if (!width) throw new PhotoError(CANT_READ);
    const blob = await encode(decoded.source, width, height);
    if (blob.type !== "image/jpeg" || blob.size === 0) throw new PhotoError(CANT_READ);
    return blob;
  } catch (e) {
    throw e instanceof PhotoError ? e : new PhotoError(CANT_READ);
  } finally {
    decoded.close();
  }
}

export type PhotoVerification = "geo_verified" | "photo" | "self_reported";

export type UploadResult =
  | { ok: true; verification: PhotoVerification }
  | { ok: false; error: string; retry: boolean };

const UPLOAD_FALLBACK = "We couldn't upload that photo. Check your signal and try again.";

/**
 * POSTs the prepared JPEG to the route. Never rejects: the outcome is a value, so a failed
 * upload can't break the check-in screen it is shown on.
 */
export async function uploadVisitPhoto(
  visitId: string,
  blob: Blob,
  signal?: AbortSignal,
): Promise<UploadResult> {
  if (blob.size > PHOTO_MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That photo is too big to upload.", retry: false };
  }
  try {
    const res = await fetch(`/api/visits/${encodeURIComponent(visitId)}/photo`, {
      method: "POST",
      headers: { "Content-Type": blob.type || "image/jpeg" },
      cache: "no-store",
      body: blob,
      signal,
    });
    const json: unknown = await res.json().catch(() => null);
    const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    if (res.ok) {
      const v = obj.verification;
      const verification: PhotoVerification =
        v === "geo_verified" || v === "photo" || v === "self_reported" ? v : "photo";
      return { ok: true, verification };
    }
    const error = typeof obj.error === "string" ? obj.error : UPLOAD_FALLBACK;
    return { ok: false, error, retry: res.status >= 500 || res.status === 408 || res.status === 429 };
  } catch {
    return { ok: false, error: UPLOAD_FALLBACK, retry: true };
  }
}
