import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  jpegCarriesMetadata,
  processPhoto,
  sniffPhotoKind,
} from "@/app/api/visits/[id]/photo/process";
import { fitWithin } from "@/lib/photos";
import { makeGpsJpeg, makeHeicLike } from "../fixtures/photos";

const flat = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#336699" } });

describe("fitWithin", () => {
  it("scales the long edge to 1600 and never enlarges", () => {
    expect(fitWithin(8000, 6000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600)).toEqual({ width: 1600, height: 1600 });
    expect(fitWithin(0, 10)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(10000, 1)).toEqual({ width: 1600, height: 1 });
  });
});

describe("sniffPhotoKind", () => {
  it("reads the magic bytes, not the name", async () => {
    expect(sniffPhotoKind(await makeGpsJpeg(80, 60))).toBe("jpeg");
    expect(sniffPhotoKind(await flat(4, 4).png().toBuffer())).toBe("png");
    expect(sniffPhotoKind(await flat(4, 4).webp().toBuffer())).toBe("webp");
    expect(sniffPhotoKind(makeHeicLike())).toBeNull();
    expect(sniffPhotoKind(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffPhotoKind(new Uint8Array(0))).toBeNull();
  });
});

describe("processPhoto", () => {
  it("strips EXIF and GPS, applies orientation and fits 1600", async () => {
    const out = await processPhoto(await makeGpsJpeg(4000, 3000));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.engine).toBe("sharp");
    expect([out.width, out.height]).toEqual([1200, 1600]); // Orientation 6 turned it upright
    expect(jpegCarriesMetadata(out.jpeg)).toBe(false);
    const meta = await sharp(out.jpeg).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it("does not enlarge a small photo", async () => {
    const out = await processPhoto(await flat(300, 200).jpeg().toBuffer());
    expect(out).toMatchObject({ ok: true, width: 300, height: 200 });
  });

  it("refuses HEIC and garbage", async () => {
    expect(await processPhoto(makeHeicLike())).toMatchObject({ ok: false, status: 415 });
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb]), Buffer.alloc(64, 1)]);
    expect(await processPhoto(broken)).toMatchObject({ ok: false, status: 422 });
  });

  it("without sharp: refuses a JPEG with an Exif segment and every non-JPEG, passes a clean JPEG", async () => {
    expect(await processPhoto(await makeGpsJpeg(80, 60), { sharp: null })).toMatchObject({ ok: false, status: 422 });
    expect(await processPhoto(await flat(4, 4).png().toBuffer(), { sharp: null })).toMatchObject({
      ok: false,
      status: 415,
    });
    expect(await processPhoto(await flat(40, 30).jpeg().toBuffer(), { sharp: null })).toMatchObject({
      ok: true,
      engine: "passthrough",
    });
  });
});

describe("jpegCarriesMetadata", () => {
  it("flags APP1 (Exif, XMP) and anything that does not parse", async () => {
    expect(jpegCarriesMetadata(await makeGpsJpeg(80, 60))).toBe(true);
    const clean = await flat(40, 30).jpeg().toBuffer();
    expect(jpegCarriesMetadata(clean)).toBe(false);
    const withXmp = await sharp(clean).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>').jpeg().toBuffer();
    expect(jpegCarriesMetadata(withXmp)).toBe(true);
    expect(jpegCarriesMetadata(Buffer.from([0xff, 0xd8]))).toBe(true);
    expect(jpegCarriesMetadata(Buffer.from("not a jpeg"))).toBe(true);
  });

  it("passes plain baseline, progressive and restart-interval JPEGs", async () => {
    expect(jpegCarriesMetadata(await flat(64, 48).jpeg({ progressive: true }).toBuffer())).toBe(false);
    expect(jpegCarriesMetadata(await makeGpsJpeg(400, 300).then((j) => sharp(j).jpeg().toBuffer()))).toBe(false);
    const plain = await flat(40, 30).jpeg().toBuffer();
    expect(jpegCarriesMetadata(withSegment(plain, 0xdd, Buffer.from([0x00, 0x00])))).toBe(false);
  });
});

/** A copy of `jpeg` with one extra segment straight after SOI. */
function withSegment(jpeg: Buffer, marker: number, payload: Buffer): Buffer {
  const len = payload.length + 2;
  const seg = Buffer.concat([Buffer.from([0xff, marker, len >> 8, len & 0xff]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), seg, jpeg.subarray(2)]);
}

let clean40x30: Buffer;
const SECRET = "51.5072N 0.1276W Hidden Street";

describe("without sharp: the strict passthrough refuses every carrier", () => {
  beforeAll(async () => {
    clean40x30 = await flat(40, 30).jpeg().toBuffer();
  });

  const carriers: [string, () => Buffer][] = [
    ["a COM comment", () => withSegment(clean40x30, 0xfe, Buffer.from(SECRET))],
    ["an APP2 MPF segment", () => withSegment(clean40x30, 0xe2, Buffer.from(`MPF\0${SECRET}`))],
    [
      "an APP11 JUMBF/C2PA segment",
      () => withSegment(clean40x30, 0xeb, Buffer.concat([Buffer.from("JP\0\x01\0\0\0\x01"), Buffer.from(`jumb${SECRET}`)])),
    ],
    ["a trailer after EOI", () => Buffer.concat([clean40x30, Buffer.from(`ftypmp42${SECRET}`)])],
    ["an embedded second JPEG after EOI", () => Buffer.concat([clean40x30, clean40x30])],
    ["a JFXX (non-JFIF) APP0", () => withSegment(clean40x30, 0xe0, Buffer.from(`JFXX\0${SECRET}`))],
    ["an APP14 Adobe segment", () => withSegment(clean40x30, 0xee, Buffer.from(`Adobe${SECRET}`))],
  ];

  it.each(carriers)("refuses %s", async (_name, make) => {
    const input = make();
    expect(input.includes(SECRET) || _name.includes("second JPEG")).toBe(true);
    expect(jpegCarriesMetadata(input)).toBe(true);
    expect(await processPhoto(input, { sharp: null })).toMatchObject({ ok: false, status: 422 });
  });

  it("still passes the same JPEG with nothing added", async () => {
    expect(await processPhoto(clean40x30, { sharp: null })).toMatchObject({ ok: true, engine: "passthrough" });
  });
});
