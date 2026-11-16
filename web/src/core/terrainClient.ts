// Main-thread wrapper around the terrain worker.
export interface TerrainResult {
  mask: Float32Array;
  elevM: number;
  ms: number;
  nearRes: number;
}

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (r: TerrainResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const d = ev.data;
      const w = waiting.get(d.id);
      if (!w) return;
      waiting.delete(d.id);
      if (d.ok) w.resolve({ mask: d.mask, elevM: d.elevM, ms: d.ms, nearRes: d.nearRes });
      else w.reject(new Error(d.error));
    };
  }
  return worker;
}

export function computeHorizon(lat: number, lon: number, mastM = 2, nAz = 720): Promise<TerrainResult> {
  const id = nextId++;
  const base = new URL('data/terrain/', document.baseURI).href;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ id, base, lat, lon, mastM, nAz });
  });
}
