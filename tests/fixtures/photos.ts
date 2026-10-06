/**
 * Photo fixtures, generated on demand so no binary lives in the repo.
 *
 *  - makeGpsJpeg: a phone-style photo, 8000 x 6000, with camera details, a caption and a GPS
 *    position in its EXIF, and Orientation 6 (rotate 90 degrees), the way an iPhone held
 *    upright writes it. Smooth content, so it is well under the 4.5 MB upload limit.
 *  - makeHeicLike: the first bytes of a HEIC file (an ISO-BMFF "ftyp heic" box): the
 *    format the route does not accept.
 */
import sharp from "sharp";

export const FIXTURE_GPS = { lat: "51/1 30/1 26/1", lon: "0/1 7/1 39/1" };

export async function makeGpsJpeg(width = 8000, height = 6000): Promise<Buffer> {
  const w = 400;
  const h = 300;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = Math.round((x / w) * 255);
      raw[i + 1] = Math.round((y / h) * 255);
      raw[i + 2] = (x + y) % 64 < 32 ? 200 : 60;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .resize(width, height, { kernel: "cubic" })
    .withExif({
      IFD0: {
        Make: "EtwTestCam",
        Model: "Secret Phone 15",
        ImageDescription: "Dinner at my flat, 12 Hidden Street",
        DateTime: "2026:10:05 19:30:00",
      },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: FIXTURE_GPS.lat,
        GPSLongitudeRef: "W",
        GPSLongitude: FIXTURE_GPS.lon,
      },
    })
    .withMetadata({ orientation: 6 }) // sharp writes the Orientation tag itself
    .jpeg({ quality: 70 })
    .toBuffer();
}

export function makeHeicLike(): Buffer {
  const head = Buffer.from([0x00, 0x00, 0x00, 0x18]);
  return Buffer.concat([head, Buffer.from("ftypheic"), Buffer.alloc(4), Buffer.from("mif1heic"), Buffer.alloc(2048, 7)]);
}
