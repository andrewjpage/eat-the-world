"use client";

import dynamic from "next/dynamic";
import type { Pin } from "./pins";

/** Leaflet touches `window`, so the map is never server-rendered; its chunk loads only on /map. */
const LondonMap = dynamic(() => import("./LondonMap"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-paper-sunk text-sm font-semibold text-muted">
      Unrolling the map…
    </div>
  ),
});

export function MapLoader({ pins }: { pins: Pin[] }) {
  return <LondonMap pins={pins} />;
}
