import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { snapshot, type Site } from '../core/analysis';
import { mastOf, type Scenario } from '../core/scenario';
import { missionEvents } from '../core/plan';
import { loadPref, savePref } from './prefs';
import type { StoryScenario, Tab } from '../App';
import { Stories } from './Stories';
import { PowerBudget } from './PowerBudget';
import { EventsPanel } from './EventsPanel';
import { NearbySearch } from './NearbySearch';
import type { SiteCatalog } from '../core/sites';
import { MetricsPanel, Verdict, fmtDur } from './MetricsPanel';
import { Icon } from './Icon';
import { ScenarioEditor } from './ScenarioEditor';
import { SkyView } from './SkyView';
import { Timeline, fmtUtc } from './Timeline';
import { useAnalysis } from './useAnalysis';
// Leaflet is only needed when the map opens, so load it on demand.
const PolarMapDialog = lazy(() => import('./PolarMap').then((m) => ({ default: m.PolarMapDialog })));

interface Props {
  catalog: SiteCatalog;
  scenario: Scenario;
  site: Site | null;
  onChange: (s: Scenario) => void;
  onCompare: () => void;
  onStory: (list: StoryScenario[], tab: Tab) => void;
}

/** The cursor time in the viewer's own time zone, or null when that is UTC anyway. */
function localLabel(t: number): string | null {
  if (new Date(t).getTimezoneOffset() === 0) return null;
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ExplorePage({ catalog, scenario, site, onChange, onCompare, onStory }: Props) {
  const mastM = mastOf(scenario);
  const { series, metrics, error, busy } = useAnalysis(site, scenario.startMs, scenario.durationH, scenario.minEarthEl, mastM);
  const [cursor, setCursor] = useState(scenario.startMs);
  const [playing, setPlaying] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [speed, setSpeed] = useState<number>(() => loadPref('speed', 1));
  useEffect(() => savePref('speed', speed), [speed]);
  const endMs = scenario.startMs + scenario.durationH * 3600e3;
  const raf = useRef(0);

  useEffect(() => {
    setCursor((c) => (c < scenario.startMs || c > endMs ? scenario.startMs : c));
  }, [scenario.startMs, endMs]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const span = endMs - scenario.startMs;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setCursor((c) => {
        const next = c + ((span / 15000) * speed) * dt; // whole window in about 15 s at 1x
        if (next >= endMs) {
          setPlaying(false);
          return endMs;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, endMs, scenario.startMs, speed]);

  // Sunrise, sunset, Earthrise and Earthset inside the window, for the event buttons and keys.
  const events = useMemo(() => (metrics ? missionEvents(metrics, scenario.startMs, endMs) : []), [metrics, scenario.startMs, endMs]);
  const prevEv = [...events].reverse().find((e) => e.t < cursor - 60e3) ?? null;
  const nextEv = events.find((e) => e.t > cursor + 60e3) ?? null;
  const jump = (t: number) => {
    setPlaying(false);
    setCursor(Math.min(endMs, Math.max(scenario.startMs, t)));
  };
  const jumpRef = useRef({ prev: prevEv, next: nextEv, jump });
  jumpRef.current = { prev: prevEv, next: nextEv, jump };

  // Keys: Space plays and pauses; arrows step an hour (Shift: a day); [ and ] jump between events;
  // Home and End go to the ends. Ignored while typing, on buttons, in the map, or on the timeline (it has its own).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, select, textarea, button, a, [role="dialog"], [role="slider"]') || t.isContentEditable)) return;
      const { prev, next, jump: go } = jumpRef.current;
      const H = 3600e3;
      if (e.key === ' ' && !e.repeat) {
        setPlaying((p) => {
          if (!p) setCursor((c) => (c >= endMs - 1 ? scenario.startMs : c));
          return !p;
        });
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const step = (e.shiftKey ? 24 : 1) * H * (e.key === 'ArrowRight' ? 1 : -1);
        setPlaying(false);
        setCursor((c) => Math.min(endMs, Math.max(scenario.startMs, c + step)));
      } else if (e.key === ']' && next) go(next.t);
      else if (e.key === '[' && prev) go(prev.t);
      else if (e.key === 'Home') go(scenario.startMs);
      else if (e.key === 'End') go(endMs);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [endMs, scenario.startMs]);

  const snap = useMemo(() => {
    if (!site || !series) return null;
    try {
      return snapshot(site, Math.min(Math.max(cursor, scenario.startMs), endMs), mastM, scenario.minEarthEl);
    } catch {
      return null;
    }
  }, [site, series, cursor, scenario.startMs, endMs, mastM, scenario.minEarthEl]);

  const nextEvent = useMemo(() => {
    if (!metrics || !snap) return null;
    const out: string[] = [];
    const sunIv = metrics.sunIntervals.find((x) => x.start <= cursor && x.end > cursor);
    if (sunIv) out.push(sunIv.end >= endMs - 1 ? 'Sun up to the end of the window' : `Sunset in ${fmtDur((sunIv.end - cursor) / 3600e3)}`);
    else {
      const nx = metrics.sunIntervals.find((x) => x.start > cursor);
      out.push(nx ? `Sunrise in ${fmtDur((nx.start - cursor) / 3600e3)}` : 'No sunrise before the window ends');
    }
    const eIv = metrics.earthIntervals.find((x) => x.start <= cursor && x.end > cursor);
    if (eIv) out.push(eIv.end >= endMs - 1 ? 'Earth in view to the end of the window' : `Earthset in ${fmtDur((eIv.end - cursor) / 3600e3)}`);
    else {
      const nx = metrics.earthIntervals.find((x) => x.start > cursor);
      out.push(nx ? `Earthrise in ${fmtDur((nx.start - cursor) / 3600e3)}` : 'No Earthrise before the window ends');
    }
    return out;
  }, [metrics, snap, cursor, endMs]);

  return (
    <main className="layout">
      <aside className="stack">
        <ScenarioEditor scenario={scenario} site={site} catalog={catalog} onChange={onChange} onOpenMap={() => setMapOpen(true)} />
        <button className="btn" type="button" onClick={onCompare}>
          Compare with another date or site
        </button>
      </aside>
      <section className="stack" aria-label="Results">
        <Stories onStory={onStory} />
        {error && <div className="error">{error}</div>}
        {site && (
          <div className="panel chart-card">
            <div className="chart-head">
              <h2>
                Horizon at {snap ? fmtUtc(snap.t, true) : ''} UTC
                {busy && <span className="busy"> · updating</span>}
              </h2>
              <div className="legend">
                <span>
                  <i className="round" style={{ background: 'var(--sun)' }} />
                  Sun
                </span>
                <span>
                  <i className="round" style={{ background: 'var(--earth)' }} />
                  Earth with its phase
                </span>
                <span>
                  <i style={{ width: 16, height: 0, borderTop: '2px dotted var(--muted)' }} />
                  Path ahead
                </span>
                <span>
                  <i className="terrain" />
                  {site.mask ? 'LOLA terrain' : 'Smooth horizon'}
                </span>
              </div>
            </div>
            <SkyView site={site} series={series} snap={snap} height={300} />
            {snap && (
              <div className="readout">
                <span>
                  Sun <b className="mono">{(snap.sun.el - snap.sun.hz).toFixed(2)}°</b> {snap.sun.el >= snap.sun.hz ? 'above' : 'below'} terrain, az{' '}
                  <b className="mono">{snap.sun.az.toFixed(1)}°</b>, disk <b className="mono">{(snap.sun.frac * 100).toFixed(0)}%</b> visible
                </span>
                <span>
                  Earth <b className="mono">{(snap.earth.el - snap.earth.hz).toFixed(2)}°</b> {snap.earth.el >= snap.earth.hz ? 'above' : 'below'} terrain, az{' '}
                  <b className="mono">{snap.earth.az.toFixed(1)}°</b>, phase <b className="mono">{(snap.earth.phase * 100).toFixed(0)}%</b> lit
                </span>
                {nextEvent && <span>{nextEvent.join(' · ')}</span>}
              </div>
            )}
          </div>
        )}
        {series && (
          <div className="panel chart-card">
            <div className="chart-head">
              <h2>Mission window</h2>
              <div className="player">
                <button className="btn primary small" type="button" onClick={() => {
                  if (!playing && cursor >= endMs - 1) setCursor(scenario.startMs);
                  setPlaying((p) => !p);
                }} aria-label={playing ? 'Pause playback' : 'Play the mission window'}>
                  <Icon name={playing ? 'pause' : 'play'} />
                  {playing ? 'Pause' : 'Play'}
                </button>
                <span className="time">
                  {fmtUtc(cursor, true)} UTC
                  {localLabel(cursor) && <span className="local"> · {localLabel(cursor)} your time</span>}
                </span>
                <div className="row player-tools">
                  <button className="btn small" type="button" disabled={!prevEv} onClick={() => prevEv && jump(prevEv.t)} title={prevEv ? `${prevEv.kind}, ${fmtUtc(prevEv.t, true)} UTC` : undefined}>
                    Previous event
                  </button>
                  <button className="btn small" type="button" disabled={!nextEv} onClick={() => nextEv && jump(nextEv.t)} title={nextEv ? `${nextEv.kind}, ${fmtUtc(nextEv.t, true)} UTC` : undefined}>
                    {nextEv ? `Next: ${nextEv.kind}` : 'Next event'}
                  </button>
                  <div className="chips" role="group" aria-label="Playback speed">
                    {[0.5, 1, 2, 4].map((v) => (
                      <button key={v} type="button" className="chip" aria-pressed={speed === v} onClick={() => setSpeed(v)}>
                        {v}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <p className="hint keys-hint">
              Drag the chart to move in time. Keys: Space plays, arrows step an hour (Shift for a day), [ and ] jump between events.
            </p>
            <Timeline series={series} cursorMs={cursor} onCursor={(t) => { setPlaying(false); setCursor(t); }} />
          </div>
        )}
        {metrics && <Verdict m={metrics} />}
        {metrics && <MetricsPanel m={metrics} />}
        {series && <PowerBudget series={series} />}
        {site && series && metrics && (
          <EventsPanel
            site={site}
            series={series}
            metrics={metrics}
            onJump={(t) => {
              setPlaying(false);
              setCursor(t);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}
        {site && (
          <NearbySearch
            site={site}
            startMs={scenario.startMs}
            durationH={scenario.durationH}
            minEarthEl={scenario.minEarthEl}
            mastM={mastM}
            onUse={(lat, lon, name) => {
              onChange({ ...scenario, siteId: 'custom', custom: { lat: +lat.toFixed(5), lon: +lon.toFixed(5), name } });
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}
      </section>
      {mapOpen && (
        <Suspense fallback={<div className="modal-backdrop"><div className="modal panel hint">Loading the south pole map...</div></div>}>
        <PolarMapDialog
          catalog={catalog}
          current={site}
          onClose={() => setMapOpen(false)}
          onPick={(pick) => {
            setMapOpen(false);
            if (pick.siteId) onChange({ ...scenario, siteId: pick.siteId, custom: undefined });
            else onChange({ ...scenario, siteId: 'custom', custom: { lat: pick.lat, lon: pick.lon } });
          }}
        />
        </Suspense>
      )}
    </main>
  );
}
