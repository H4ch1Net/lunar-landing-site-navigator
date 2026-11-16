// Time series and mission-window metrics for one site and date range.

import { bodyVectors, type BodyVectors } from './ephemeris';
import {
  AU_KM,
  R_EARTH_KM,
  R_SUN_KM,
  SOLAR_CONSTANT_W_M2,
  angularRadiusDeg,
  azEl,
  diskFraction,
  earthPhase,
  maskAt,
  siteFrame,
  type AzEl,
} from './geometry';

export interface Site {
  id: string;
  name: string;
  short?: string;
  group: string;
  lat: number;
  lon: number;
  elevM: number;
  mask: Float32Array | null;
  terrain: string;
  note?: string;
  landedUtc?: string;
  source?: string;
  custom?: boolean;
}

export interface SeriesOptions {
  startMs: number;
  endMs: number;
  stepMin: number;
  mastM: number;
  minEarthElDeg: number;
}

export interface Series {
  n: number;
  stepMs: number;
  t: Float64Array;
  sunAz: Float32Array;
  sunEl: Float32Array;
  sunHz: Float32Array;
  sunFrac: Float32Array;
  sunRad: Float32Array;
  sunW: Float32Array; // W/m2 on a panel that always faces the Sun
  earthAz: Float32Array;
  earthEl: Float32Array;
  earthHz: Float32Array;
  earthFrac: Float32Array;
  earthRad: Float32Array;
  earthPhase: Float32Array;
  earthUp: Uint8Array; // Earth centre above terrain + minimum antenna elevation
  opts: SeriesOptions;
}

export interface Snapshot {
  t: number;
  sun: AzEl & { hz: number; frac: number; rad: number; w: number };
  earth: AzEl & { hz: number; frac: number; rad: number; phase: number; up: boolean };
}

export function snapshot(site: Site, tMs: number, mastM: number, minEarthElDeg: number): Snapshot {
  const f = siteFrame(site.lat, site.lon, (site.elevM + mastM) / 1000);
  const v = bodyVectors(tMs);
  return snapAt(site, f, v, tMs, minEarthElDeg);
}

function snapAt(site: Site, f: ReturnType<typeof siteFrame>, v: BodyVectors, tMs: number, minEl: number): Snapshot {
  const s = azEl(v.sun, f);
  const e = azEl(v.earth, f);
  const sr = angularRadiusDeg(R_SUN_KM, s.dist);
  const er = angularRadiusDeg(R_EARTH_KM, e.dist);
  const shz = maskAt(site.mask, s.az);
  const ehz = maskAt(site.mask, e.az);
  const sfrac = diskFraction(s.el - shz, sr);
  const efrac = diskFraction(e.el - ehz, er);
  const w = sfrac * SOLAR_CONSTANT_W_M2 * (AU_KM / s.dist) ** 2;
  return {
    t: tMs,
    sun: { ...s, hz: shz, frac: sfrac, rad: sr, w },
    earth: { ...e, hz: ehz, frac: efrac, rad: er, phase: earthPhase(v.sun, v.earth), up: e.el - ehz >= minEl },
  };
}

export function computeSeries(site: Site, opts: SeriesOptions): Series {
  const stepMs = opts.stepMin * 60e3;
  const n = Math.max(2, Math.floor((opts.endMs - opts.startMs) / stepMs) + 1);
  const s: Series = {
    n,
    stepMs,
    t: new Float64Array(n),
    sunAz: new Float32Array(n),
    sunEl: new Float32Array(n),
    sunHz: new Float32Array(n),
    sunFrac: new Float32Array(n),
    sunRad: new Float32Array(n),
    sunW: new Float32Array(n),
    earthAz: new Float32Array(n),
    earthEl: new Float32Array(n),
    earthHz: new Float32Array(n),
    earthFrac: new Float32Array(n),
    earthRad: new Float32Array(n),
    earthPhase: new Float32Array(n),
    earthUp: new Uint8Array(n),
    opts,
  };
  const f = siteFrame(site.lat, site.lon, (site.elevM + opts.mastM) / 1000);
  const v: BodyVectors = { sun: [0, 0, 0], earth: [0, 0, 0] };
  const a: AzEl = { az: 0, el: 0, dist: 0 };
  for (let i = 0; i < n; i++) {
    const t = opts.startMs + i * stepMs;
    s.t[i] = t;
    bodyVectors(t, v);
    azEl(v.sun, f, a);
    const sr = angularRadiusDeg(R_SUN_KM, a.dist);
    const shz = maskAt(site.mask, a.az);
    const sf = diskFraction(a.el - shz, sr);
    s.sunAz[i] = a.az;
    s.sunEl[i] = a.el;
    s.sunHz[i] = shz;
    s.sunFrac[i] = sf;
    s.sunRad[i] = sr;
    s.sunW[i] = sf * SOLAR_CONSTANT_W_M2 * (AU_KM / a.dist) ** 2;
    azEl(v.earth, f, a);
    const er = angularRadiusDeg(R_EARTH_KM, a.dist);
    const ehz = maskAt(site.mask, a.az);
    s.earthAz[i] = a.az;
    s.earthEl[i] = a.el;
    s.earthHz[i] = ehz;
    s.earthFrac[i] = diskFraction(a.el - ehz, er);
    s.earthRad[i] = er;
    s.earthPhase[i] = earthPhase(v.sun, v.earth);
    s.earthUp[i] = a.el - ehz >= opts.minEarthElDeg ? 1 : 0;
  }
  return s;
}

export interface Interval {
  start: number;
  end: number;
}

export interface Metrics {
  hours: number;
  sunlitPct: number; // any part of the solar disk above the terrain
  meanSunFracPct: number; // average visible fraction of the disk
  sunlitHours: number;
  longestDarkH: number;
  longestLightH: number;
  firstSunsetH: number | null; // hours from window start until the Sun is fully hidden
  firstSunriseH: number | null;
  earthPct: number;
  earthHours: number;
  longestCommGapH: number;
  firstEarthsetH: number | null;
  firstEarthriseH: number | null;
  bothPct: number;
  energyKWhM2: number;
  meanPowerWM2: number;
  maxSunEl: number;
  minSunEl: number;
  maxEarthEl: number;
  sunIntervals: Interval[];
  earthIntervals: Interval[];
  startsLit: boolean;
  startsComm: boolean;
}

/** Contiguous true-runs of a predicate, as time intervals refined by linear interpolation. */
function intervals(s: Series, up: (i: number) => boolean, g: (i: number) => number): Interval[] {
  const out: Interval[] = [];
  let start: number | null = up(0) ? s.t[0] : null;
  const cross = (i: number) => {
    const a = g(i - 1);
    const b = g(i);
    const f = a === b ? 0.5 : Math.min(1, Math.max(0, a / (a - b)));
    return s.t[i - 1] + f * s.stepMs;
  };
  for (let i = 1; i < s.n; i++) {
    const u = up(i);
    if (u && start === null) start = cross(i);
    else if (!u && start !== null) {
      out.push({ start, end: cross(i) });
      start = null;
    }
  }
  if (start !== null) out.push({ start, end: s.t[s.n - 1] });
  return out;
}

function gaps(iv: Interval[], t0: number, t1: number): Interval[] {
  const out: Interval[] = [];
  let cur = t0;
  for (const x of iv) {
    if (x.start > cur) out.push({ start: cur, end: x.start });
    cur = Math.max(cur, x.end);
  }
  if (cur < t1) out.push({ start: cur, end: t1 });
  return out;
}

const H = 3600e3;
const longest = (iv: Interval[]) => iv.reduce((m, x) => Math.max(m, x.end - x.start), 0) / H;
const total = (iv: Interval[]) => iv.reduce((m, x) => m + (x.end - x.start), 0) / H;

export function metrics(s: Series): Metrics {
  const t0 = s.t[0];
  const t1 = s.t[s.n - 1];
  const hours = (t1 - t0) / H;
  const sunIv = intervals(
    s,
    (i) => s.sunFrac[i] > 0,
    (i) => s.sunEl[i] - s.sunHz[i] + s.sunRad[i],
  );
  const minEl = s.opts.minEarthElDeg;
  const earthIv = intervals(
    s,
    (i) => s.earthUp[i] === 1,
    (i) => s.earthEl[i] - s.earthHz[i] - minEl,
  );
  const dark = gaps(sunIv, t0, t1);
  const noComm = gaps(earthIv, t0, t1);
  let both = 0;
  let fracSum = 0;
  let wSum = 0;
  let maxSun = -90;
  let minSun = 90;
  let maxEarth = -90;
  for (let i = 0; i < s.n; i++) {
    if (s.sunFrac[i] > 0 && s.earthUp[i]) both++;
    fracSum += s.sunFrac[i];
    wSum += s.sunW[i];
    maxSun = Math.max(maxSun, s.sunEl[i]);
    minSun = Math.min(minSun, s.sunEl[i]);
    maxEarth = Math.max(maxEarth, s.earthEl[i]);
  }
  const startsLit = s.sunFrac[0] > 0;
  const startsComm = s.earthUp[0] === 1;
  const firstAfter = (iv: Interval[], key: 'start' | 'end', on: boolean) => {
    if (on && key === 'start') return null;
    const hit = iv.find((x) => (key === 'end' ? x.end < t1 : x.start > t0));
    return hit ? (hit[key] - t0) / H : null;
  };
  const meanPower = wSum / s.n;
  return {
    hours,
    sunlitPct: (100 * total(sunIv)) / hours,
    meanSunFracPct: (100 * fracSum) / s.n,
    sunlitHours: total(sunIv),
    longestDarkH: longest(dark),
    longestLightH: longest(sunIv),
    firstSunsetH: startsLit ? firstAfter(sunIv, 'end', true) : null,
    firstSunriseH: startsLit ? null : firstAfter(sunIv, 'start', false),
    earthPct: (100 * total(earthIv)) / hours,
    earthHours: total(earthIv),
    longestCommGapH: longest(noComm),
    firstEarthsetH: startsComm ? firstAfter(earthIv, 'end', true) : null,
    firstEarthriseH: startsComm ? null : firstAfter(earthIv, 'start', false),
    bothPct: (100 * both) / s.n,
    energyKWhM2: (meanPower * hours) / 1000,
    meanPowerWM2: meanPower,
    maxSunEl: maxSun,
    minSunEl: minSun,
    maxEarthEl: maxEarth,
    sunIntervals: sunIv,
    earthIntervals: earthIv,
    startsLit,
    startsComm,
  };
}

/** Pick a time step that keeps series around a few thousand samples. */
export function stepFor(hours: number): number {
  if (hours <= 24 * 8) return 5;
  if (hours <= 24 * 31) return 10;
  if (hours <= 24 * 95) return 30;
  return 60;
}
