// Planning helpers built on a computed Series: ranking, power budget, events, nearby grids, CSV.

import type { Interval, Metrics, Series } from './analysis';
import { R_MOON_KM } from './geometry';

export type Priority = 'both' | 'power' | 'comms';

export const PRIORITIES: [Priority, string][] = [
  ['both', 'Power and contact'],
  ['power', 'Power'],
  ['comms', 'Contact'],
];

/** Higher is better. Ties on percentage are broken by the longest outage. */
export function score(m: Metrics, p: Priority): number {
  if (p === 'power') return m.sunlitPct - m.longestDarkH * 0.01;
  if (p === 'comms') return m.earthPct - m.longestCommGapH * 0.01;
  return m.bothPct + 0.25 * (m.sunlitPct + m.earthPct);
}

/** A view of samples i0..i1 (inclusive) of a series, without copying. */
export function sliceSeries(s: Series, i0: number, i1: number): Series {
  const sub = <T extends Float32Array | Float64Array | Uint8Array>(a: T) => a.subarray(i0, i1 + 1) as T;
  return {
    ...s,
    n: i1 - i0 + 1,
    t: sub(s.t),
    sunAz: sub(s.sunAz),
    sunEl: sub(s.sunEl),
    sunHz: sub(s.sunHz),
    sunFrac: sub(s.sunFrac),
    sunRad: sub(s.sunRad),
    sunW: sub(s.sunW),
    earthAz: sub(s.earthAz),
    earthEl: sub(s.earthEl),
    earthHz: sub(s.earthHz),
    earthFrac: sub(s.earthFrac),
    earthRad: sub(s.earthRad),
    earthPhase: sub(s.earthPhase),
    earthUp: sub(s.earthUp),
  };
}

// ---------------------------------------------------------------- power budget

export interface BudgetInput {
  areaM2: number; // sun-tracking panel area
  efficiency: number; // 0..1, panel and conversion
  loadW: number; // constant electrical load
}

/** Assumed battery pack specific energy, for a rough mass figure. */
export const PACK_WH_PER_KG = 150;

export interface BudgetResult {
  generatedKWh: number;
  usedKWh: number;
  netKWh: number;
  peakW: number;
  batteryKWh: number; // smallest usable battery that never runs empty, starting full
  batteryKg: number;
  worstAt: number | null; // time the battery is lowest
  coversLoadPct: number; // share of time generation alone covers the load
  level: Float32Array; // battery state of charge 0..1 with the required capacity, downsampled
  levelT: Float64Array;
}

export function powerBudget(s: Series, p: BudgetInput): BudgetResult {
  const dtH = s.stepMs / 3600e3;
  const k = p.areaM2 * p.efficiency;
  let e = 0;
  let peakE = 0;
  let drawdown = 0;
  let worstAt: number | null = null;
  let gen = 0;
  let peakW = 0;
  let covered = 0;
  for (let i = 0; i < s.n; i++) {
    const g = s.sunW[i] * k;
    if (g > peakW) peakW = g;
    if (g >= p.loadW) covered++;
    if (i === 0) continue;
    gen += g * dtH;
    e += (g - p.loadW) * dtH;
    if (e > peakE) peakE = e;
    if (peakE - e > drawdown) {
      drawdown = peakE - e;
      worstAt = s.t[i];
    }
  }
  const used = p.loadW * dtH * (s.n - 1);
  const cap = drawdown;
  const pts = Math.min(s.n, 600);
  const level = new Float32Array(pts);
  const levelT = new Float64Array(pts);
  let b = cap;
  let j = 0;
  for (let i = 0; i < s.n; i++) {
    if (i > 0) b = Math.min(cap, b + (s.sunW[i] * k - p.loadW) * dtH);
    const want = Math.floor((i * pts) / s.n);
    if (want === j && j < pts) {
      level[j] = cap > 0 ? Math.max(0, b / cap) : 1;
      levelT[j] = s.t[i];
      j++;
    }
  }
  return {
    generatedKWh: gen / 1000,
    usedKWh: used / 1000,
    netKWh: (gen - used) / 1000,
    peakW,
    batteryKWh: cap / 1000,
    batteryKg: cap / PACK_WH_PER_KG,
    worstAt: drawdown > 0 ? worstAt : null,
    coversLoadPct: (100 * covered) / s.n,
    level: level.subarray(0, j),
    levelT: levelT.subarray(0, j),
  };
}

// ---------------------------------------------------------------- events

export interface MissionEvent {
  t: number;
  kind: 'Sunrise' | 'Sunset' | 'Earthrise' | 'Earthset';
}

export function missionEvents(m: Metrics, t0: number, t1: number): MissionEvent[] {
  const out: MissionEvent[] = [];
  const add = (iv: Interval[], rise: MissionEvent['kind'], set: MissionEvent['kind']) => {
    for (const x of iv) {
      if (x.start > t0 + 1) out.push({ t: x.start, kind: rise });
      if (x.end < t1 - 1) out.push({ t: x.end, kind: set });
    }
  };
  add(m.sunIntervals, 'Sunrise', 'Sunset');
  add(m.earthIntervals, 'Earthrise', 'Earthset');
  return out.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------- nearby grid

const D = Math.PI / 180;

/** Point at a distance (km) and bearing (degrees from north, toward east) from lat, lon, on a sphere. */
export function destination(lat: number, lon: number, bearingDeg: number, distKm: number): [number, number] {
  const p1 = Math.max(lat, -89.9999) * D;
  const l1 = lon * D;
  const th = bearingDeg * D;
  const dl = distKm / R_MOON_KM;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(dl) + Math.cos(p1) * Math.sin(dl) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(dl) * Math.cos(p1), Math.cos(dl) - Math.sin(p1) * Math.sin(p2));
  return [p2 / D, ((((l2 / D) % 360) + 360) % 360)];
}

export interface GridPoint {
  lat: number;
  lon: number;
  eastKm: number;
  northKm: number;
  col: number;
  row: number;
}

/** Points on a square grid (local east and north) inside a circle, centre included. */
export function gridAround(lat: number, lon: number, radiusKm: number, perSide: number): GridPoint[] {
  const half = (perSide - 1) / 2;
  const step = radiusKm / half;
  const out: GridPoint[] = [];
  for (let row = 0; row < perSide; row++) {
    for (let col = 0; col < perSide; col++) {
      const e = (col - half) * step;
      const n = (half - row) * step;
      const d = Math.hypot(e, n);
      if (d > radiusKm + 1e-9) continue;
      const [la, lo] = d === 0 ? [lat, lon] : destination(lat, lon, Math.atan2(e, n) / D, d);
      out.push({ lat: la, lon: lo, eastKm: e, northKm: n, col, row });
    }
  }
  return out;
}

/** "1.5 km N, 0.5 km W" style offset from the site. */
export function offsetLabel(eastKm: number, northKm: number): string {
  const parts: string[] = [];
  if (Math.abs(northKm) > 1e-6) parts.push(`${Math.abs(northKm).toFixed(1)} km ${northKm > 0 ? 'N' : 'S'}`);
  if (Math.abs(eastKm) > 1e-6) parts.push(`${Math.abs(eastKm).toFixed(1)} km ${eastKm > 0 ? 'E' : 'W'}`);
  return parts.length ? parts.join(', ') : 'Site';
}

// ---------------------------------------------------------------- CSV

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v))).join(',')).join('\n');
}

export function downloadText(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const isoUtc = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');
