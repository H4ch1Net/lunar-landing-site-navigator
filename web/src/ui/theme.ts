/**
 * Canvas colors and fonts from the Shackleton Ridge design system.
 * Values come from the CSS custom properties in styles.css, so the stylesheet stays the single source.
 */

const FALLBACK: Record<string, string> = {
  '--sky': '#000000',
  '--sky-grid': '#2e2e32',
  '--chart-grid': '#2e2e32',
  '--terrain': '#2e2e32',
  '--terrain-edge': '#959599',
  '--sun': '#f5af0c',
  '--earth': '#609af6',
  '--both': '#1fcf62',
  '--heading': '#ffffff',
  '--ink': '#e3e3e3',
  '--muted': '#b9b9bb',
  '--line': '#2e2e32',
  '--line-strong': '#77777a',
  '--surface': '#17171b',
  '--surface-raised': '#2e2e32',
  '--carbon-60': '#58585b',
};

export interface Palette {
  sky: string;
  skyGrid: string;
  chartGrid: string;
  terrain: string;
  terrainEdge: string;
  sun: string;
  earth: string;
  both: string;
  heading: string;
  ink: string;
  muted: string;
  line: string;
  lineStrong: string;
  surface: string;
  surfaceRaised: string;
  horizon: string;
}

let cached: Palette | null = null;

export function palette(): Palette {
  if (cached) return cached;
  const cs = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const v = (name: string) => (cs?.getPropertyValue(name).trim() || FALLBACK[name]) as string;
  const p: Palette = {
    sky: v('--sky'),
    skyGrid: v('--sky-grid'),
    chartGrid: v('--chart-grid'),
    terrain: v('--terrain'),
    terrainEdge: v('--terrain-edge'),
    sun: v('--sun'),
    earth: v('--earth'),
    both: v('--both'),
    heading: v('--heading'),
    ink: v('--ink'),
    muted: v('--muted'),
    line: v('--line'),
    lineStrong: v('--line-strong'),
    surface: v('--surface'),
    surfaceRaised: v('--surface-raised'),
    horizon: v('--carbon-60'),
  };
  if (cs) cached = p;
  return p;
}

/** A hex color with alpha, for band fills. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const FONT_UI = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';

/** Chart text: HDS axis style, Inter 12px. */
export const AXIS_FONT = `12px ${FONT_UI}`;
export const AXIS_FONT_SEMIBOLD = `600 12px ${FONT_UI}`;
