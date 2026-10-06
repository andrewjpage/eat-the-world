import type { Geometry } from "geojson";

/** Pure geometry for the world view: joins, "too small to see" and where to put a dot. */

/**
 * A country whose shape covers less than this (summed planar area, square degrees) is too small to
 * see at world scale and gets a dot as well (the dots drop away once you zoom in). Mauritius is
 * 0.17, Singapore 0.04, Cyprus 0.7; Fiji is about 1.8 and stays a shape.
 */
export const SMALL_AREA_DEG2 = 1.0;

/**
 * Countries the 50m atlas has no shape for (as ISO 3166 alpha-2 -> [lat, lon]). They still get a
 * dot, so a Tuvalu check-in is not invisible. Keyed by alpha-2 because the atlas has no id for them.
 */
export const FALLBACK_DOTS: Readonly<Record<string, readonly [number, number]>> = {
  BQ: [12.18, -68.25], // Bonaire, Sint Eustatius and Saba
  BV: [-54.42, 3.36], // Bouvet Island
  CC: [-12.17, 96.83], // Cocos (Keeling) Islands
  CX: [-10.49, 105.63], // Christmas Island
  GF: [4.0, -53.0], // French Guiana
  GI: [36.14, -5.35], // Gibraltar
  GP: [16.25, -61.58], // Guadeloupe
  MQ: [14.64, -61.02], // Martinique
  RE: [-21.12, 55.54], // Réunion
  SJ: [78.0, 16.0], // Svalbard and Jan Mayen
  TK: [-9.2, -171.85], // Tokelau
  TV: [-8.52, 179.2], // Tuvalu
  UM: [19.3, 166.63], // US Minor Outlying Islands (Wake Island)
  YT: [-12.83, 45.17], // Mayotte
};

/** world-atlas ids are zero-padded strings ("004"); countries.iso_numeric is the same. */
export function normNumeric(id: string | number | null | undefined): string | null {
  if (id === null || id === undefined || id === "") return null;
  const s = String(id).trim();
  return /^\d{1,3}$/.test(s) ? s.padStart(3, "0") : null;
}

type Position = number[];

/**
 * Natural Earth cuts shapes at the antimeridian and the atlas stitches them back into one ring, so
 * a ring can jump from lon 179.9 to -180. A flat map draws that jump as a line across the world.
 * Re-walk each ring so consecutive longitudes never differ by more than 180 (Chukotka then sits
 * just past +180, which the map's bounds allow). A ring that does not close afterwards went round
 * the world (Fiji's sliver along its cut line) and is dropped.
 */
function unwrapRing(ring: Position[]): Position[] | null {
  if (ring.length === 0) return null;
  const out: Position[] = [[...ring[0]]];
  let offset = 0;
  for (let i = 1; i < ring.length; i++) {
    const jump = ring[i][0] - ring[i - 1][0];
    if (jump > 180) offset -= 360;
    else if (jump < -180) offset += 360;
    out.push([ring[i][0] + offset, ...ring[i].slice(1)]);
  }
  return out[out.length - 1][0] === out[0][0] ? out : null;
}

export function fixAntimeridian(g: Geometry): Geometry {
  const polygon = (rings: Position[][]): Position[][] | null => {
    const outer = unwrapRing(rings[0]);
    if (!outer) return null;
    return [outer, ...rings.slice(1).map(unwrapRing).filter((r): r is Position[] => r !== null)];
  };
  if (g.type === "Polygon") {
    const p = polygon(g.coordinates);
    return p ? { type: "Polygon", coordinates: p } : { type: "MultiPolygon", coordinates: [] };
  }
  if (g.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: g.coordinates.map(polygon).filter((p): p is Position[][] => p !== null),
    };
  }
  return g;
}

/** Outer rings of a (Multi)Polygon. Other geometry types have none. */
function outerRings(g: Geometry): Position[][] {
  if (g.type === "Polygon") return [g.coordinates[0]];
  if (g.type === "MultiPolygon") return g.coordinates.map((p) => p[0]);
  return [];
}

function ringArea(ring: Position[]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a / 2);
}

/** Summed planar area of the outer rings, in square degrees (a size test, not a real area). */
export function areaDeg2(g: Geometry): number {
  return outerRings(g).reduce((sum, r) => sum + ringArea(r), 0);
}

export function isSmall(g: Geometry): boolean {
  return areaDeg2(g) < SMALL_AREA_DEG2;
}

/**
 * Where to draw the dot, as [lat, lon]: the middle of the largest piece's bounding box. (Not the
 * centroid of everything: Fiji and Kiribati straddle the antimeridian and would land mid-ocean.)
 */
export function dotPoint(g: Geometry): [number, number] | null {
  let best: Position[] | null = null;
  let bestArea = -1;
  for (const ring of outerRings(g)) {
    const a = ringArea(ring);
    if (a > bestArea) {
      best = ring;
      bestArea = a;
    }
  }
  if (!best || best.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of best) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return [(minY + maxY) / 2, (minX + maxX) / 2];
}
