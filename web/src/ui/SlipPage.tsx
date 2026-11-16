import { useEffect, useMemo, useRef, useState } from 'react';
import { computeSeries, metrics, type Metrics, type Site } from '../core/analysis';
import { PRIORITIES, score, sliceSeries, type Priority } from '../core/plan';
import { ensureRange } from '../core/ephemeris';
import { DURATIONS, mastOf, type Scenario } from '../core/scenario';
import type { SiteCatalog } from '../core/sites';
import { fmtDur, fmtGap } from './MetricsPanel';
import { fmtUtc } from './Timeline';
import { AXIS_FONT, alpha, palette } from './theme';
import { useCanvas } from './useCanvas';

interface Props {
  catalog: SiteCatalog;
  scenario: Scenario;
  site: Site | null;
  onPick: (startMs: number) => void;
  onChange: (s: Scenario) => void;
}

interface Candidate {
  t: number;
  m: Metrics;
}

const DAY = 86400e3;

function SlipChart({ cands, picked, onHover, onClick }: { cands: Candidate[]; picked: number | null; onHover: (i: number | null) => void; onClick: (i: number) => void }) {
  const geo = useRef({ padL: 44, plotW: 1 });
  const { ref } = useCanvas(240, (ctx, w, h) => {
    const P = palette();
    const padL = 44;
    const padR = 10;
    const plotW = w - padL - padR;
    geo.current = { padL, plotW };
    const top = 8;
    const bot = h - 24;
    const yOf = (v: number) => top + ((100 - v) / 100) * (bot - top);
    const n = cands.length;
    const bw = plotW / n;
    ctx.font = AXIS_FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of [0, 25, 50, 75, 100]) {
      ctx.strokeStyle = v === 0 ? P.lineStrong : P.chartGrid;
      ctx.beginPath();
      ctx.moveTo(padL, yOf(v));
      ctx.lineTo(padL + plotW, yOf(v));
      ctx.stroke();
      ctx.fillStyle = P.muted;
      ctx.fillText(`${v}%`, padL - 6, yOf(v));
    }
    cands.forEach((c, i) => {
      const pair = Math.max(2, bw * 0.72);
      const x = padL + i * bw + (bw - pair) / 2;
      const half = pair / 2;
      ctx.fillStyle = picked === null || picked === i ? P.sun : alpha(P.sun, 0.7);
      ctx.fillRect(x, yOf(c.m.sunlitPct), half, bot - yOf(c.m.sunlitPct));
      ctx.fillStyle = picked === null || picked === i ? P.earth : alpha(P.earth, 0.7);
      ctx.fillRect(x + half, yOf(c.m.earthPct), half, bot - yOf(c.m.earthPct));
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const every = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(plotW / 70))));
    cands.forEach((c, i) => {
      if (i % every) return;
      const d = new Date(c.t);
      ctx.fillStyle = P.muted;
      ctx.fillText(`${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`, padL + (i + 0.5) * bw, bot + 6);
    });
    if (picked !== null) {
      ctx.strokeStyle = P.heading;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(padL + picked * bw + 0.5, top, Math.max(1, bw - 1), bot - top);
    }
  });
  const idx = (clientX: number) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    const f = (clientX - r.left - geo.current.padL) / geo.current.plotW;
    if (f < 0 || f >= 1) return null;
    return Math.floor(f * cands.length);
  };
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="Sunlight and Earth view percentages for each candidate landing date"
      style={{ cursor: 'pointer' }}
      onPointerMove={(e) => onHover(idx(e.clientX))}
      onPointerLeave={() => onHover(null)}
      onClick={(e) => {
        const i = idx(e.clientX);
        if (i !== null) onClick(i);
      }}
    />
  );
}

export function SlipPage({ catalog, scenario, site, onPick, onChange }: Props) {
  const [spanDays, setSpanDays] = useState(60);
  const [stepH, setStepH] = useState(24);
  const [priority, setPriority] = useState<Priority>('both');
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!site) return;
    let live = true;
    const t0 = scenario.startMs;
    const tEnd = t0 + spanDays * DAY + scenario.durationH * 3600e3;
    setCands(null);
    ensureRange(t0, tEnd)
      .then(() => {
        if (!live) return;
        const stepMin = spanDays > 120 ? 30 : 15;
        const s = computeSeries(site, { startMs: t0, endMs: tEnd, stepMin, mastM: mastOf(scenario), minEarthElDeg: scenario.minEarthEl });
        const perStep = (stepH * 60) / stepMin;
        const win = Math.round((scenario.durationH * 60) / stepMin);
        const out: Candidate[] = [];
        for (let i0 = 0; i0 + win < s.n; i0 += perStep) out.push({ t: s.t[i0], m: metrics(sliceSeries(s, i0, i0 + win)) });
        setCands(out);
        setError(null);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [site, scenario, spanDays, stepH]);

  const ranked = useMemo(() => (cands ? [...cands].sort((a, b) => score(b.m, priority) - score(a.m, priority)).slice(0, 6) : []), [cands, priority]);
  const shown = hover !== null && cands ? cands[hover] : null;

  return (
    <main className="page stack">
      <div className="panel panel-pad">
        <h2>Launch slip explorer</h2>
        <p style={{ margin: '0 0 12px', maxWidth: 760 }}>
          If the launch slips, how do sunlight and Earth contact change? Each pair of bars is one possible landing time at{' '}
          <b>{site?.name ?? 'the selected site'}</b>, followed by a mission of {fmtDur(scenario.durationH)}. Click a bar to open that date in Explore.
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
          <label className="field" style={{ margin: 0 }}>
            <span className="field-label">Site</span>
            <select className="input" value={scenario.custom ? 'custom' : scenario.siteId} onChange={(e) => onChange({ ...scenario, siteId: e.target.value, custom: undefined })}>
              {scenario.custom && <option value="custom">{site?.name}</option>}
              {catalog.groups.map((g) => (
                <optgroup key={g} label={g}>
                  {catalog.sites
                    .filter((s) => s.group === g)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.short ?? s.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span className="field-label">Mission length</span>
            <select className="input" value={DURATIONS.find((d) => Math.abs(d.h - scenario.durationH) < 0.01)?.h ?? ''} onChange={(e) => onChange({ ...scenario, durationH: parseFloat(e.target.value) })}>
              {!DURATIONS.some((d) => Math.abs(d.h - scenario.durationH) < 0.01) && <option value="">{fmtDur(scenario.durationH)}</option>}
              {DURATIONS.map((d) => (
                <option key={d.h} value={d.h}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span className="field-label">Search span from {fmtUtc(scenario.startMs, true).slice(0, 11)}</span>
            <select className="input" value={spanDays} onChange={(e) => setSpanDays(+e.target.value)}>
              {[30, 60, 120, 365].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span className="field-label">Candidate every</span>
            <select className="input" value={stepH} onChange={(e) => setStepH(+e.target.value)}>
              <option value={6}>6 hours</option>
              <option value={12}>12 hours</option>
              <option value={24}>1 day</option>
            </select>
          </label>
          <div className="field" style={{ margin: 0 }}>
            <span className="field-label">Rank by</span>
            <div className="chips">
              {PRIORITIES.map(([k, l]) => (
                <button key={k} className="chip" type="button" aria-pressed={priority === k} onClick={() => setPriority(k)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="panel chart-card">
        <div className="chart-head">
          <h2>Sunlight and Earth view by landing date</h2>
          <div className="legend">
            <span>
              <i style={{ background: 'var(--sun)' }} />
              Sunlight %
            </span>
            <span>
              <i style={{ background: 'var(--earth)' }} />
              Earth in view %
            </span>
          </div>
        </div>
        {cands ? (
          <SlipChart cands={cands} picked={hover} onHover={setHover} onClick={(i) => onPick(cands[i].t)} />
        ) : (
          <p className="hint">Computing {spanDays} days of landing options...</p>
        )}
        <div className="readout" aria-live="polite">
          {shown ? (
            <>
              <span>
                Land <b className="mono">{fmtUtc(shown.t, true)} UTC</b>
              </span>
              <span>
                Sunlight <b className="mono">{shown.m.sunlitPct.toFixed(0)}%</b>, longest dark <b className="mono">{fmtGap(shown.m.longestDarkH)}</b>
              </span>
              <span>
                Earth <b className="mono">{shown.m.earthPct.toFixed(0)}%</b>, longest gap <b className="mono">{fmtGap(shown.m.longestCommGapH)}</b>
              </span>
            </>
          ) : (
            <span>Point at a bar to read its date. Click or tap a bar to open it in Explore.</span>
          )}
        </div>
      </div>
      <div className="panel panel-pad" style={{ overflowX: 'auto' }}>
        <h2>Best landing times in this span</h2>
        <table className="cmp-table">
          <thead>
            <tr>
              <th>Landing (UTC)</th>
              <th>Sunlight</th>
              <th>Longest dark</th>
              <th>Earth in view</th>
              <th>Longest gap</th>
              <th>Both</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ranked.map((c) => (
              <tr key={c.t}>
                <td className="num">{fmtUtc(c.t, true)}</td>
                <td className="num">{c.m.sunlitPct.toFixed(0)}%</td>
                <td className="num">{fmtGap(c.m.longestDarkH)}</td>
                <td className="num">{c.m.earthPct.toFixed(0)}%</td>
                <td className="num">{fmtGap(c.m.longestCommGapH)}</td>
                <td className="num">{c.m.bothPct.toFixed(0)}%</td>
                <td>
                  <button className="btn small" type="button" onClick={() => onPick(c.t)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
