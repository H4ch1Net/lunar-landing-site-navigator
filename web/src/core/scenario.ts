import type { Site } from './analysis';

export interface Scenario {
  id: string;
  siteId: string;
  custom?: { lat: number; lon: number; name?: string };
  startMs: number;
  durationH: number;
  minEarthEl: number;
  /** Height of panels and antenna above the ground, metres. Undefined means the 2 m default. */
  mastM?: number;
}

export const DEFAULT_MAST_M = 2;
export const MAST_OPTIONS = [2, 5, 10, 20];
export const mastOf = (s: Scenario) => s.mastM ?? DEFAULT_MAST_M;

export const DURATIONS = [
  { h: 156, label: '6.5 days', title: 'Planned crewed surface stay for the first south pole landing' },
  { h: 336, label: '14 days', title: 'Two weeks, typical robotic lander mission' },
  { h: 708.7, label: '1 lunar day', title: 'One synodic month, 29.53 days' },
  { h: 24 * 90, label: '90 days', title: 'Three months' },
];

/** Design system scenario-a to scenario-d (HDS categorical chart colors, dark values). */
export const SCENARIO_COLORS = ['#0cc9ac', '#794be4', '#fa8c87', '#c2b47c'];

let counter = 0;
export function newId(): string {
  counter += 1;
  return `s${Date.now().toString(36)}${counter}`;
}

export function startOfUtcDay(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function customSite(lat: number, lon: number, name?: string): Site {
  return {
    id: `custom:${lat.toFixed(4)},${lon.toFixed(4)}`,
    name: name ?? `Custom point ${Math.abs(lat).toFixed(3)}° ${lat < 0 ? 'S' : 'N'}, ${(((lon % 360) + 360) % 360).toFixed(3)}° E`,
    short: name ?? 'Custom point',
    group: 'Custom',
    lat,
    lon,
    elevM: 0,
    mask: null,
    terrain: 'none (smooth horizon)',
    custom: true,
  };
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 16) + 'Z';

export function encodeScenarios(list: Scenario[], active: number): string {
  const parts = list.map((s) => {
    const p = new URLSearchParams();
    if (s.custom) {
      p.set('lat', s.custom.lat.toFixed(5));
      p.set('lon', s.custom.lon.toFixed(5));
    } else p.set('site', s.siteId);
    p.set('t', iso(s.startMs));
    p.set('d', String(+s.durationH.toFixed(2)));
    if (s.minEarthEl !== 0) p.set('e', String(s.minEarthEl));
    if (s.mastM !== undefined && s.mastM !== DEFAULT_MAST_M) p.set('h', String(s.mastM));
    return p.toString();
  });
  return `#${parts.join('|')}${active > 0 ? `|a=${active}` : ''}`;
}

export function decodeScenarios(hash: string): { list: Scenario[]; active: number } | null {
  const h = hash.replace(/^#/, '');
  if (!h) return null;
  let active = 0;
  const list: Scenario[] = [];
  for (const part of h.split('|')) {
    if (part.startsWith('a=')) {
      active = parseInt(part.slice(2), 10) || 0;
      continue;
    }
    const p = new URLSearchParams(part);
    const t = Date.parse(p.get('t') ?? '');
    const d = parseFloat(p.get('d') ?? '');
    if (!Number.isFinite(t) || !Number.isFinite(d)) continue;
    const lat = parseFloat(p.get('lat') ?? '');
    const lon = parseFloat(p.get('lon') ?? '');
    const custom = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
    list.push({
      id: newId(),
      siteId: custom ? 'custom' : (p.get('site') ?? ''),
      custom,
      startMs: t,
      durationH: Math.max(1, Math.min(24 * 366, d)),
      minEarthEl: parseFloat(p.get('e') ?? '0') || 0,
      ...(p.has('h') ? { mastM: Math.max(0, Math.min(100, parseFloat(p.get('h')!) || DEFAULT_MAST_M)) } : {}),
    });
  }
  if (!list.length) return null;
  return { list: list.slice(0, 4), active: Math.min(active, list.length - 1) };
}
