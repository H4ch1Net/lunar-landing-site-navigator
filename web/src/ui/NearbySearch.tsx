import { useEffect, useRef, useState } from 'react';
import { loadPref, savePref } from './prefs';
import { computeSeries, metrics, stepFor, type Metrics, type Site } from '../core/analysis';
import { ensureRange } from '../core/ephemeris';
import { PRIORITIES, gridAround, offsetLabel, score, type GridPoint, type Priority } from '../core/plan';
import { customSite } from '../core/scenario';
import { COVERAGE_LAT } from '../core/terrain';
import { computeHorizon } from '../core/terrainClient';
import { fmtGap } from './MetricsPanel';
import { AXIS_FONT, alpha, palette } from './theme';
import { useCanvas } from './useCanvas';

const PER_SIDE = 9;

/** Finished searches for this visit, so switching tabs or sites and back does not recompute them. */
const cache = new Map<string, Result[]>();
const RADII = [1, 2, 5];

interface Result extends GridPoint {
  m: Metrics;
  elevM: number;
}

interface Props {
  site: Site;
  startMs: number;
  durationH: number;
  minEarthEl: number;
  mastM: number;
  onUse: (lat: number, lon: number, name: string) => void;
}

const shown = (m: Metrics, p: Priority) => (p === 'power' ? m.sunlitPct : p === 'comms' ? m.earthPct : m.bothPct);
const label = (p: Priority) => (p === 'power' ? 'Sunlight' : p === 'comms' ? 'Earth in view' : 'Sun and Earth together');

/** One sentence on what the best nearby point gains over the site itself. */
function finding(a: Metrics, b: Metrics, where: string): string {
  const parts: string[] = [];
  const pct = (x: number) => `${x.toFixed(0)}%`;
  if (Math.abs(b.sunlitPct - a.sunlitPct) >= 1) parts.push(`sunlight from ${pct(a.sunlitPct)} to ${pct(b.sunlitPct)}`);
  if (Math.abs(b.earthPct - a.earthPct) >= 1) parts.push(`Earth view from ${pct(a.earthPct)} to ${pct(b.earthPct)}`);
  if (!parts.length) return `The best point, ${where}, is about the same as the site for this window.`;
  return `Moving ${where} changes ${parts.join(' and ')}.`;
}

function HeatGrid({ results, priority, best, picked, onPick }: { results: Result[]; priority: Priority; best: Result; picked: Result | null; onPick: (r: Result) => void }) {
  const geo = useRef({ x0: 0, y0: 0, cell: 1 });
  const { ref } = useCanvas(260, (ctx, w, h) => {
    const P = palette();
    const legendW = 104;
    const size = Math.min(h - 28, w - legendW - 14);
    const cell = size / PER_SIDE;
    const x0 = Math.max(0, (w - size - 14 - legendW) / 2);
    const y0 = 6;
    geo.current = { x0, y0, cell };
    const color = priority === 'power' ? P.sun : priority === 'comms' ? P.earth : P.both;
    const vals = results.map((r) => shown(r.m, priority));
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    ctx.fillStyle = P.sky;
    ctx.fillRect(x0, y0, size, size);
    for (const r of results) {
      const v = hi > lo ? (shown(r.m, priority) - lo) / (hi - lo) : 1;
      ctx.fillStyle = alpha(color, 0.12 + 0.88 * v);
      ctx.fillRect(x0 + r.col * cell + 1, y0 + r.row * cell + 1, cell - 2, cell - 2);
    }
    const ring = (r: Result, c: string, dash: number[]) => {
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.setLineDash(dash);
      ctx.strokeRect(x0 + r.col * cell + 1, y0 + r.row * cell + 1, cell - 2, cell - 2);
      ctx.setLineDash([]);
    };
    const centre = results.find((r) => r.eastKm === 0 && r.northKm === 0);
    if (centre) ring(centre, P.heading, [3, 3]);
    ring(best, P.heading, []);
    if (picked && picked !== best) ring(picked, P.muted, []);
    ctx.font = AXIS_FONT;
    ctx.fillStyle = P.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('N', x0 + size / 2, y0 + size + 4);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const legendX = x0 + size + 14;
    ctx.fillText(priority === 'both' ? 'Both' : label(priority), legendX, y0 + 8);
    for (let k = 0; k <= 4; k++) {
      const f = k / 4;
      ctx.fillStyle = alpha(color, 0.12 + 0.88 * f);
      ctx.fillRect(legendX, y0 + 24 + (4 - k) * 18, 14, 14);
      ctx.fillStyle = P.muted;
      ctx.fillText(`${(lo + f * (hi - lo)).toFixed(0)}%`, legendX + 20, y0 + 31 + (4 - k) * 18);
    }
    ctx.fillText('Solid: best', legendX, y0 + 132);
    ctx.fillText('Dashed: site', legendX, y0 + 150);
  });
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={`Grid of nearby points coloured by ${label(priority)}. North is up.`}
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        const c = ref.current!;
        const b = c.getBoundingClientRect();
        const { x0, y0, cell } = geo.current;
        const col = Math.floor((e.clientX - b.left - x0) / cell);
        const row = Math.floor((e.clientY - b.top - y0) / cell);
        const r = results.find((x) => x.col === col && x.row === row);
        if (r) onPick(r);
      }}
    />
  );
}

export function NearbySearch({ site, startMs, durationH, minEarthEl, mastM, onUse }: Props) {
  const [radius, setRadius] = useState<number>(() => loadPref('nearby-radius', 2));
  const [priority, setPriority] = useState<Priority>(() => loadPref('nearby-rank', 'both'));
  useEffect(() => savePref('nearby-radius', radius), [radius]);
  useEffect(() => savePref('nearby-rank', priority), [priority]);
  const key = `${site.lat},${site.lon},${startMs},${durationH},${minEarthEl},${mastM},${radius}`;
  const [results, setResults] = useState<Result[] | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Result | null>(null);
  const run = useRef(0);

  // A new site, window, mast or radius makes old results stale; show a finished search for it if there is one.
  useEffect(() => {
    run.current++;
    setResults(cache.get(key) ?? null);
    setProgress(null);
    setPicked(null);
  }, [key]);

  if (site.lat > COVERAGE_LAT) {
    return (
      <section className="panel panel-pad" aria-labelledby="nearby-h">
        <h2 id="nearby-h">Better spot nearby</h2>
        <p className="hint" style={{ margin: 0 }}>
          Needs a site south of 80.5° S, where the browser has terrain tiles.
        </p>
      </section>
    );
  }

  const search = async () => {
    const id = ++run.current;
    setError(null);
    setPicked(null);
    const pts = gridAround(site.lat, site.lon, radius, PER_SIDE);
    setProgress([0, pts.length]);
    const endMs = startMs + durationH * 3600e3;
    try {
      await ensureRange(startMs, endMs);
      const stepMin = Math.max(10, stepFor(durationH));
      const out: Result[] = [];
      for (const p of pts) {
        const r = await computeHorizon(p.lat, p.lon, mastM, 360);
        if (id !== run.current) return;
        const s = { ...customSite(p.lat, p.lon), mask: r.mask, elevM: r.elevM };
        const ser = computeSeries(s, { startMs, endMs, stepMin, mastM, minEarthElDeg: minEarthEl });
        out.push({ ...p, m: metrics(ser), elevM: r.elevM });
        setProgress([out.length, pts.length]);
      }
      cache.set(key, out);
      setResults(out);
    } catch (e) {
      if (id === run.current) setError((e as Error).message);
    }
  };

  // Best score first; on a tie the closer point wins, since it is the shorter move.
  const ranked = results
    ? [...results].sort((a, b) => score(b.m, priority) - score(a.m, priority) || Math.hypot(a.eastKm, a.northKm) - Math.hypot(b.eastKm, b.northKm))
    : [];
  const centre = results?.find((r) => r.eastKm === 0 && r.northKm === 0) ?? null;
  const top = ranked.slice(0, 5);
  const busy = progress !== null && !results;
  const nameFor = (r: Result) => `${offsetLabel(r.eastKm, r.northKm)} of ${site.short ?? site.name}`;
  const gain = centre && ranked[0] && ranked[0] !== centre ? ranked[0] : null;

  return (
    <section className="panel panel-pad" aria-labelledby="nearby-h">
      <div className="panel-head">
        <h2 id="nearby-h">Better spot nearby</h2>
        <span className="hint" style={{ margin: 0 }}>
          Scans a grid around the site for the same window
        </span>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
        <div className="field compact" style={{ margin: 0 }}>
          <span className="field-label">Search radius</span>
          <div className="chips" role="group" aria-label="Search radius">
            {RADII.map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={radius === r} onClick={() => setRadius(r)} disabled={busy}>
                {r} km
              </button>
            ))}
          </div>
        </div>
        <div className="field compact" style={{ margin: 0 }}>
          <span className="field-label">Rank by</span>
          <div className="chips" role="group" aria-label="Rank by">
            {PRIORITIES.map(([k, l]) => (
              <button key={k} type="button" className="chip" aria-pressed={priority === k} onClick={() => setPriority(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <button className="btn" type="button" onClick={search} disabled={busy}>
          {busy ? `Computing ${progress![0]} of ${progress![1]} horizons...` : results ? 'Search again' : 'Search nearby'}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {results && results.length > 0 && (
        <div className="nearby">
          {gain && centre && <p className="nearby-finding">{finding(centre.m, gain.m, offsetLabel(gain.eastKm, gain.northKm))}</p>}
          <HeatGrid results={results} priority={priority} best={ranked[0]} picked={picked} onPick={setPicked} />
          <div className="table-wrap">
            <table className="cmp-table">
              <thead>
                <tr>
                  <th scope="col">Point</th>
                  <th scope="col">Sunlight</th>
                  <th scope="col">Longest dark</th>
                  <th scope="col">Earth in view</th>
                  <th scope="col">Longest gap</th>
                  <th scope="col">Both</th>
                  <th scope="col">
                    <span className="sr-only">Use</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...(picked && !top.includes(picked) ? [picked] : []), ...top, ...(centre && !top.includes(centre) ? [centre] : [])].map((r) => (
                  <tr key={`${r.col}_${r.row}`} className={r === picked ? 'picked' : undefined}>
                    <td>
                      {offsetLabel(r.eastKm, r.northKm)}
                      {r === ranked[0] ? <span className="status good" style={{ marginLeft: 8 }}>Best</span> : null}
                    </td>
                    <td className="num">{r.m.sunlitPct.toFixed(0)}%</td>
                    <td className="num">{fmtGap(r.m.longestDarkH)}</td>
                    <td className="num">{r.m.earthPct.toFixed(0)}%</td>
                    <td className="num">{fmtGap(r.m.longestCommGapH)}</td>
                    <td className="num">{r.m.bothPct.toFixed(0)}%</td>
                    <td>
                      {r !== centre && (
                        <button className="btn small" type="button" onClick={() => onUse(r.lat, r.lon, nameFor(r))}>
                          Use
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            {results.length} points on a {((2 * radius) / (PER_SIDE - 1)).toFixed(2)} km grid, north up. Every point, the site included, uses the browser
            terrain tiles (80 m near the point) so they compare fairly; the main view uses 20 m terrain for curated sites, so its numbers can differ slightly.
            Click a cell to see its numbers.
          </p>
        </div>
      )}
    </section>
  );
}
