// Validates the shipped browser code (interpolated ephemeris + geometry) against
// Sun and Earth azimuth/elevation from JPL Horizons, frozen in horizons_fixtures.json.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configureEphemeris, ensureRange, bodyVectors } from '../src/core/ephemeris';
import { azEl, siteFrame } from '../src/core/geometry';

const root = resolve(__dirname, '..', 'public', 'data');
configureEphemeris({
  base: resolve(root, 'eph') + '/',
  fetcher: async (p) => {
    const b = readFileSync(p);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  },
});

interface Row { site: string; lat: number; lon: number; alt_km: number; body: 'Sun' | 'Earth'; utc: string; az: number; el: number }
const rows: Row[] = JSON.parse(readFileSync(resolve(root, 'validation', 'horizons_fixtures.json'), 'utf8')).rows;
const MON: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const parse = (s: string) => {
  const m = /^(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})$/.exec(s)!;
  return Date.UTC(+m[1], MON[m[2]], +m[3], +m[4], +m[5]);
};

describe('browser geometry vs JPL Horizons', () => {
  it('matches apparent azimuth and elevation for every fixture row', async () => {
    let maxEl = 0;
    let maxAzSky = 0;
    for (const r of rows) {
      const t = parse(r.utc);
      await ensureRange(t, t);
      const v = bodyVectors(t);
      const a = azEl(r.body === 'Sun' ? v.sun : v.earth, siteFrame(r.lat, r.lon, r.alt_km));
      const dEl = Math.abs(a.el - r.el);
      const dAz = Math.abs(((a.az - r.az + 540) % 360) - 180) * Math.cos((r.el * Math.PI) / 180);
      maxEl = Math.max(maxEl, dEl);
      maxAzSky = Math.max(maxAzSky, dAz);
    }
    console.log(`rows=${rows.length} max |d el|=${maxEl.toExponential(2)} deg, max |d az|*cos(el)=${maxAzSky.toExponential(2)} deg`);
    expect(maxEl).toBeLessThan(0.001);
    expect(maxAzSky).toBeLessThan(0.001);
  });
});
