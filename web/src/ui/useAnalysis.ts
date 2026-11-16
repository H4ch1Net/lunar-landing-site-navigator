import { useEffect, useState } from 'react';
import { computeSeries, metrics, stepFor, type Metrics, type Series, type Site } from '../core/analysis';
import { ensureRange } from '../core/ephemeris';

export interface Analysis {
  series: Series | null;
  metrics: Metrics | null;
  error: string | null;
  /** True while a new window is being computed; the previous results stay on screen meanwhile. */
  busy: boolean;
}

export function useAnalysis(site: Site | null, startMs: number, durationH: number, minEarthEl: number, mastM: number): Analysis {
  const [state, setState] = useState<Analysis>({ series: null, metrics: null, error: null, busy: false });
  useEffect(() => {
    if (!site) return;
    let live = true;
    setState((s) => (s.busy ? s : { ...s, busy: true }));
    const endMs = startMs + durationH * 3600e3;
    ensureRange(startMs, endMs)
      .then(() => {
        if (!live) return;
        const series = computeSeries(site, { startMs, endMs, stepMin: stepFor(durationH), mastM, minEarthElDeg: minEarthEl });
        setState({ series, metrics: metrics(series), error: null, busy: false });
      })
      .catch((e: Error) => live && setState({ series: null, metrics: null, error: e.message, busy: false }));
    return () => {
      live = false;
    };
  }, [site, startMs, durationH, minEarthEl, mastM]);
  return state;
}
