import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Site } from '../core/analysis';
import { fmtLat, fmtLon, type SiteCatalog } from '../core/sites';
import { Icon } from './Icon';

const R_KM = 1737.4;
const D = Math.PI / 180;

export function toStereo(lat: number, lon: number): [number, number] {
  const rho = 2 * R_KM * Math.tan(((90 + lat) * D) / 2);
  return [rho * Math.sin(lon * D), rho * Math.cos(lon * D)];
}

export function fromStereo(x: number, y: number): [number, number] {
  const rho = Math.hypot(x, y);
  const lat = -90 + (2 * Math.atan(rho / (2 * R_KM))) / D;
  const lon = ((Math.atan2(x, y) / D) % 360 + 360) % 360;
  return [lat, lon];
}

interface Pick {
  siteId?: string;
  lat: number;
  lon: number;
}

interface Props {
  catalog: SiteCatalog;
  current: Site | null;
  onPick: (p: Pick) => void;
  onClose: () => void;
}

const GROUP_COLOR: Record<string, string> = {
  'Best-lit south pole points': '#f5af0c',
  'NASA candidate regions (Oct 2024)': '#0cc9ac',
  'South polar landings': '#ffffff',
};

export function PolarMapDialog({ catalog, current, onPick, onClose }: Props) {
  const el = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [picked, setPicked] = useState<Pick | null>(null);
  const pickedLayer = useRef<L.CircleMarker | null>(null);
  const overlays = useRef<{ sun?: L.ImageOverlay; earth?: L.ImageOverlay }>({});
  const [layer, setLayer] = useState<'none' | 'sun' | 'earth'>('sun');

  const dialog = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Escape closes; Tab stays inside the dialog; focus returns to where it was on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, [tabindex]:not([tabindex="-1"])')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (!el.current) return;
    const half = 304;
    const map = L.map(el.current, {
      crs: L.CRS.Simple,
      minZoom: -2,
      maxZoom: 5,
      zoomSnap: 0.25,
      attributionControl: true,
      maxBounds: L.latLngBounds([-half * 1.2, -half * 1.2], [half * 1.2, half * 1.2]),
    });
    L.imageOverlay('data/map/south_pole_hillshade.webp', [
      [-half, -half],
      [half, half],
    ]).addTo(map);
    const ob: L.LatLngBoundsExpression = [
      [-half, -half],
      [half, half],
    ];
    overlays.current = {
      sun: L.imageOverlay('data/map/sun_visibility.webp', ob, { opacity: 0.85 }),
      earth: L.imageOverlay('data/map/earth_visibility.webp', ob, { opacity: 0.85 }),
    };
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution('Visibility: NASA PGDA, Mazarico et al. 2011');
    map.attributionControl.addAttribution('Terrain: NASA LRO LOLA, Barker et al. 2023');
    const start = current && current.lat < -80 ? toStereo(current.lat, current.lon) : [0, 0];
    map.setView([start[1], start[0]], current && current.lat < -80 ? 0.5 : -1);

    // Latitude rings every degree from 80S to 89S, meridians every 30 deg.
    for (let lat = -89; lat <= -80; lat++) {
      const r = toStereo(lat, 0)[1];
      L.circle([0, 0], { radius: r, color: '#ffffff', weight: 0.6, opacity: lat % 5 === 0 ? 0.35 : 0.15, fill: false, interactive: false }).addTo(map);
    }
    for (let lon = 0; lon < 360; lon += 30) {
      const [x, y] = toStereo(-80, lon);
      L.polyline(
        [
          [0, 0],
          [y, x],
        ],
        { color: '#ffffff', weight: 0.6, opacity: 0.15, interactive: false },
      ).addTo(map);
      const [lx, ly] = toStereo(-80.6, lon);
      L.marker([ly, lx], {
        interactive: false,
        icon: L.divIcon({ className: 'map-label', html: `${lon}°E`, iconSize: [40, 14], iconAnchor: [20, 7] }),
      }).addTo(map);
    }

    for (const s of catalog.sites) {
      if (s.lat > -79.5) continue;
      const [x, y] = toStereo(s.lat, s.lon);
      const m = L.circleMarker([y, x], {
        radius: 6,
        color: '#000000',
        weight: 1.5,
        fillColor: GROUP_COLOR[s.group] ?? '#ffffff',
        fillOpacity: 1,
      }).addTo(map);
      m.bindTooltip(`${s.short ?? s.name}`, { direction: 'top', offset: [0, -6] });
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        setPicked({ siteId: s.id, lat: s.lat, lon: s.lon });
      });
    }

    map.on('mousemove', (e: L.LeafletMouseEvent) => setHover(fromStereo(e.latlng.lng, e.latlng.lat)));
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (Math.abs(e.latlng.lng) > half || Math.abs(e.latlng.lat) > half) return;
      const [lat, lon] = fromStereo(e.latlng.lng, e.latlng.lat);
      setPicked({ lat: +lat.toFixed(5), lon: +lon.toFixed(5) });
    });
    const mapRef = map;
    (el.current as unknown as { _map: L.Map })._map = mapRef;
    return () => {
      map.remove();
    };
  }, [catalog, current]);

  useEffect(() => {
    const map = (el.current as unknown as { _map?: L.Map } | null)?._map;
    if (!map) return;
    const { sun, earth } = overlays.current;
    sun?.remove();
    earth?.remove();
    if (layer === 'sun') sun?.addTo(map);
    if (layer === 'earth') earth?.addTo(map);
    sun?.bringToBack();
    earth?.bringToBack();
    map.eachLayer((l) => {
      if (l instanceof L.ImageOverlay && l !== sun && l !== earth) l.bringToBack();
    });
  }, [layer, catalog, current]);

  useEffect(() => {
    const map = (el.current as unknown as { _map?: L.Map } | null)?._map;
    if (!map) return;
    pickedLayer.current?.remove();
    if (picked) {
      const [x, y] = toStereo(picked.lat, picked.lon);
      pickedLayer.current = L.circleMarker([y, x], { radius: 9, color: '#ffffff', weight: 2, fill: false }).addTo(map);
    }
  }, [picked]);

  const pickedSite = picked?.siteId ? catalog.sites.find((s) => s.id === picked.siteId) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={dialog} className="modal panel" role="dialog" aria-modal="true" aria-label="South pole map" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 className="dialog-title">South pole, 80° to 90° S</h2>
          <button className="btn small ghost" type="button" onClick={onClose} aria-label="Close map">
            Close
          </button>
        </div>
        <div className="legend" style={{ marginBottom: 8 }}>
          <span>
            <i className="round" style={{ background: GROUP_COLOR['Best-lit south pole points'] }} />
            Best-lit points
          </span>
          <span>
            <i className="round" style={{ background: GROUP_COLOR['NASA candidate regions (Oct 2024)'] }} />
            NASA candidate regions
          </span>
          <span>
            <i className="round" style={{ background: GROUP_COLOR['South polar landings'] }} />
            Landings
          </span>
          <span style={{ color: 'var(--muted)' }}>Click a marker, or click anywhere to set your own point.</span>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
          <div className="chips" role="group" aria-label="Map layer">
            {(
              [
                ['sun', 'Sunlight, 18.6-year average'],
                ['earth', 'Earth visibility, 18.6-year average'],
                ['none', 'Terrain only'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" className="chip" aria-pressed={layer === k} onClick={() => setLayer(k)}>
                {l}
              </button>
            ))}
          </div>
          {layer !== 'none' && (
            <span className="row hint" style={{ margin: 0, gap: 6 }}>
              0%
              <span
                style={{
                  display: 'inline-block',
                  width: 120,
                  height: 8,
                                    background:
                    layer === 'sun'
                      ? 'linear-gradient(90deg,#1a1030,#96325a,#e67828,#ffcd50,#fffad2)'
                      : 'linear-gradient(90deg,#0a1428,#14285a,#286ebe,#64b4f0,#c8ebff)',
                }}
              />
              100% of the time ({layer === 'sun' ? 'any part of the Sun' : 'any part of Earth'} visible from the surface)
            </span>
          )}
        </div>
        <div ref={el} className="map-wrap" />
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 10 }}>
          <span className="hint mono" style={{ margin: 0 }}>
            {hover ? `Cursor ${fmtLat(hover[0])}, ${fmtLon(hover[1])}` : 'Move over the map to read coordinates'}
          </span>
          <div className="row">
            {picked && (
              <span style={{ fontSize: 14 }}>
                {pickedSite ? pickedSite.short ?? pickedSite.name : `${fmtLat(picked.lat)}, ${fmtLon(picked.lon)}`}
              </span>
            )}
            <button className="btn primary" type="button" disabled={!picked} onClick={() => picked && onPick(picked)}>
              <Icon name="location" />
              Use this point
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
