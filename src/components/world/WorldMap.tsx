"use client";

import "leaflet/dist/leaflet.css";
import "../map/map.css";
import L from "leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { dotPoint, FALLBACK_DOTS, fixAntimeridian, isSmall, normNumeric } from "./geometry";
import { byNumeric, type CountryState, type WorldCountry, type WorldState } from "./states";

/** Zoom level at which small countries are big enough to tap as shapes, so the dots go away. */
const DOT_MAX_ZOOM = 4.5;
/** Antarctica's id in the atlas; Mercator stretches it to nothing useful. */
const ANTARCTICA = "010";

interface Palette {
  ocean: string;
  land: string;
  raised: string;
  ink: string;
  inkSoft: string;
  red: string;
  sepia: string;
  page: string;
}

const VARS = ["--paper-sunk", "--line", "--paper-raised", "--ink", "--ink-soft", "--stamp-red", "--gold", "--paper"];

/** Design tokens are CSS variables; the canvas needs real colours, so read them (and follow dark mode). */
function readPalette(): string {
  const cs = getComputedStyle(document.documentElement);
  return VARS.map((v) => cs.getPropertyValue(v).trim()).join("|");
}

function subscribeScheme(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function usePalette(): Palette | null {
  const raw = useSyncExternalStore(subscribeScheme, readPalette, () => "");
  if (!raw) return null;
  const [ocean, land, raised, ink, inkSoft, red, sepia, page] = raw.split("|");
  return { ocean, land, raised, ink, inkSoft, red, sepia, page };
}

const STATE_LABEL: Record<WorldState, string> = {
  stamped: "stamped",
  backfilled: "before the app",
  listed: "on the London list, not stamped yet",
  neutral: "",
};

function pathStyle(s: CountryState, p: Palette, hasId: boolean): L.PathOptions {
  switch (s.state) {
    case "stamped":
      return { fillColor: p.red, fillOpacity: 0.35 + 0.65 * s.share, color: p.raised, weight: 0.6, opacity: 1 };
    case "backfilled":
      return { fillColor: p.sepia, fillOpacity: 0.6, color: p.raised, weight: 0.6, opacity: 1 };
    case "listed":
      return { fillColor: p.raised, fillOpacity: 0.9, color: p.inkSoft, weight: 1.4, opacity: 1 };
    default:
      return { fillColor: p.land, fillOpacity: hasId ? 1 : 0.5, color: p.page, weight: 0.6, opacity: 0.9 };
  }
}

function dotStyle(s: CountryState, p: Palette): L.CircleMarkerOptions {
  switch (s.state) {
    case "stamped":
      return { radius: 6, fillColor: p.red, fillOpacity: 0.45 + 0.55 * s.share, color: p.raised, weight: 1.5, opacity: 1 };
    case "backfilled":
      return { radius: 6, fillColor: p.sepia, fillOpacity: 0.75, color: p.raised, weight: 1.5, opacity: 1 };
    case "listed":
      return { radius: 5, fillColor: p.raised, fillOpacity: 1, color: p.ink, weight: 1.8, opacity: 1 };
    default:
      return { radius: 3, fillColor: p.land, fillOpacity: 1, color: p.inkSoft, weight: 0.8, opacity: 0.45 };
  }
}

interface Shape {
  iso2: string | null;
  name: string;
  path?: L.Path;
  dot?: L.CircleMarker;
}

/**
 * The world as a tile-less Leaflet map: countries-50m drawn on a canvas, so pan and pinch-zoom come
 * free and small countries can be zoomed into. Loaded only through WorldLoader (client, no SSR),
 * and the 750 KB topojson is a dynamic import inside, so no other screen pays for either.
 */
export default function WorldMap({
  countries,
  states,
}: {
  countries: WorldCountry[];
  states: ReadonlyMap<string, CountryState>;
}) {
  const router = useRouter();
  const palette = usePalette();
  const box = useRef<HTMLDivElement>(null);
  const shapes = useRef<Shape[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Latest values for handlers that outlive a render.
  const statesRef = useRef(states);
  const openRef = useRef((iso2: string) => router.push(`/country/${iso2}`));
  useEffect(() => {
    statesRef.current = states;
    openRef.current = (iso2: string) => router.push(`/country/${iso2}`);
  });

  // Build the map once. Everything that changes with the view is applied by the effect below.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    const renderer = L.canvas({ padding: 0.5, tolerance: 6 });
    const map = L.map(el, {
      renderer,
      zoomControl: false,
      attributionControl: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      minZoom: 0,
      maxZoom: 8,
      // A little past +/-180 so Chukotka (which the unwrapped ring puts beyond +180) stays in view.
      maxBounds: [
        [-62, -190],
        [86, 196],
      ],
      maxBoundsViscosity: 1,
    });
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution(
      'Borders: <a href="https://www.naturalearthdata.com/">Natural Earth</a> via world-atlas',
    );
    L.control.zoom({ position: "topright" }).addTo(map);
    map.fitBounds(
      [
        [-56, -168],
        [78, 178],
      ],
      { animate: false },
    );
    map.setMinZoom(map.getZoom() - 0.5);

    const toName = (iso2: string | null, fallback: string) =>
      (iso2 && countries.find((c) => c.iso2 === iso2)?.name) || fallback;
    const label = (sh: Shape) => {
      const s = sh.iso2 ? statesRef.current.get(sh.iso2) : undefined;
      const extra = s ? STATE_LABEL[s.state] : "";
      return extra ? `${sh.name}: ${extra}` : sh.name;
    };

    (async () => {
      try {
        const [topo, { feature }] = await Promise.all([
          import("world-atlas/countries-50m.json"),
          import("topojson-client"),
        ]);
        if (cancelled) return;
        const atlas = (topo as { default?: unknown }).default ?? topo;
        const fc = feature(
          atlas as Parameters<typeof feature>[0],
          (atlas as { objects: { countries: never } }).objects.countries,
        ) as unknown as FeatureCollection<Geometry, { name?: string }>;
        const byNum = byNumeric(countries);
        const dots = L.layerGroup();
        const list: Shape[] = [];

        const flat = {
          ...fc,
          features: fc.features.map((f) => ({ ...f, geometry: fixAntimeridian(f.geometry) })),
        };
        const polys = L.geoJSON(flat, {
          filter: (f) => normNumeric(f.id) !== ANTARCTICA,
          onEachFeature: (f: Feature<Geometry, { name?: string }>, layer) => {
            const iso2 = byNum.get(normNumeric(f.id) ?? "")?.iso2 ?? null;
            const sh: Shape = { iso2, name: toName(iso2, f.properties?.name ?? "Unclaimed land"), path: layer as L.Path };
            list.push(sh);
            layer.bindTooltip(() => label(sh), { sticky: true, direction: "top" });
            if (iso2) layer.on("click", () => openRef.current(iso2));
            if (iso2 && isSmall(f.geometry)) {
              const at = dotPoint(f.geometry);
              if (at) sh.dot = L.circleMarker(at, { bubblingMouseEvents: false });
            }
          },
        });
        // Countries the atlas has no shape for still get a dot.
        const have = new Set(list.map((s) => s.iso2));
        for (const [iso2, at] of Object.entries(FALLBACK_DOTS)) {
          if (have.has(iso2) || !countries.some((c) => c.iso2 === iso2)) continue;
          list.push({ iso2, name: toName(iso2, iso2), dot: L.circleMarker([...at] as L.LatLngTuple) });
        }
        polys.addTo(map);
        for (const sh of list) {
          if (!sh.dot) continue;
          const iso2 = sh.iso2;
          sh.dot.bindTooltip(() => label(sh), { direction: "top" });
          if (iso2) sh.dot.on("click", () => openRef.current(iso2));
          dots.addLayer(sh.dot);
        }
        dots.addTo(map);
        const syncDots = () => {
          const show = map.getZoom() < DOT_MAX_ZOOM;
          if (show && !map.hasLayer(dots)) dots.addTo(map);
          else if (!show && map.hasLayer(dots)) map.removeLayer(dots);
        };
        map.on("zoomend", syncDots);
        shapes.current = list;
        // For the e2e suite: which countries drew a tap dot (the dots live on a canvas).
        el.dataset.dots = list.flatMap((s) => (s.dot && s.iso2 ? [s.iso2] : [])).join(",");
        setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      shapes.current = [];
      map.remove();
    };
  }, [countries]);

  // Paint: runs when the atlas is ready, the view (mine / a group) changes, or the colour scheme flips.
  useEffect(() => {
    if (!ready || !palette) return;
    const rank: Record<WorldState, number> = { neutral: 0, listed: 1, backfilled: 2, stamped: 3 };
    const dots: { dot: L.CircleMarker; rank: number }[] = [];
    for (const sh of shapes.current) {
      const s = (sh.iso2 && states.get(sh.iso2)) || { state: "neutral" as const, share: 0 };
      sh.path?.setStyle(pathStyle(s, palette, sh.iso2 !== null));
      if (sh.dot) {
        sh.dot.setStyle(dotStyle(s, palette));
        dots.push({ dot: sh.dot, rank: rank[s.state] });
      }
    }
    // Crowded dots (the Levant, the Caribbean): the ones that matter sit on top, so they win the tap.
    dots.sort((a, b) => a.rank - b.rank).forEach((d) => d.dot.bringToFront());
  }, [ready, palette, states]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={box}
        role="application"
        aria-label="World map. Tap a country to open it."
        className="h-full w-full"
        style={{ background: palette?.ocean }}
      />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm font-semibold text-muted">
          {failed ? "Couldn't load the map. Refresh to try again." : "Spinning up the globe…"}
        </div>
      )}
    </div>
  );
}
