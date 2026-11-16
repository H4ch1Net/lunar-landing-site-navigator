/// <reference lib="webworker" />
import { horizonMask, setTerrainBase } from './terrain';

interface Req {
  id: number;
  base: string;
  lat: number;
  lon: number;
  mastM: number;
  nAz: number;
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { id, base, lat, lon, mastM, nAz } = ev.data;
  setTerrainBase(base);
  try {
    const r = await horizonMask(lat, lon, mastM, nAz);
    (self as unknown as Worker).postMessage({ id, ok: true, mask: r.mask, elevM: r.elevM, ms: r.ms, nearRes: r.nearRes }, [r.mask.buffer]);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (e as Error).message });
  }
};
