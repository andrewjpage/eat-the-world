/**
 * Map tile source (brief section 7). Defaults to the OpenStreetMap standard layer, used under the
 * OSMF tile usage policy: visible attribution, the browser's default referrer policy, and no
 * prefetched or offline tiles.
 *
 * To swap provider (MapTiler, Stadia Maps, ...), set two env vars and redeploy; no code change:
 *   NEXT_PUBLIC_TILE_URL=https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=...
 *   NEXT_PUBLIC_TILE_ATTRIBUTION='&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
 */

export const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Shown when no attribution is configured. Leaflet renders it as HTML. */
export const DEFAULT_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** OSM's standard layer is served up to zoom 19. */
export const TILE_MAX_ZOOM = 19;

export interface TileConfig {
  url: string;
  attribution: string;
  maxZoom: number;
}

/** Blank or whitespace-only values count as unset, so an empty env var keeps the default. */
export function resolveTileConfig(url?: string | null, attribution?: string | null): TileConfig {
  return {
    url: url?.trim() || DEFAULT_TILE_URL,
    // The data is OpenStreetMap's whichever provider renders it, so the credit never goes missing.
    attribution: attribution?.trim() || DEFAULT_TILE_ATTRIBUTION,
    maxZoom: TILE_MAX_ZOOM,
  };
}

/** The live config. NEXT_PUBLIC_* values are inlined at build time, so they must be read literally. */
export const TILE_CONFIG: TileConfig = resolveTileConfig(
  process.env.NEXT_PUBLIC_TILE_URL,
  process.env.NEXT_PUBLIC_TILE_ATTRIBUTION,
);
