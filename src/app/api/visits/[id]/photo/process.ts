/**
 * Server-side photo processing for POST /api/visits/[id]/photo (brief section 4, Photo).
 *
 * Whatever the browser sent, what is stored is a fresh JPEG built from the pixels only:
 * sharp rotate() applies the orientation, resize() fits 1600 x 1600 without enlarging, and
 * jpeg() runs with no withMetadata/keepExif/keepXmp/keepIccProfile, so EXIF (GPS included),
 * XMP, IPTC and ICC are all dropped. The result is checked again before it is returned.
 *
 * If sharp can't load, only a JPEG that passes the strict allowlist in jpegCarriesMetadata
 * (JFIF, tables, frame, scans, EOI and nothing else) is stored as it is; every other JPEG and
 * every non-JPEG is refused: an unstripped photo is never stored.
 *
 * No function here logs or returns the bytes.
 */
import type sharpType from "sharp";
import { PHOTO_MAX_EDGE } from "@/lib/photos";

export type PhotoKind = "jpeg" | "png" | "webp";

export type SharpModule = typeof sharpType;

export type ProcessResult =
  | { ok: true; jpeg: Buffer; width: number; height: number; engine: "sharp" | "passthrough" }
  | { ok: false; status: number; error: string };

/** Upper bound on decoded pixels: about 200 MB of RGBA at most on a small serverless function. */
export const PHOTO_MAX_INPUT_PIXELS = 50_000_000;

export const UNSUPPORTED = "We can only take JPEG, PNG or WebP photos. HEIC isn't supported yet.";
const UNREADABLE = "We couldn't read that photo. Try another one.";
const NEEDS_STRIP = "That photo still carries location or camera details, so it wasn't stored.";

/** What the first bytes say the file is. The Content-Type header is never trusted. */
export function sniffPhotoKind(b: Uint8Array): PhotoKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return "png";
  }
  const at = (offset: number, text: string) =>
    [...text].every((c, i) => b[offset + i] === c.charCodeAt(0));
  if (b.length >= 12 && at(0, "RIFF") && at(8, "WEBP")) return "webp";
  return null;
}

/** Header segments a bare, metadata-free baseline or progressive JPEG needs (besides APP0). */
const ALLOWED_HEADER = new Set([
  0xdb, // DQT
  0xc0, // SOF0 baseline
  0xc1, // SOF1 extended sequential
  0xc2, // SOF2 progressive
  0xc4, // DHT
  0xdd, // DRI
]);
/** Segments allowed between the scans of a progressive JPEG. */
const ALLOWED_BETWEEN_SCANS = new Set([0xdb, 0xc4, 0xdd, 0xda]);

/** APP0 payload starts "JFIF\0". */
const isJfif = (b: Uint8Array, at: number, payload: number) =>
  payload >= 5 &&
  b[at] === 0x4a &&
  b[at + 1] === 0x46 &&
  b[at + 2] === 0x49 &&
  b[at + 3] === 0x46 &&
  b[at + 4] === 0x00;

/**
 * An allowlist. False only for a JPEG made of SOI, an optional JFIF APP0, tables, one frame,
 * scans and a final EOI with nothing after it. True for every other segment (any other APPn:
 * Exif, XMP, ICC, MPF, JUMBF/C2PA, IPTC; COM comments), a second embedded JPEG, bytes after
 * the EOI (Motion Photo and vendor trailers), and anything that doesn't parse.
 */
export function jpegCarriesMetadata(b: Uint8Array): boolean {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return true;
  // A second SOI anywhere means an embedded JPEG (a thumbnail or MPF secondary image).
  for (let k = 2; k + 2 < b.length; k++) {
    if (b[k] === 0xff && b[k + 1] === 0xd8 && b[k + 2] === 0xff) return true;
  }

  // Length of the segment whose length field starts at `at`; -1 when it doesn't fit.
  const segLen = (at: number) => {
    if (at + 2 > b.length) return -1;
    const len = (b[at] << 8) | b[at + 1];
    return len < 2 || at + len > b.length ? -1 : len;
  };

  // 1. Header segments, up to and including the first SOS.
  let i = 2;
  for (;;) {
    if (i >= b.length || b[i] !== 0xff) return true;
    while (i < b.length && b[i] === 0xff) i++; // fill bytes
    if (i >= b.length) return true;
    const marker = b[i++];
    const len = segLen(i);
    if (len < 0) return true;
    if (marker === 0xe0) {
      if (!isJfif(b, i + 2, len - 2)) return true;
    } else if (marker !== 0xda && !ALLOWED_HEADER.has(marker)) {
      return true;
    }
    i += len;
    if (marker === 0xda) break;
  }

  // 2. Entropy-coded data (and, when progressive, more tables and scans) up to the first EOI.
  while (i < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < b.length && b[j] === 0xff) j++; // fill bytes
    if (j >= b.length) return true;
    const marker = b[j];
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      i = j + 1; // byte stuffing or a restart marker
      continue;
    }
    if (marker === 0xd9) return j !== b.length - 1; // the EOI must be the last two bytes
    if (!ALLOWED_BETWEEN_SCANS.has(marker)) return true;
    const len = segLen(j + 1);
    if (len < 0) return true;
    i = j + 1 + len;
  }
  return true; // no EOI
}

let sharpPromise: Promise<SharpModule | null> | null = null;

/** sharp, or null when its native binary can't load here. Loaded once. */
export function loadSharp(): Promise<SharpModule | null> {
  sharpPromise ??= import("sharp").then(
    (m) => (m.default ?? m) as SharpModule,
    () => {
      // Once per process, with no detail: the launch check shows which engine ran.
      console.warn("photo: sharp unavailable, strict passthrough");
      return null;
    },
  );
  return sharpPromise;
}

/** Re-encodes with sharp. Throws if the input can't be decoded. */
async function reencode(sharp: SharpModule, input: Uint8Array) {
  const { data, info } = await sharp(input, {
    failOn: "error",
    // 48 MP phone photos (48.8 MP) are fine, and the browser already resizes to 1600 px;
    // a decompression bomb (a tiny file that expands to hundreds of MB) is not.
    limitInputPixels: PHOTO_MAX_INPUT_PIXELS,
  })
    .rotate() // apply the EXIF orientation to the pixels, then the tag is gone
    .resize({ width: PHOTO_MAX_EDGE, height: PHOTO_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }) // a PNG's transparency becomes white, not black
    .jpeg({ quality: 80 }) // no withMetadata(): everything else is dropped
    .toBuffer({ resolveWithObject: true });
  return { jpeg: data, width: info.width, height: info.height };
}

export async function processPhoto(
  input: Uint8Array,
  /** Tests pass null to exercise the no-sharp path. */
  opts: { sharp?: SharpModule | null } = {},
): Promise<ProcessResult> {
  const kind = sniffPhotoKind(input);
  if (!kind) return { ok: false, status: 415, error: UNSUPPORTED };

  const sharp = opts.sharp === undefined ? await loadSharp() : opts.sharp;

  if (!sharp) {
    // Without sharp only a JPEG that passes the strict allowlist is safe to store as it is.
    if (kind !== "jpeg") return { ok: false, status: 415, error: UNSUPPORTED };
    if (jpegCarriesMetadata(input)) return { ok: false, status: 422, error: NEEDS_STRIP };
    return { ok: true, jpeg: Buffer.from(input), width: 0, height: 0, engine: "passthrough" };
  }

  let out: Awaited<ReturnType<typeof reencode>>;
  try {
    out = await reencode(sharp, input);
  } catch {
    return { ok: false, status: 422, error: UNREADABLE };
  }

  // Check the output on its own terms: sharp's own report and our segment scan.
  try {
    const meta = await sharp(out.jpeg).metadata();
    const leftover = meta.exif ?? meta.xmp ?? meta.iptc ?? meta.tifftagPhotoshop ?? meta.icc;
    if (leftover || jpegCarriesMetadata(out.jpeg)) {
      return { ok: false, status: 422, error: NEEDS_STRIP };
    }
  } catch {
    return { ok: false, status: 422, error: UNREADABLE };
  }
  return { ok: true, ...out, engine: "sharp" };
}
