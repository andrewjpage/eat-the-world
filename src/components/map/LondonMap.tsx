"use client";

import "leaflet/dist/leaflet.css";
import "./map.css";
import L from "leaflet";
import { useCallback, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, ZoomControl, useMapEvents } from "react-leaflet";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Badge, ContestedBadge } from "@/components/ui/Badge";
import { Flag } from "@/components/ui/Flag";
import { TILE_CONFIG } from "@/lib/tiles";
import { formatDistance, nearestUnstamped, pinKey, pinSvg, type Pin } from "./pins";

const LONDON: L.LatLngTuple = [51.5136, -0.1196];
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

function Legend() {
  const item = (state: "new" | "stamped", ring: boolean, label: string) => (
    <li className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="grid h-[22px] w-5 shrink-0 place-items-center [&>svg]:h-[22px] [&>svg]:w-auto [&>svg]:overflow-visible"
        dangerouslySetInnerHTML={{ __html: pinSvg(state, ring) }}
      />
      {label}
    </li>
  );
  return (
    <div
      aria-label="Legend"
      role="group"
      className="pointer-events-auto rounded-xl border border-line bg-paper-raised/95 px-2.5 py-2 text-xs font-semibold text-ink shadow-[0_1px_6px_rgb(var(--shadow-ink)/0.18)]"
    >
      <ul className="space-y-0.5">
        {item("new", false, "New country")}
        {item("stamped", false, "Stamped")}
        {item("new", true, "A friend's been")}
      </ul>
    </div>
  );
}

function PinCard({ pin, onClose, distance }: { pin: Pin; onClose: () => void; distance: string | null }) {
  const place = [pin.address, pin.postcode].filter(Boolean).join(", ");
  return (
    <section
      aria-label={`${pin.name}, ${pin.countryName}`}
      className="pointer-events-auto animate-sheet-up rounded-2xl border border-line bg-paper-raised p-4 shadow-[0_-4px_20px_rgb(var(--shadow-ink)/0.2)]"
    >
      <div className="flex items-start gap-3">
        <Flag iso2={pin.country_iso2} size="lg" label={pin.countryName} />
        <div className="min-w-0 flex-1">
          <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-muted">
            {pin.countryName}
            {distance && <span className="normal-case tracking-normal"> · {distance} away</span>}
          </p>
          <h2 className="font-display text-xl leading-tight text-ink">{pin.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-full text-xl text-muted hover:bg-ink/5"
        >
          <span aria-hidden>×</span>
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {pin.state === "new" ? <Badge tone="red">New stamp for you</Badge> : <Badge tone="muted">Already stamped</Badge>}
        {pin.friendVisited && <Badge tone="neutral">A friend has been</Badge>}
        {pin.confidence === "flagged" && <ContestedBadge note={pin.curator_note} />}
        {pin.status === "reported_closed" && <Badge tone="gold">Reported closed</Badge>}
      </div>
      {place && <p className="mt-2 text-sm text-ink-soft">{place}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <ButtonLink href={`/check-in/${pin.id}`} prefetch={false} block>
          Check in
        </ButtonLink>
        <ButtonLink href={`/restaurant/${pin.id}`} prefetch={false} variant="secondary" block>
          Details
        </ButtonLink>
      </div>
    </section>
  );
}

/** The London map: Leaflet + OSM tiles, client only (loaded through MapLoader, never server-rendered). */
export default function LondonMap({ pins }: { pins: Pin[] }) {
  const mapRef = useRef<L.Map | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [distance, setDistance] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selected = pins.find((p) => p.id === selectedId) ?? null;
  const unstamped = pins.filter((p) => p.state === "new").length;

  const bounds = useMemo(
    () => (pins.length > 0 ? L.latLngBounds(pins.map((p) => [p.lat, p.lon] as L.LatLngTuple)) : null),
    [pins],
  );

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
        {...(bounds ? { bounds, boundsOptions: { padding: [48, 48], maxZoom: 13 } } : { center: LONDON, zoom: 12 })}
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
