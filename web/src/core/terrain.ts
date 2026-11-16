// Terrain horizon masks computed in the browser from LOLA tiles (see pipeline/build_tiles.py).
// Same algorithm as pipeline/horizon.py: march along great circles on a sphere of
// R = 1737.4 km, sample the finest terrain level available at each distance, keep the
// highest elevation angle including the curvature drop.

interface Level {
  name: string;
  res: number;
  left: number;
  top: number;
  tile: number;
  stride: number;
  nx: number;
  ny: number;
  tiles: [number, number][];
  max_dist_m: number;
}

interface TerrainIndex {
  levels: Level[];
}

const R = 1737400;
let base = 'data/terrain/';
let index: Promise<TerrainIndex> | null = null;
/** Decoded tiles per level, indexed ty * nx + tx; undefined = not loaded, null = no data there. */
let grids: (Float32Array | null | undefined)[][] = [];
let present: Set<number>[] = [];
const pending = new Map<string, Promise<void>>();

export function setTerrainBase(url: string) {
  base = url;
}

function loadIndex(): Promise<TerrainIndex> {
  if (!index) {
    index = fetch(base + 'index.json')
      .then((r) => {
        if (!r.ok) throw new Error(`terrain index ${r.status}`);
        return r.json();
      })
      .then((j: TerrainIndex) => {
        present = j.levels.map((l) => new Set(l.tiles.map(([x, y]) => y * l.nx + x)));
        grids = j.levels.map((l) => new Array(l.nx * l.ny));
        return j;
      });
  }
  return index;
}

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const b = new Uint8Array(buf);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buf; // server already decoded it
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return new Response(stream).arrayBuffer();
}

function loadTile(li: number, lv: Level, tx: number, ty: number): Promise<void> {
  const k = ty * lv.nx + tx;
  if (grids[li][k] !== undefined) return Promise.resolve();
  if (!present[li].has(k)) {
    grids[li][k] = null;
    return Promise.resolve();
  }
  const key = `${li}/${k}`;
  let p = pending.get(key);
  if (!p) {
    p = fetch(`${base}${lv.name}/${tx}_${ty}.bin`)
      .then((r) => {
        if (!r.ok) throw new Error(`terrain tile ${lv.name}/${tx}_${ty}: ${r.status}`);
        return r.arrayBuffer();
      })
      .then(gunzip)
      .then((buf) => {
        // Rows are stored as int16 deltas; undo them with a running sum.
        const d = new Int16Array(buf);
        const out = new Float32Array(d.length);
        const s = lv.stride;
        for (let r = 0; r < s; r++) {
          let acc = 0;
          const o = r * s;
          for (let c = 0; c < s; c++) {
            acc += d[o + c];
            out[o + c] = acc;
          }
        }
        grids[li][k] = out;
        pending.delete(key);
      });
    pending.set(key, p);
  }
  return p;
}

function stereo(lat: number, lon: number): [number, number] {
  const rho = 2 * R * Math.tan(((90 + lat) * Math.PI) / 360);
  return [rho * Math.sin((lon * Math.PI) / 180), rho * Math.cos((lon * Math.PI) / 180)];
}

/** Bilinear height in metres at stereographic (x, y) from one level, NaN outside loaded data. */
function sample(li: number, lv: Level, x: number, y: number): number {
  const col = (x - lv.left) / lv.res - 0.5;
  const row = (lv.top - y) / lv.res - 0.5;
  if (col < 0 || row < 0) return NaN;
  const tx = Math.floor(col / lv.tile);
  const ty = Math.floor(row / lv.tile);
  if (tx >= lv.nx || ty >= lv.ny) return NaN;
  const t = grids[li][ty * lv.nx + tx];
  if (!t) return NaN;
  const c = col - tx * lv.tile;
  const r = row - ty * lv.tile;
  const c0 = Math.floor(c);
  const r0 = Math.floor(r);
  const fc = c - c0;
  const fr = r - r0;
  const s = lv.stride;
  const i = r0 * s + c0;
  return t[i] * (1 - fc) * (1 - fr) + t[i + 1] * fc * (1 - fr) + t[i + s] * (1 - fc) * fr + t[i + s + 1] * fc * fr;
}

export const COVERAGE_LAT = -80.5;

export interface HorizonResult {
  mask: Float32Array;
  elevM: number;
  ms: number;
  nearRes: number;
}

/** Load every tile a horizon from (lat, lon) needs, for each level up to its distance limit. */
async function ensureTiles(lv: Level[], lat: number, lon: number, sMax: number) {
  const [x, y] = stereo(lat, lon);
  const jobs: Promise<void>[] = [];
  lv.forEach((l, li) => {
    const reach = Math.min(l.max_dist_m, sMax) * 1.03 + 2 * l.res;
    const c0 = Math.floor((x - reach - l.left) / l.res / l.tile);
    const c1 = Math.floor((x + reach - l.left) / l.res / l.tile);
    const r0 = Math.floor((l.top - (y + reach)) / l.res / l.tile);
    const r1 = Math.floor((l.top - (y - reach)) / l.res / l.tile);
    for (let ty = Math.max(0, r0); ty <= Math.min(l.ny - 1, r1); ty++)
      for (let tx = Math.max(0, c0); tx <= Math.min(l.nx - 1, c1); tx++) jobs.push(loadTile(li, l, tx, ty));
  });
  await Promise.all(jobs);
}

export async function horizonMask(lat: number, lon: number, mastM = 2, nAz = 720, sMax = 250000): Promise<HorizonResult> {
  const t0 = performance.now();
  const { levels } = await loadIndex();
  await ensureTiles(levels, lat, lon, sMax);
  const D = Math.PI / 180;
  const la = Math.max(lat, -89.9999) * D;
  const lo = lon * D;
  const u0 = Math.cos(la) * Math.cos(lo);
  const u1 = Math.cos(la) * Math.sin(lo);
  const u2 = Math.sin(la);
  const e0 = -Math.sin(lo);
  const e1 = Math.cos(lo);
  // north = up x east (east has no z component)
  const n0 = -u2 * e1;
  const n1 = u2 * e0;
  const n2 = u0 * e1 - u1 * e0;
  const nLev = levels.length;
  const last = nLev - 1;

  // Height at distance s along the ray; sets hRes to the resolution used.
  let hRes = 1000;
  const height = (s: number, x: number, y: number): number => {
    for (let li = 0; li < nLev; li++) {
      if (s >= levels[li].max_dist_m && li < last) continue;
      const v = sample(li, levels[li], x, y);
      if (v === v) {
        hRes = levels[li].res;
        return v;
      }
    }
    hRes = 1000;
    return NaN;
  };

  const k0 = (2 * R) / (1 - u2);
  const z0 = height(0, k0 * u1, k0 * u0);
  const nearRes = hRes;
  if (Number.isNaN(z0)) throw new Error('No terrain data at this point');
  const rs = R + z0 + mastM;
  const mask = new Float32Array(nAz);
  const frac = 0.002;
  const s0 = 0.5 * levels[0].res;
  for (let i = 0; i < nAz; i++) {
    const a = (2 * Math.PI * i) / nAz;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const d0 = ca * n0 + sa * e0;
    const d1 = ca * n1 + sa * e1;
    const d2 = ca * n2;
    let best = -1e9;
    let s = s0;
    while (s < sMax) {
      const t = s / R;
      const ct = Math.cos(t);
      const st = Math.sin(t);
      const px = ct * u0 + st * d0;
      const py = ct * u1 + st * d1;
      const pz = ct * u2 + st * d2;
      const k = (2 * R) / (1 - pz);
      const zp = height(s, k * py, k * px);
      if (zp === zp) {
        const rp = R + zp;
        const q = (rp * ct - rs) / (rp * st);
        if (q > best) best = q;
      }
      s += Math.max(s * frac, 0.5 * hRes);
    }
    mask[i] = (Math.atan(best) * 180) / Math.PI;
  }
  return { mask, elevM: z0, ms: performance.now() - t0, nearRes };
}
