// Sun and Earth position vectors in the Moon-fixed MOON_ME frame (km, Moon centre),
// precomputed with SPICE (DE440, LT+S) on a 2-hour UTC grid and interpolated with a
// 4-point cubic Lagrange polynomial. See pipeline/build_ephemeris.py.

export type Vec3 = [number, number, number];

export interface EphManifest {
  frame: string;
  abcorr: string;
  step_hours: number;
  years: number[];
  kernels: string[];
}

export interface BodyVectors {
  sun: Vec3;
  earth: Vec3;
}

const years = new Map<number, Float32Array>();
const pending = new Map<number, Promise<Float32Array>>();
let manifest: EphManifest | null = null;
let stepMs = 2 * 3600e3;
let fetcher: (path: string) => Promise<ArrayBuffer> = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.arrayBuffer();
};
let basePath = 'data/eph/';

/** Override how files are read (used by Node tests). */
export function configureEphemeris(opts: { base?: string; fetcher?: (p: string) => Promise<ArrayBuffer> }) {
  if (opts.base !== undefined) basePath = opts.base;
  if (opts.fetcher) fetcher = opts.fetcher;
}

export async function loadManifest(): Promise<EphManifest> {
  if (manifest) return manifest;
  const buf = await fetcher(basePath + 'manifest.json');
  manifest = JSON.parse(new TextDecoder().decode(buf)) as EphManifest;
  stepMs = manifest.step_hours * 3600e3;
  return manifest;
}

export function yearOf(tMs: number): number {
  return new Date(tMs).getUTCFullYear();
}

async function loadYear(y: number): Promise<Float32Array> {
  const have = years.get(y);
  if (have) return have;
  let p = pending.get(y);
  if (!p) {
    p = fetcher(`${basePath}${y}.bin`).then((buf) => {
      const arr = new Float32Array(buf);
      years.set(y, arr);
      pending.delete(y);
      return arr;
    });
    pending.set(y, p);
  }
  return p;
}

/** Make sure every year touched by [startMs, endMs] is loaded. Throws if out of range. */
export async function ensureRange(startMs: number, endMs: number): Promise<void> {
  const m = await loadManifest();
  const jobs: Promise<Float32Array>[] = [];
  for (let y = yearOf(startMs); y <= yearOf(endMs); y++) {
    if (!m.years.includes(y)) {
      throw new Error(`This window reaches ${y}, which has no Sun and Earth positions. Covered years: ${formatYears(m.years)}. Pick a date inside them, or press Today.`);
    }
    jobs.push(loadYear(y));
  }
  await Promise.all(jobs);
}

/** Interpolated vectors at tMs (UTC epoch ms). The year must already be loaded. */
export function bodyVectors(tMs: number, out?: BodyVectors): BodyVectors {
  const y = yearOf(tMs);
  const data = years.get(y);
  if (!data) throw new Error(`Ephemeris year ${y} not loaded`);
  const x = (tMs - Date.UTC(y, 0, 1)) / stepMs;
  const i = Math.floor(x);
  const f = x - i;
  // Row i in the file is node -1 of interval i (one padding sample at the start).
  const w0 = (-f * (f - 1) * (f - 2)) / 6;
  const w1 = ((f + 1) * (f - 1) * (f - 2)) / 2;
  const w2 = (-(f + 1) * f * (f - 2)) / 2;
  const w3 = ((f + 1) * f * (f - 1)) / 6;
  const b = i * 6;
  const o = out ?? { sun: [0, 0, 0], earth: [0, 0, 0] };
  for (let k = 0; k < 3; k++) {
    o.sun[k] = w0 * data[b + k] + w1 * data[b + 6 + k] + w2 * data[b + 12 + k] + w3 * data[b + 18 + k];
    o.earth[k] = w0 * data[b + 3 + k] + w1 * data[b + 9 + k] + w2 * data[b + 15 + k] + w3 * data[b + 21 + k];
  }
  return o;
}

/** Collapse [1969,1970,1971,2024,2025] into "1969-1971, 2024-2025". */
export function formatYears(ys: number[]): string {
  const parts: string[] = [];
  let a = ys[0];
  let b = ys[0];
  for (let i = 1; i <= ys.length; i++) {
    if (i < ys.length && ys[i] === b + 1) {
      b = ys[i];
      continue;
    }
    parts.push(a === b ? String(a) : `${a}-${b}`);
    a = ys[i];
    b = ys[i];
  }
  return parts.join(', ');
}
