import { useMemo } from 'react';
import type { Series, Site, Snapshot } from '../core/analysis';
import { maskAt } from '../core/geometry';
import { AXIS_FONT, AXIS_FONT_SEMIBOLD, alpha, palette } from './theme';
import { niceStep, useCanvas } from './useCanvas';

interface Props {
  site: Site;
  series: Series | null;
  snap: Snapshot | null;
  height?: number;
  compact?: boolean;
  centerAz?: number;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function skyRange(site: Site, series: Series | null): [number, number] {
  let mMin = 0;
  let mMax = 0;
  if (site.mask) {
    mMin = Infinity;
    mMax = -Infinity;
    for (const v of site.mask) {
      mMin = Math.min(mMin, v);
      mMax = Math.max(mMax, v);
    }
  }
  let bMax = mMax;
  if (series) {
    for (let i = 0; i < series.n; i++) {
      bMax = Math.max(bMax, series.sunEl[i] + series.sunRad[i], series.earthEl[i] + series.earthRad[i]);
    }
  }
  let lo = Math.max(-12, Math.min(-1.5, mMin - 0.8));
  let hi = Math.min(90, Math.max(mMax + 1.5, bMax + 1.2));
  if (hi - lo < 9) hi = lo + 9;
  if (hi > 90) {
    hi = 90;
    lo = Math.min(lo, 81);
  }
  return [lo, hi];
}

/** Earth (or any body) disk with its lit fraction k, lit side toward angle (radians, screen). */
function phaseDisk(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, k: number, angle: number, lit: string, night: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = night;
  ctx.fill();
  const w = Math.abs(2 * k - 1) * r;
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false); // lit half toward +x
  if (k >= 0.5) ctx.ellipse(0, 0, w, r, 0, Math.PI / 2, -Math.PI / 2, false);
  else ctx.ellipse(0, 0, w, r, 0, Math.PI / 2, (3 * Math.PI) / 2, true);
  ctx.closePath();
  ctx.fillStyle = lit;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = alpha(lit, 0.6);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

export function SkyView({ site, series, snap, height = 320, compact = false, centerAz }: Props) {
  const range = useMemo(() => skyRange(site, series), [site, series]);
  const center = useMemo(() => {
    if (centerAz !== undefined) return centerAz;
    if (series && series.n > 0) return Math.round(series.earthAz[0] / 10) * 10;
    return 180;
  }, [series, centerAz]);

  const { ref } = useCanvas(height, (ctx, w, h) => {
    const P = palette();
    const padL = compact ? 0 : 40;
    const padB = compact ? 16 : 24;
    const plotW = w - padL - (compact ? 0 : 4);
    const plotH = h - padB - 4;
    const top = 4;
    const [lo, hi] = range;
    const az0 = center - 180;
    const xOf = (az: number) => padL + ((((az - az0) % 360) + 360) % 360) * (plotW / 360);
    const yOf = (el: number) => top + ((hi - el) / (hi - lo)) * plotH;
    const pxPerDeg = plotH / (hi - lo);

    // Sky: black in every theme
    ctx.fillStyle = P.sky;
    ctx.fillRect(padL, top, plotW, plotH);

    // Elevation grid; the astronomical horizon (0°) is dashed
    const step = niceStep(hi - lo, compact ? 3 : 6);
    ctx.font = AXIS_FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (let el = Math.ceil(lo / step) * step; el <= hi; el += step) {
      const y = Math.round(yOf(el)) + 0.5;
      const zero = Math.abs(el) < 1e-9;
      ctx.strokeStyle = zero ? P.horizon : P.skyGrid;
      ctx.setLineDash(zero ? [4, 4] : []);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      if (!compact) {
        ctx.fillStyle = P.muted;
        ctx.fillText(`${+el.toFixed(1)}°`, padL - 6, y);
      }
    }
    ctx.setLineDash([]);
    // Azimuth grid every 45°
    for (let k = 0; k < 8; k++) {
      const x = Math.round(xOf(k * 45)) + 0.5;
      ctx.strokeStyle = P.skyGrid;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + plotH);
      ctx.stroke();
    }

    // Everything below is drawn inside the plot only
    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, top, plotW, plotH);
    ctx.clip();

    // Paths over the window: solid up to the selected time, dotted after it
    if (series) {
      const tNow = snap ? snap.t : -Infinity;
      const track = (az: Float32Array, el: Float32Array, color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        const stride = Math.max(1, Math.floor(series.n / 1500));
        for (const past of [true, false]) {
          ctx.setLineDash(past ? [] : [2, 4]);
          ctx.globalAlpha = past ? 0.9 : 0.75;
          ctx.beginPath();
          let px = -1e9;
          let open = false;
          for (let i = 0; i < series.n; i += stride) {
            const isPast = series.t[i] <= tNow;
            if (isPast !== past) {
              open = false;
              continue;
            }
            const x = xOf(az[i]);
            const y = yOf(el[i]);
            if (!open || Math.abs(x - px) > plotW / 2) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            px = x;
            open = true;
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      };
      track(series.sunAz, series.sunEl, P.sun);
      track(series.earthAz, series.earthEl, P.earth);
    }

    // Bodies at the selected time (drawn before terrain so terrain hides them)
    if (snap) {
      const ex = xOf(snap.earth.az);
      const ey = yOf(snap.earth.el);
      const er = Math.max(3.5, snap.earth.rad * pxPerDeg);
      let dAz = ((snap.sun.az - snap.earth.az + 540) % 360) - 180;
      dAz *= Math.cos((snap.earth.el * Math.PI) / 180);
      const ang = Math.atan2(-(snap.sun.el - snap.earth.el), dAz);
      if (snap.earth.el > lo - 3) phaseDisk(ctx, ex, ey, er, snap.earth.phase, ang, P.earth, P.sky);

      const sx = xOf(snap.sun.az);
      const sy = yOf(snap.sun.el);
      const sr = Math.max(3, snap.sun.rad * pxPerDeg);
      if (snap.sun.el > lo - 3) {
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fillStyle = P.sun;
        ctx.fill();
      }
    }

    // Terrain silhouette with its ridge line
    ctx.beginPath();
    ctx.moveTo(padL, top + plotH);
    for (let x = 0; x <= plotW; x++) {
      const az = az0 + (x / plotW) * 360;
      ctx.lineTo(padL + x, yOf(maskAt(site.mask, az)));
    }
    ctx.lineTo(padL + plotW, top + plotH);
    ctx.closePath();
    ctx.fillStyle = P.terrain;
    ctx.fill();
    ctx.strokeStyle = P.terrainEdge;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let x = 0; x <= plotW; x++) {
      const az = az0 + (x / plotW) * 360;
      const y = yOf(maskAt(site.mask, az));
      if (x === 0) ctx.moveTo(padL + x, y);
      else ctx.lineTo(padL + x, y);
    }
    ctx.stroke();
    ctx.restore();

    // A body behind terrain keeps its place as an outline with the word "hidden"
    if (snap) {
      ctx.font = AXIS_FONT_SEMIBOLD;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const mark = (az: number, el: number, hz: number, color: string, label: string) => {
        const x = xOf(az);
        if (el < hz) {
          const y = Math.min(yOf(Math.max(el, lo)), top + plotH - 7);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.stroke();
          if (!compact) {
            ctx.fillStyle = color;
            ctx.fillText(`${label} hidden`, x, y - 9);
          }
        }
      };
      mark(snap.sun.az, snap.sun.el, snap.sun.hz - snap.sun.rad, P.sun, 'Sun');
      mark(snap.earth.az, snap.earth.el, snap.earth.hz - snap.earth.rad, P.earth, 'Earth');

      // Name each visible body beside its disc, with its height above the terrain.
      if (!compact) {
        ctx.textBaseline = 'middle';
        const placed: [number, number][] = [];
        const tag = (az: number, el: number, hz: number, rad: number, r: number, color: string, label: string) => {
          if (el + rad < hz || el > hi || el < lo) return;
          const x = xOf(az);
          let y = yOf(el);
          const text = `${label} ${el - hz >= 0 ? '+' : ''}${(el - hz).toFixed(1)}°`;
          const w = ctx.measureText(text).width;
          const right = x + r + 8 + w < padL + plotW - 4;
          const tx = right ? x + r + 8 : x - r - 8;
          for (const [px, py] of placed) if (Math.abs(px - tx) < w + 12 && Math.abs(py - y) < 16) y = py + (y >= py ? 18 : -18);
          y = Math.max(top + 10, Math.min(top + plotH - 10, y));
          placed.push([tx, y]);
          // A backing keeps the paths from running through the words.
          ctx.fillStyle = alpha(P.sky, 0.8);
          ctx.fillRect(right ? tx - 3 : tx - w - 3, y - 9, w + 6, 18);
          ctx.textAlign = right ? 'left' : 'right';
          ctx.fillStyle = color;
          ctx.fillText(text, tx, y);
        };
        tag(snap.sun.az, snap.sun.el, snap.sun.hz, snap.sun.rad, Math.max(3, snap.sun.rad * pxPerDeg), P.sun, 'Sun');
        tag(snap.earth.az, snap.earth.el, snap.earth.hz, snap.earth.rad, Math.max(3.5, snap.earth.rad * pxPerDeg), P.earth, 'Earth');
      }
    }

    // Azimuth axis
    ctx.font = AXIS_FONT;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    for (let k = 0; k < 8; k++) {
      const x = xOf(k * 45);
      if (x < padL + 10 || x > padL + plotW - 10) continue;
      ctx.fillStyle = k % 2 === 0 ? P.ink : P.muted;
      ctx.fillText(COMPASS[k], x, top + plotH + (compact ? 3 : 6));
    }
    ctx.strokeStyle = P.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(padL + 0.5, top + 0.5, plotW - 1, plotH - 1);
  });

  const label = snap
    ? `Horizon view. Sun ${(snap.sun.el - snap.sun.hz).toFixed(1)} degrees ${snap.sun.el >= snap.sun.hz ? 'above' : 'below'} the terrain at azimuth ${snap.sun.az.toFixed(0)}. Earth ${(snap.earth.el - snap.earth.hz).toFixed(1)} degrees ${snap.earth.el >= snap.earth.hz ? 'above' : 'below'} the terrain at azimuth ${snap.earth.az.toFixed(0)}.`
    : 'Horizon view with the Sun and Earth paths over the mission window';
  return <canvas ref={ref} role="img" aria-label={label} />;
}
