// A copy of src/components/map/LondonMap.tsx. KEEP IN STEP with it; delete this and MapCards.tsx once
// LondonMap takes optional props for the wording and the check-in link. Why it is a copy, and the other
// two copies: docs/solo.md, "Known copies of shared components".
// Intentional differences from LondonMap (the first three live in MapCards.tsx):
//  - the ring reads "You've been here", not "A friend's been" / "A friend has been";
//  - the card's action is "Log a visit", linking to /check-in?restaurant=<id>, not "Check in" to /check-in/<id>;
//  - no "Reported closed" badge (solo restaurants have no status);
//  - no empty-map fallback centred on London: MapView shows an empty state instead of rendering this with no pins.
import "leaflet/dist/leaflet.css";
import "@/components/map/map.css";
import L from "leaflet";
import { useCallback, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, ZoomControl, useMapEvents } from "react-leaflet";
import { Button } from "@/components/ui/Button";
import { formatDistance, nearestUnstamped, pinKey, pinSvg, type Pin } from "@/components/map/pins";
import { TILE_CONFIG } from "@/lib/tiles";
import { Legend, PinCard } from "./MapCards";

/** Pixels the pin sits above the map centre while its card is open (the card covers the bottom). */
const CARD_OFFSET_PX = 110;

/** At most eight icons exist (state x ring x selected), so they are made once and shared. */
const iconCache = new Map<string, L.DivIcon>();
function pinIcon(p: Pin, selected: boolean): L.DivIcon {
  const key = pinKey(p, selected);
  let icon = iconCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: `etw-pin${selected ? " etw-pin-sel" : ""}`,
      html: pinSvg(p.state, p.friendVisited),
      iconSize: [44, 46],
      iconAnchor: [22, 44],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

function ClearOnMapTap({ onTap }: { onTap: () => void }) {
  useMapEvents({ click: onTap });
  return null;
}

/**
 * The London map for solo mode: Leaflet and OpenStreetMap tiles, framed on the pins. The same
 * behaviour as the group app's map (it cannot be reused as it is: its card is worded for friends and
 * links to the group app's check-in route), so the pieces that are shared come from `src/`.
 * Loaded only through MapView, never at start-up.
 */
export default function SoloMap({ pins }: { pins: Pin[] }) {
  const mapRef = useRef<L.Map | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [distance, setDistance] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selected = pins.find((p) => p.id === selectedId) ?? null;
  const unstamped = pins.filter((p) => p.state === "new").length;

  const bounds = useMemo(() => L.latLngBounds(pins.map((p) => [p.lat, p.lon] as L.LatLngTuple)), [pins]);

  /** Centre the pin in the part of the map the card leaves free. */
  const centreOn = useCallback((pin: Pin, zoom: number, fly: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    const at = map.project([pin.lat, pin.lon], zoom);
    const target = map.unproject(at.add([0, CARD_OFFSET_PX]), zoom);
    if (fly) map.flyTo(target, zoom, { duration: 1.1 });
    else map.setView(target, zoom, { animate: true });
  }, []);

  const select = useCallback(
    (pin: Pin, opts: { fly: boolean; distance?: string | null }) => {
      setSelectedId(pin.id);
      setDistance(opts.distance ?? null);
      const map = mapRef.current;
      if (!map) return;
      const zoom = opts.fly ? Math.max(map.getZoom(), 15) : map.getZoom();
      centreOn(pin, zoom, opts.fly);
    },
    [centreOn],
  );

  const findNearest = () => {
    setMessage(null);
    if (unstamped === 0) {
      setMessage("You have a stamp for every country London lists. Nothing left to chase.");
      return;
    }
    if (!("geolocation" in navigator)) {
      setMessage("This browser can't share your location. Browse the red pins instead.");
      return;
    }
    setLocating(true);
    // One request per tap. The position is used inside this callback to pick a pin and is never
    // stored, sent or logged; only the resulting distance is shown.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const hit = nearestUnstamped({ lat: pos.coords.latitude, lon: pos.coords.longitude }, pins);
        if (!hit) {
          setMessage("Nothing to show.");
          return;
        }
        select(hit.pin, { fly: true, distance: formatDistance(hit.distanceM) });
      },
      (err) => {
        setLocating(false);
        setMessage(
          err.code === err.PERMISSION_DENIED
            ? "Location is off, so I can't tell where you are. Browse the red pins, or allow location for this site and try again."
            : "Couldn't find you just now. Browse the red pins, or try again.",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  return (
    <div className="relative h-full w-full">
      <MapContainer
        ref={mapRef}
        bounds={bounds}
        boundsOptions={{ padding: [48, 48], maxZoom: 13 }}
        minZoom={9}
        zoomControl={false}
        className="h-full w-full"
      >
        <TileLayer
          url={TILE_CONFIG.url}
          attribution={TILE_CONFIG.attribution}
          maxZoom={TILE_CONFIG.maxZoom}
          className="etw-tiles"
        />
        <ZoomControl position="topright" />
        <ClearOnMapTap
          onTap={() => {
            setSelectedId(null);
            setMessage(null);
          }}
        />
        {pins.map((p) => (
          <Marker
            key={p.id}
            position={[p.lat, p.lon]}
            icon={pinIcon(p, p.id === selectedId)}
            title={`${p.name} (${p.countryName})`}
            zIndexOffset={p.id === selectedId ? 2000 : p.state === "new" ? 600 : p.friendVisited ? 300 : 0}
            eventHandlers={{ click: () => select(p, { fly: false }) }}
          />
        ))}
      </MapContainer>

      {/* Overlays sit above Leaflet's panes (z 400-700) and controls (z 800-1000). */}
      <div className="pointer-events-none absolute top-3 left-3 z-[1000]">
        <Legend />
      </div>
      <div className="pointer-events-none absolute inset-x-3 bottom-8 z-[1000] mx-auto flex max-w-md flex-col gap-2">
        {message && (
          <p
            role="status"
            className="pointer-events-auto rounded-xl border border-line bg-paper-raised px-3.5 py-2.5 text-sm text-ink shadow-[0_1px_6px_rgb(var(--shadow-ink)/0.18)]"
          >
            {message}
          </p>
        )}
        {selected ? (
          <PinCard pin={selected} distance={distance} onClose={() => setSelectedId(null)} />
        ) : (
          <div className="flex justify-center">
            <Button
              size="lg"
              loading={locating}
              onClick={findNearest}
              className="pointer-events-auto shadow-[0_3px_10px_rgb(var(--shadow-ink)/0.3)]"
            >
              {locating ? "Finding you…" : "Nearest unstamped"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
