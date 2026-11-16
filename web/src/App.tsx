import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Site } from './core/analysis';
import { loadManifest } from './core/ephemeris';
import { DEFAULT_MAST_M, customSite, decodeScenarios, encodeScenarios, mastOf, newId, startOfUtcDay, type Scenario } from './core/scenario';
import { loadSites, type SiteCatalog } from './core/sites';
import { COVERAGE_LAT } from './core/terrain';
import { computeHorizon } from './core/terrainClient';
import { ExplorePage } from './ui/ExplorePage';
import { fmtUtc } from './ui/Timeline';
import { ComparePage } from './ui/ComparePage';
import { SlipPage } from './ui/SlipPage';
const AboutPage = lazy(() => import('./ui/AboutPage').then((m) => ({ default: m.AboutPage })));

export type Tab = 'explore' | 'compare' | 'slip' | 'about';
const TABS: { id: Tab; label: string }[] = [
  { id: 'explore', label: 'Explore' },
  { id: 'compare', label: 'Compare' },
  { id: 'slip', label: 'Launch slip' },
  { id: 'about', label: 'Method' },
];

export type StoryScenario = Omit<Scenario, 'id'>;

function defaultScenarios(): Scenario[] {
  const t = startOfUtcDay(Date.now());
  return [{ id: newId(), siteId: 'connecting-ridge', startMs: t, durationH: 708.7, minEarthEl: 0 }];
}

/**
 * Which browser-computed terrain a scenario needs, if any:
 * custom points inside the polar tiles, or a curated site raised above the default mast height.
 */
function terrainKey(s: Scenario, catalog: SiteCatalog): string | null {
  const mast = mastOf(s);
  if (s.custom) return s.custom.lat <= COVERAGE_LAT ? `c:${s.custom.lat},${s.custom.lon}@${mast}` : null;
  if (mast === DEFAULT_MAST_M) return null;
  const b = catalog.sites.find((x) => x.id === s.siteId);
  return b && b.mask && b.lat <= COVERAGE_LAT ? `s:${b.id}@${mast}` : null;
}

export default function App() {
  const [catalog, setCatalog] = useState<SiteCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initial = useMemo(() => decodeScenarios(window.location.hash), []);
  const [scenarios, setScenarios] = useState<Scenario[]>(initial?.list ?? defaultScenarios());
  const [active, setActive] = useState(initial?.active ?? 0);
  const [tab, setTab] = useState<Tab>(initial && initial.list.length > 1 ? 'compare' : 'explore');
  // Sites resolved from browser terrain, and placeholders shown while they compute (stable identities).
  const siteCache = useRef(new Map<string, Site>());
  const requested = useRef(new Set<string>());
  const [terrainVersion, setTerrainVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadSites(), loadManifest()])
      .then(([c]) => {
        // A shared link may name a site that no longer exists; show the default site instead of an empty page.
        const known = new Set(c.sites.map((x) => x.id));
        const bad = scenarios.filter((s) => !s.custom && !known.has(s.siteId)).map((s) => s.siteId);
        if (bad.length) {
          setScenarios((list) => list.map((s) => (s.custom || known.has(s.siteId) ? s : { ...s, siteId: 'connecting-ridge' })));
          setNotice(`This link names a site the app does not know (${bad.join(', ') || 'none'}), so Connecting Ridge is shown instead.`);
        }
        setCatalog(c);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    const h = encodeScenarios(scenarios, active);
    if (h !== window.location.hash) window.history.replaceState(null, '', h);
  }, [scenarios, active]);

  // The tab title names what is on screen, so bookmarks and shared tabs make sense.
  useEffect(() => {
    const app = 'Lunar Landing Site Navigator';
    if (!catalog) return;
    const s = scenarios[active];
    const name = s.custom ? (s.custom.name ?? 'Custom point') : (catalog.sites.find((x) => x.id === s.siteId)?.short ?? 'Site');
    const when = fmtUtc(s.startMs, true);
    document.title =
      tab === 'explore'
        ? `${name}, ${when} UTC · ${app}`
        : tab === 'compare'
          ? `Compare ${scenarios.length} scenarios · ${app}`
          : tab === 'slip'
            ? `Launch slip, ${name} · ${app}`
            : `Method · ${app}`;
  }, [tab, scenarios, active, catalog]);

  // Compute terrain horizons in the worker for scenarios that need them.
  useEffect(() => {
    if (!catalog) return;
    for (const sc of scenarios) {
      const key = terrainKey(sc, catalog);
      if (!key || requested.current.has(key)) continue;
      requested.current.add(key);
      const mast = mastOf(sc);
      const done = (site: Site) => {
        siteCache.current.set(key, site);
        setTerrainVersion((v) => v + 1);
      };
      if (sc.custom) {
        const { lat, lon, name } = sc.custom;
        const base = customSite(lat, lon, name);
        computeHorizon(lat, lon, mast)
          .then((r) =>
            done({
              ...base,
              mask: r.mask,
              elevM: r.elevM,
              terrain: `LOLA ${r.nearRes} m near field, 240 m and 960 m far field, for a ${mast} m mast (computed in your browser in ${Math.round(r.ms)} ms)`,
            }),
          )
          .catch((e: Error) => done({ ...base, terrain: `none (terrain failed: ${e.message})` }));
      } else {
        const b = catalog.sites.find((x) => x.id === sc.siteId)!;
        // Keep the precise 20 m pipeline mask and add the change that the taller mast makes,
        // measured with the browser tiles at both heights.
        Promise.all([computeHorizon(b.lat, b.lon, mast), computeHorizon(b.lat, b.lon, DEFAULT_MAST_M)])
          .then(([hi, lo]) => {
            const n = b.mask!.length;
            const mask = new Float32Array(n);
            for (let i = 0; i < n; i++) {
              const j = Math.round((i * hi.mask.length) / n) % hi.mask.length;
              mask[i] = b.mask![i] + (hi.mask[j] - lo.mask[j]);
            }
            done({ ...b, mask, terrain: `${b.terrain}, raised to a ${mast} m mast with browser terrain tiles` });
          })
          .catch((e: Error) => done({ ...b, terrain: `${b.terrain} (mast height failed: ${e.message})` }));
      }
    }
  }, [scenarios, catalog]);

  const siteFor = useCallback(
    (s: Scenario): Site | null => {
      if (!catalog) return null;
      const key = terrainKey(s, catalog);
      if (key) {
        const ready = siteCache.current.get(key);
        if (ready) return ready;
        const pk = `pending:${key}`;
        let ph = siteCache.current.get(pk);
        if (!ph) {
          ph = s.custom
            ? { ...customSite(s.custom.lat, s.custom.lon, s.custom.name), terrain: 'computing terrain horizon...' }
            : { ...catalog.sites.find((x) => x.id === s.siteId)!, terrain: `computing terrain horizon for a ${mastOf(s)} m mast...` };
          siteCache.current.set(pk, ph);
        }
        return ph;
      }
      if (s.custom) {
        const ck = `plain:${s.custom.lat},${s.custom.lon}`;
        let c = siteCache.current.get(ck);
        if (!c) {
          c = customSite(s.custom.lat, s.custom.lon, s.custom.name);
          siteCache.current.set(ck, c);
        }
        return c;
      }
      return catalog.sites.find((x) => x.id === s.siteId) ?? null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, terrainVersion],
  );

  const update = (i: number, s: Scenario) => setScenarios((list) => list.map((x, k) => (k === i ? s : x)));
  const addScenario = (s: Scenario) => {
    setScenarios((list) => (list.length >= 4 ? list : [...list, { ...s, id: newId() }]));
  };
  const removeScenario = (i: number) => {
    setScenarios((list) => (list.length <= 1 ? list : list.filter((_, k) => k !== i)));
    setActive((a) => (a >= i && a > 0 ? a - 1 : a));
  };
  const openStory = (list: StoryScenario[], to: Tab) => {
    setScenarios(list.map((s) => ({ ...s, id: newId() })));
    setActive(0);
    setTab(to);
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <h1>Lunar Landing Site Navigator</h1>
          <small>Sun and Earth over real terrain</small>
        </div>
        <nav className="tabs" role="tablist" aria-label="Views">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      {notice && (
        <div className="notice-bar" role="status">
          <span>{notice}</span>
          <button className="btn ghost small" type="button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {loadError && (
        <div className="page">
          <div className="error">Could not load data: {loadError}</div>
        </div>
      )}
      {catalog && tab === 'explore' && (
        <ExplorePage
          catalog={catalog}
          scenario={scenarios[active]}
          site={siteFor(scenarios[active])}
          onChange={(s) => update(active, s)}
          onCompare={() => {
            addScenario({ ...scenarios[active], startMs: scenarios[active].startMs + 3 * 86400e3 });
            setTab('compare');
          }}
          onStory={openStory}
        />
      )}
      {catalog && tab === 'compare' && (
        <ComparePage
          catalog={catalog}
          scenarios={scenarios}
          siteFor={siteFor}
          onChange={update}
          onAdd={addScenario}
          onRemove={removeScenario}
          onOpen={(i) => {
            setActive(i);
            setTab('explore');
          }}
        />
      )}
      {catalog && tab === 'slip' && (
        <SlipPage
          catalog={catalog}
          scenario={scenarios[active]}
          site={siteFor(scenarios[active])}
          onPick={(startMs) => {
            update(active, { ...scenarios[active], startMs });
            setTab('explore');
          }}
          onChange={(s) => update(active, s)}
        />
      )}
      {tab === 'about' && (
        <Suspense fallback={<main className="page hint">Loading the method page...</main>}>
          <AboutPage />
        </Suspense>
      )}
      <footer className="footer">
        <p className="notice">Built for the NASA Space Apps Challenge 2026. Not an official NASA website.</p>
        <p>
          Team Shackleton Ridge. Data: NASA NAIF SPICE (DE440), checked against JPL Horizons; NASA LRO LOLA south pole elevation models (Barker et al. 2023)
          and polar illumination maps (Mazarico et al. 2011), via NASA GSFC PGDA. All times UTC. Type: Inter, Public Sans, DM Mono. Design foundations: NASA
          Horizon Design System (public domain).
        </p>
      </footer>
    </>
  );
}
