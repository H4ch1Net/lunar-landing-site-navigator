import { describe, expect, it } from 'vitest';
import type { Series } from '../src/core/analysis';
import { metrics } from '../src/core/analysis';
import { R_MOON_KM, surfaceDistanceKm } from '../src/core/geometry';
import { destination, gridAround, missionEvents, offsetLabel, powerBudget, sliceSeries } from '../src/core/plan';

/** Synthetic series: sunlit (sunW = w) where lit[i], Earth up where up[i], 1-hour steps. */
function fake(lit: boolean[], up: boolean[], w = 1000): Series {
  const n = lit.length;
  const f32 = () => new Float32Array(n);
  const s: Series = {
    n,
    stepMs: 3600e3,
    t: Float64Array.from({ length: n }, (_, i) => i * 3600e3),
    sunAz: f32(),
    sunEl: Float32Array.from(lit, (l) => (l ? 1 : -1)),
    sunHz: f32(),
    sunFrac: Float32Array.from(lit, (l) => (l ? 1 : 0)),
    sunRad: Float32Array.from(lit, () => 0.26),
    sunW: Float32Array.from(lit, (l) => (l ? w : 0)),
    earthAz: f32(),
    earthEl: Float32Array.from(up, (u) => (u ? 1 : -1)),
    earthHz: f32(),
    earthFrac: f32(),
    earthRad: f32(),
    earthPhase: f32(),
    earthUp: Uint8Array.from(up, (u) => (u ? 1 : 0)),
    opts: { startMs: 0, endMs: (n - 1) * 3600e3, stepMin: 60, mastM: 2, minEarthElDeg: 0 },
  };
  return s;
}

describe('power budget', () => {
  it('sizes the battery for the longest dark stretch', () => {
    // 24 h lit, 10 h dark, 24 h lit; 1 m2 at 100 %, 1000 W/m2, 400 W load.
    const lit = [...Array(24).fill(true), ...Array(10).fill(false), ...Array(24).fill(true)];
    const r = powerBudget(fake(lit, lit), { areaM2: 1, efficiency: 1, loadW: 400 });
    // Ten 1-hour steps without Sun draw 400 Wh each.
    expect(r.batteryKWh).toBeCloseTo(4, 6);
    expect(r.peakW).toBe(1000);
    expect(r.level[0]).toBe(1);
    expect(Math.min(...r.level)).toBeCloseTo(0, 6);
  });

  it('needs no battery when generation always covers the load', () => {
    const lit = Array(48).fill(true);
    const r = powerBudget(fake(lit, lit), { areaM2: 1, efficiency: 0.5, loadW: 100 });
    expect(r.batteryKWh).toBe(0);
    expect(r.worstAt).toBeNull();
    expect(r.coversLoadPct).toBe(100);
  });
});

describe('events', () => {
  it('lists sunsets and Earthrises inside the window only', () => {
    const lit = [...Array(10).fill(true), ...Array(5).fill(false), ...Array(10).fill(true)];
    const up = [...Array(3).fill(false), ...Array(22).fill(true)];
    const s = fake(lit, up);
    const ev = missionEvents(metrics(s), s.t[0], s.t[s.n - 1]);
    expect(ev.map((e) => e.kind)).toEqual(['Earthrise', 'Sunset', 'Sunrise']);
  });

  it('slices a series without copying', () => {
    const lit = Array(20).fill(true);
    const s = fake(lit, lit);
    const sub = sliceSeries(s, 5, 9);
    expect(sub.n).toBe(5);
    expect(sub.t[0]).toBe(s.t[5]);
    expect(sub.sunW.buffer).toBe(s.sunW.buffer);
  });
});

describe('nearby grid', () => {
  it('moves the right distance and direction', () => {
    const [lat, lon] = destination(-85, 30, 0, 10);
    expect(lat).toBeCloseTo(-85 + (10 / R_MOON_KM) * (180 / Math.PI), 9);
    expect(lon).toBeCloseTo(30, 9);
    const [la2, lo2] = destination(-89.4398, 222.83, 123, 3.7);
    expect(surfaceDistanceKm(-89.4398, 222.83, la2, lo2)).toBeCloseTo(3.7, 6);
  });

  it('keeps points inside the radius, centre included', () => {
    const g = gridAround(-89.4398, 222.83, 2, 9);
    expect(g.length).toBe(49);
    expect(g.some((p) => p.eastKm === 0 && p.northKm === 0)).toBe(true);
    for (const p of g) expect(surfaceDistanceKm(-89.4398, 222.83, p.lat, p.lon)).toBeLessThanOrEqual(2 + 1e-6);
  });

  it('labels offsets', () => {
    expect(offsetLabel(0, 0)).toBe('Site');
    expect(offsetLabel(-0.5, 1.5)).toBe('1.5 km N, 0.5 km W');
  });
});
