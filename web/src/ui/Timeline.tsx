import { useRef } from 'react';
import type { Series } from '../core/analysis';
import { AXIS_FONT, alpha, palette } from './theme';
import { niceStep, useCanvas } from './useCanvas';

interface Props {
  series: Series;
  cursorMs: number;
  onCursor?: (t: number) => void;
  height?: number;
  compact?: boolean;
}

const DAY = 86400e3;

export function fmtUtc(t: number, withYear = false): string {
  const d = new Date(t);
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const s = `${mon} ${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return withYear ? `${d.getUTCFullYear()} ${s}` : s;
}

export function Timeline({ series, cursorMs, onCursor, height = 210, compact = false }: Props) {
  const geo = useRef({ padL: 0, plotW: 1 });
  const dragging = useRef(false);

  const { ref } = useCanvas(height, (ctx, w, h) => {
    const P = palette();
    const padL = compact ? 6 : 92;
    const padR = compact ? 6 : 10;
    const plotW = w - padL - padR;
    geo.current = { padL, plotW };
    const t0 = series.t[0];
    const t1 = series.t[series.n - 1];
    const xOf = (t: number) => padL + ((t - t0) / (t1 - t0)) * plotW;
    const bandH = compact ? 12 : 16;
    const yBand1 = 4;
    const yBand2 = yBand1 + bandH + 4;
    const chartTop = yBand2 + bandH + (compact ? 6 : 12);
    const chartBot = h - (compact ? 4 : 20);

    ctx.font = AXIS_FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    if (!compact) {
      ctx.fillStyle = P.ink;
      ctx.fillText('Sunlight', padL - 8, yBand1 + bandH / 2);
      ctx.fillText('Earth in view', padL - 8, yBand2 + bandH / 2);
    }

    // Bands: per-pixel column, max/any over the samples it covers
    const cols = Math.max(1, Math.floor(plotW));
    for (let c = 0; c < cols; c++) {
      const i0 = Math.floor((c / cols) * (series.n - 1));
      const i1 = Math.max(i0 + 1, Math.floor(((c + 1) / cols) * (series.n - 1)));
      let sf = 0;
      let eu = 0;
      for (let i = i0; i < i1; i++) {
        sf += series.sunFrac[i];
        eu += series.earthUp[i];
      }
      sf /= i1 - i0;
      eu /= i1 - i0;
      ctx.fillStyle = sf > 0 ? alpha(P.sun, 0.3 + 0.7 * sf) : P.surfaceRaised;
      ctx.fillRect(padL + c, yBand1, 1.02, bandH);
      ctx.fillStyle = eu > 0 ? alpha(P.earth, 0.3 + 0.7 * eu) : P.surfaceRaised;
      ctx.fillRect(padL + c, yBand2, 1.02, bandH);
    }

    // Margin chart: degrees of Sun and Earth centre above the terrain horizon
    let lo = -3;
    let hi = 3;
    for (let i = 0; i < series.n; i++) {
      const s = series.sunEl[i] - series.sunHz[i];
      const e = series.earthEl[i] - series.earthHz[i];
      lo = Math.min(lo, s, e);
      hi = Math.max(hi, s, e);
    }
    lo = Math.max(lo, -20);
    hi = Math.min(hi + 0.5, 90);
    const yOf = (v: number) => chartTop + ((hi - v) / (hi - lo)) * (chartBot - chartTop);
    ctx.fillStyle = P.sky;
    ctx.fillRect(padL, chartTop, plotW, chartBot - chartTop);
    const st = niceStep(hi - lo, compact ? 2 : 4);
    ctx.font = AXIS_FONT;
    for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) {
      const y = yOf(v);
      ctx.strokeStyle = Math.abs(v) < 1e-9 ? P.lineStrong : P.chartGrid;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      if (!compact) {
        ctx.fillStyle = P.muted;
        ctx.fillText(`${+v.toFixed(1)}°`, padL - 8, y);
      }
    }
    const line = (arr: (i: number) => number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const stride = Math.max(1, Math.floor(series.n / (plotW * 2)));
      for (let i = 0; i < series.n; i += stride) {
        const x = xOf(series.t[i]);
        const y = yOf(Math.max(lo, Math.min(hi, arr(i))));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    line((i) => series.earthEl[i] - series.earthHz[i], P.earth);
    line((i) => series.sunEl[i] - series.sunHz[i], P.sun);
    // Chart title on a backing so the lines never run through it.
    if (!compact) {
      ctx.save();
      ctx.font = AXIS_FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const label = 'Degrees above terrain';
      const lw = ctx.measureText(label).width;
      ctx.fillStyle = alpha(P.sky, 0.85);
      ctx.fillRect(padL + 1, chartTop + 1, lw + 12, 18);
      ctx.fillStyle = P.muted;
      ctx.fillText(label, padL + 7, chartTop + 10);
      ctx.restore();
    }

    // Day grid and labels
    const days = (t1 - t0) / DAY;
    // Day labels at least 52px apart, so they never collide on a phone.
    const pxPerDay = plotW / Math.max(days, 1e-6);
    const dayStep = [1, 2, 3, 7, 14, 30, 60].find((s) => s * pxPerDay >= 52) ?? 90;
    const first = Math.ceil(t0 / DAY) * DAY;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = AXIS_FONT;
    for (let t = first, k = 0; t <= t1; t += DAY, k++) {
      const x = xOf(t);
      ctx.strokeStyle = P.chartGrid;
      ctx.beginPath();
      ctx.moveTo(x, yBand1);
      ctx.lineTo(x, chartBot);
      ctx.stroke();
      if (!compact && k % dayStep === 0) {
        const d = new Date(t);
        ctx.fillStyle = P.muted;
        ctx.fillText(`${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`, x, chartBot + 5);
      }
    }

    // Cursor
    const cx = xOf(Math.max(t0, Math.min(t1, cursorMs)));
    ctx.strokeStyle = P.heading;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, 1);
    ctx.lineTo(cx, chartBot);
    ctx.stroke();
    ctx.fillStyle = P.heading;
    ctx.beginPath();
    ctx.moveTo(cx - 5, 0);
    ctx.lineTo(cx + 5, 0);
    ctx.lineTo(cx, 6);
    ctx.fill();
  });

  const toTime = (clientX: number) => {
    const c = ref.current;
    if (!c) return series.t[0];
    const rect = c.getBoundingClientRect();
    const f = (clientX - rect.left - geo.current.padL) / geo.current.plotW;
    const t0 = series.t[0];
    const t1 = series.t[series.n - 1];
    return t0 + Math.max(0, Math.min(1, f)) * (t1 - t0);
  };

  const step = (series.t[series.n - 1] - series.t[0]) / 200;
  return (
    <canvas
      ref={ref}
      role="slider"
      tabIndex={onCursor ? 0 : -1}
      aria-label="Time within the mission window. Use arrow keys to move."
      aria-valuemin={series.t[0]}
      aria-valuemax={series.t[series.n - 1]}
      aria-valuenow={cursorMs}
      aria-valuetext={fmtUtc(cursorMs, true) + ' UTC'}
      style={{ cursor: onCursor ? 'ew-resize' : 'default' }}
      onPointerDown={(e) => {
        if (!onCursor) return;
        dragging.current = true;
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        onCursor(toTime(e.clientX));
      }}
      onPointerMove={(e) => {
        if (dragging.current && onCursor) onCursor(toTime(e.clientX));
      }}
      onPointerUp={() => (dragging.current = false)}
      onKeyDown={(e) => {
        if (!onCursor) return;
        const t0 = series.t[0];
        const t1 = series.t[series.n - 1];
        const k = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowRight') onCursor(Math.min(t1, cursorMs + step * k));
        else if (e.key === 'ArrowLeft') onCursor(Math.max(t0, cursorMs - step * k));
        else if (e.key === 'Home') onCursor(t0);
        else if (e.key === 'End') onCursor(t1);
        else return;
        e.preventDefault();
      }}
    />
  );
}
