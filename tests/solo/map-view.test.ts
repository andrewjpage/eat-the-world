import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MapView } from "@solo/components/MapView";

describe("MapView", () => {
  // The bundled seed always has London suggestions, so a pin-less map cannot be reached through the
  // app; this is the only place its empty state is exercised.
  it("shows an empty state with a way forward, and no map, when there are no pins", () => {
    const html = renderToStaticMarkup(createElement(MapView, { pins: [] }));

    expect(html).toContain("No pins yet");
    expect(html).toContain('href="#/check-in"');
    expect(html).toContain("Log a visit");
    expect(html).not.toContain("Unrolling the map");
    expect(html).not.toContain("leaflet");
  });
});
