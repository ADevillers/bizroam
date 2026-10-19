import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Navigation } from "lucide-react";
import {
  sourcedCompanyValue,
  valueRadius,
  formatCompanyValue,
  companyValueKind,
} from "../../../packages/shared/src/company-value";
import type {
  CompanyCandidate,
  LocationSample,
} from "../../../packages/shared/src/schema";

export function MapView({
  position,
  candidates,
  onSelect,
  recenter,
}: {
  position: LocationSample | null;
  candidates: CompanyCandidate[];
  onSelect: (id: string) => void;
  recenter: number;
}) {
  const el = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    person = useRef<L.CircleMarker | null>(null),
    markers = useRef<L.LayerGroup | null>(null),
    follow = useRef(true);
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, {
      zoomControl: false,
      attributionControl: true,
      fadeAnimation: false,
    }).setView([37.7749, -122.4194], 16);
    map.current = m;
    m.attributionControl.setPrefix(false);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
      className: "osm-tiles",
      keepBuffer: 0,
      updateWhenIdle: true,
    })
      .on("tileerror", () => setFailed(true))
      .on("tileload", () => setFailed(false))
      .addTo(m);
    m.on("dragstart", () => {
      follow.current = false;
    });
    person.current = L.circleMarker([37.7749, -122.4194], {
      radius: 7,
      color: "#fff",
      weight: 3,
      fillColor: "#a7c8ef",
      fillOpacity: 0,
      opacity: 0,
    }).addTo(m);
    markers.current = L.layerGroup().addTo(m);
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(el.current);
    setReady(true);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
      person.current = null;
      markers.current = null;
    };
  }, []);
  useEffect(() => {
    if (!position || !map.current) return;
    const p: L.LatLngTuple = [position.lat, position.lng];
    person.current?.setLatLng(p).setStyle({ opacity: 1, fillOpacity: 1 });
    if (follow.current) map.current.panTo(p, { animate: false });
  }, [position, ready]);
  useEffect(() => {
    follow.current = true;
    if (position) map.current?.panTo([position.lat, position.lng]);
  }, [recenter]);
  useEffect(() => {
    const group = markers.current;
    const m = map.current;
    if (!group || !m) return;
    const draw = () => {
      group.clearLayers();
      const occupied: {
        x: number;
        y: number;
        width: number;
        height: number;
      }[] = [];
      const mapRect = el.current!.getBoundingClientRect();
      el.current!.closest('.map-wrap')?.querySelectorAll('.map-top, .map-bottom, .map-value-legend').forEach(node => {
        const r = node.getBoundingClientRect();
        occupied.push({ x: r.left - mapRect.left, y: r.top - mapRect.top, width: r.width, height: r.height });
      });
      let labelsPlaced = 0;
      const sorted = [...candidates].sort(
        (a, b) =>
          Number(Boolean(b.profile)) - Number(Boolean(a.profile)) ||
          (sourcedCompanyValue(b.profile)?.amountUsd || 0) -
            (sourcedCompanyValue(a.profile)?.amountUsd || 0) ||
          a.distance - b.distance,
      );
      for (const c of sorted) {
        const value = sourcedCompanyValue(c.profile);
        const radius = value ? valueRadius(value.amountUsd) : c.profile ? 8 : 5;
        const label = document.createElement("span");
        const name = document.createElement("strong");
        name.textContent = c.profile?.name || c.name;
        const meta = document.createElement("small");
        meta.textContent = value
          ? `${formatCompanyValue(value.amountUsd)} ${companyValueKind(value.kind)} · ${value.asOf}`
          : "Value N/A";
        label.append(name, meta);
        const pt = m.latLngToContainerPoint([c.lat, c.lng]);
        const width = Math.min(
          240,
          Math.max(125, name.textContent.length * 7 + 24, meta.textContent.length * 5 + 24),
        );
        const placements = [
          { direction: 'top' as const, x: pt.x - width / 2, y: pt.y - radius - 54, offset: [0, -radius] as [number, number] },
          { direction: 'bottom' as const, x: pt.x - width / 2, y: pt.y + radius + 12, offset: [0, radius] as [number, number] },
          { direction: 'right' as const, x: pt.x + radius + 12, y: pt.y - 23, offset: [radius, 0] as [number, number] },
          { direction: 'left' as const, x: pt.x - radius - width - 12, y: pt.y - 23, offset: [-radius, 0] as [number, number] },
        ];
        const placement = labelsPlaced < (m.getZoom() >= 17 ? 18 : 10) ? placements.find(box =>
          box.x >= 4 && box.x + width <= m.getSize().x - 4 && box.y >= 4 && box.y + 45 <= m.getSize().y - 4 &&
          !occupied.some(b => box.x < b.x + b.width + 8 && box.x + width + 8 > b.x && box.y < b.y + b.height + 8 && box.y + 53 > b.y)
        ) : undefined;
        const permanent = Boolean(placement);
        if (placement) { occupied.push({ ...placement, width, height: 45 }); labelsPlaced++; }
        const marker = L.circleMarker([c.lat, c.lng], {
          radius,
          color: "#1a2025",
          weight: 2,
          fillColor: value ? "#b8d2be" : c.profile ? "#f0ede6" : "#9aa5ad",
          fillOpacity: value ? 0.8 : 0.95,
        })
          .bindTooltip(label, {
            permanent,
            interactive: true,
            className: "company-map-label",
            direction: placement?.direction || "top",
            offset: placement?.offset || [0, -radius],
            opacity: 1,
          })
          .on("click", () => onSelect(c.id))
          .addTo(group);
        marker.getTooltip()?.on("click", () => onSelect(c.id));
      }
      person.current?.bringToFront();
    };
    draw();
    m.on("moveend zoomend resize", draw);
    return () => {
      m.off("moveend zoomend resize", draw);
    };
  }, [candidates, onSelect, ready]);
  return (
    <div className="map-stage">
      <div ref={el} className="live-map" aria-label="Map of nearby companies" />
      {failed && (
        <div className="map-error" role="status">
          Map connection interrupted. Your discoveries are still available.
        </div>
      )}
      {candidates.length > 0 && (
        <div className="map-value-legend">
          <span /> Reported value · log scale <b>N/A = unknown</b>
        </div>
      )}
      <div className="map-caption">
        <span className="live-dot" />
        {position
          ? "YOUR NEIGHBOURHOOD, UNCOVERED"
          : "A DIFFERENT WAY TO SEE YOUR CITY"}
      </div>
      <button
        className="map-recenter"
        aria-label="Recenter map"
        onClick={() => {
          follow.current = true;
          if (position) map.current?.panTo([position.lat, position.lng]);
        }}
      >
        <Navigation size={19} />
      </button>
    </div>
  );
}
