import { useEffect, useMemo, useState } from 'react';
import { loadPref, savePref } from './prefs';
import type { Series } from '../core/analysis';
import { PACK_WH_PER_KG, powerBudget } from '../core/plan';
import { fmtUtc } from './Timeline';
import { AXIS_FONT, alpha, palette } from './theme';
import { useCanvas } from './useCanvas';

function num(v: string, lo: number, hi: number, fallback: number): number {
  const x = parseFloat(v);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;
}

function fmtKWh(v: number): string {
  if (v < 0.05) return '0';
  return v < 10 ? v.toFixed(1) : v.toFixed(0);
}

function LevelChart({ level, levelT, worstAt }: { level: Float32Array; levelT: Float64Array; worstAt: number | null }) {
  const { ref } = useCanvas(96, (ctx, w, h) => {
    const P = palette();
    const padL = 40;
    const top = 6;
    const bot = h - 20;
    const n = level.length;
    if (n < 2) return;
    const t0 = levelT[0];
    const t1 = levelT[n - 1];
    const xOf = (t: number) => padL + ((t - t0) / (t1 - t0 || 1)) * (w - padL - 4);
    const yOf = (v: number) => top + (1 - v) * (bot - top);
    ctx.fillStyle = P.sky;
    ctx.fillRect(padL, top, w - padL - 4, bot - top);
    ctx.font = AXIS_FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of [0, 0.5, 1]) {
      ctx.strokeStyle = v === 0 ? P.lineStrong : P.chartGrid;
      ctx.beginPath();
      ctx.moveTo(padL, Math.round(yOf(v)) + 0.5);
      ctx.lineTo(w - 4, Math.round(yOf(v)) + 0.5);
      ctx.stroke();
      ctx.fillStyle = P.muted;
      ctx.fillText(`${v * 100}%`, padL - 6, yOf(v));
    }
    ctx.beginPath();
    ctx.moveTo(xOf(levelT[0]), yOf(0));
    for (let i = 0; i < n; i++) ctx.lineTo(xOf(levelT[i]), yOf(level[i]));
    ctx.lineTo(xOf(levelT[n - 1]), yOf(0));
    ctx.closePath();
    ctx.fillStyle = alpha(P.ink, 0.12);
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < n; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, xOf(levelT[i]), yOf(level[i]));
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (worstAt !== null) {
      const x = xOf(worstAt);
      ctx.strokeStyle = P.heading;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bot);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = P.muted;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(fmtUtc(t0), padL, bot + 5);
    ctx.textAlign = 'right';
    ctx.fillText(fmtUtc(t1), w - 4, bot + 5);
  });
  return <canvas ref={ref} role="img" aria-label="Battery charge over the mission window, with a battery sized to just get through it" />;
}

export function PowerBudget({ series }: { series: Series }) {
  // The last panel and load you entered are remembered in this browser.
  const saved = loadPref('budget', { area: '4', eff: '30', load: '300' });
  const [area, setArea] = useState(saved.area);
  const [eff, setEff] = useState(saved.eff);
  const [load, setLoad] = useState(saved.load);
  useEffect(() => savePref('budget', { area, eff, load }), [area, eff, load]);
  const input = useMemo(
    () => ({ areaM2: num(area, 0.1, 500, 4), efficiency: num(eff, 1, 60, 30) / 100, loadW: num(load, 0, 100000, 300) }),
    [area, eff, load],
  );
  const r = useMemo(() => powerBudget(series, input), [series, input]);
  const field = (id: string, label: string, unit: string, v: string, set: (s: string) => void) => (
    <div className="field compact">
      <label htmlFor={id}>{label}</label>
      <div className="row">
        <input id={id} className="input mono" inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} />
        <span className="hint" style={{ margin: 0 }}>
          {unit}
        </span>
      </div>
    </div>
  );
  return (
    <section className="panel panel-pad" aria-labelledby="budget-h">
      <div className="panel-head">
        <h2 id="budget-h">Power budget</h2>
        <span className="hint" style={{ margin: 0 }}>
          Sun-tracking panel, constant load
        </span>
      </div>
      <div className="budget">
        <div className="budget-inputs">
          {field('pb-area', 'Panel area', 'm²', area, setArea)}
          {field('pb-eff', 'Efficiency', '%', eff, setEff)}
          {field('pb-load', 'Load', 'W', load, setLoad)}
        </div>
        <div className="budget-out">
          <div className="budget-figs">
            <div>
              <div className="overline">Battery needed</div>
              <div className="big mono">
                {fmtKWh(r.batteryKWh)}
                <small>kWh</small>
              </div>
              <div className="hint" style={{ margin: 0 }}>
                {r.batteryKWh < 0.05 ? 'Generation covers the load all window' : `About ${Math.round(r.batteryKg)} kg at ${PACK_WH_PER_KG} Wh/kg`}
              </div>
            </div>
            <div>
              <div className="overline">Energy balance</div>
              <div className="big mono">
                {r.netKWh >= 0 ? '+' : '-'}
                {fmtKWh(Math.abs(r.netKWh))}
                <small>kWh</small>
              </div>
              <div className="hint" style={{ margin: 0 }}>
                {fmtKWh(r.generatedKWh)} generated, {fmtKWh(r.usedKWh)} used
              </div>
            </div>
            <div>
              <div className="overline">Load covered by Sun</div>
              <div className="big mono">
                {r.coversLoadPct.toFixed(0)}
                <small>%</small>
              </div>
              <div className="hint" style={{ margin: 0 }}>
                Peak output {Math.round(r.peakW)} W
              </div>
            </div>
          </div>
          <LevelChart level={r.level} levelT={r.levelT} worstAt={r.worstAt} />
          <p className="hint" style={{ margin: 0 }}>
            Battery charge with the smallest battery that gets through this window, starting full.
            {r.worstAt !== null ? ` Lowest point ${fmtUtc(r.worstAt, true)} UTC (dashed line).` : ''} Ignores panel temperature, dust and battery losses.
          </p>
        </div>
      </div>
    </section>
  );
}
