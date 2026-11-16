import { useEffect, useMemo, useState } from 'react';
import type { Metrics, Site } from '../core/analysis';
import { DEFAULT_MAST_M, DURATIONS, SCENARIO_COLORS, mastOf, type Scenario } from '../core/scenario';
import type { SiteCatalog } from '../core/sites';
import { StatusTag, fmtDur, fmtGap, powerRating, commsRating } from './MetricsPanel';
import { Icon } from './Icon';
import { CopyLink } from './CopyLink';
import { SkyView } from './SkyView';
import { Timeline, fmtUtc } from './Timeline';
import { useAnalysis } from './useAnalysis';

interface Props {
  catalog: SiteCatalog;
  scenarios: Scenario[];
  siteFor: (s: Scenario) => Site | null;
  onChange: (i: number, s: Scenario) => void;
  onAdd: (s: Scenario) => void;
  onRemove: (i: number) => void;
  onOpen: (i: number) => void;
}

const DAY = 86400e3;
const pad = (n: number) => String(n).padStart(2, '0');
const dateStr = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

function Card({
  idx,
  scenario,
  site,
  catalog,
  onChange,
  onRemove,
  onOpen,
  onDuplicate,
  onMetrics,
  canRemove,
}: {
  idx: number;
  scenario: Scenario;
  site: Site | null;
  catalog: SiteCatalog;
  onChange: (s: Scenario) => void;
  onRemove: () => void;
  onOpen: () => void;
  onDuplicate?: () => void;
  onMetrics: (m: Metrics | null) => void;
  canRemove: boolean;
}) {
  const { series, metrics, error } = useAnalysis(site, scenario.startMs, scenario.durationH, scenario.minEarthEl, mastOf(scenario));
  useEffect(() => onMetrics(metrics), [metrics]); // eslint-disable-line react-hooks/exhaustive-deps
  const color = SCENARIO_COLORS[idx % SCENARIO_COLORS.length];
  const time = new Date(scenario.startMs).toISOString().slice(11, 16);
  return (
    <article className="panel panel-pad scenario-card" aria-label={`Scenario ${String.fromCharCode(65 + idx)}`}>
      <header>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className="swatch" style={{ background: color }} />
          <div>
            <div className="title">
              {String.fromCharCode(65 + idx)}. {site?.short ?? site?.name ?? 'Unknown site'}
            </div>
            <div className="hint mono" style={{ margin: 0 }}>
              {fmtUtc(scenario.startMs, true)} UTC · {fmtDur(scenario.durationH)}
              {mastOf(scenario) !== DEFAULT_MAST_M ? ` · ${mastOf(scenario)} m mast` : ''}
            </div>
          </div>
        </div>
        <div className="row">
          <button className="btn small ghost" type="button" onClick={onOpen}>
            Open
          </button>
          {onDuplicate && (
            <button className="btn small ghost" type="button" onClick={onDuplicate} aria-label={`Duplicate scenario ${String.fromCharCode(65 + idx)}`}>
              Duplicate
            </button>
          )}
          {canRemove && (
            <button className="btn small ghost" type="button" onClick={onRemove} aria-label={`Remove scenario ${String.fromCharCode(65 + idx)}`}>
              <Icon name="close" />
            </button>
          )}
        </div>
      </header>
      <div className="card-controls">
        <select
          className="input span-2"
          aria-label="Site"
          value={scenario.custom ? 'custom' : scenario.siteId}
          onChange={(e) => onChange({ ...scenario, siteId: e.target.value, custom: undefined })}
        >
          {scenario.custom && <option value="custom">{site?.name ?? 'Custom point'}</option>}
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
        <input
          className="input mono"
          type="date"
          aria-label="Landing date, UTC"
          value={dateStr(scenario.startMs)}
          onChange={(e) => {
            const t = Date.parse(`${e.target.value}T${time}:00Z`);
            if (Number.isFinite(t)) onChange({ ...scenario, startMs: t });
          }}
        />
        <select
          className="input"
          aria-label="Mission length"
          value={DURATIONS.find((d) => Math.abs(d.h - scenario.durationH) < 0.01)?.h ?? 'other'}
          onChange={(e) => onChange({ ...scenario, durationH: parseFloat(e.target.value) })}
        >
          {DURATIONS.map((d) => (
            <option key={d.h} value={d.h}>
              {d.label}
            </option>
          ))}
          {!DURATIONS.some((d) => Math.abs(d.h - scenario.durationH) < 0.01) && <option value="other">{fmtDur(scenario.durationH)}</option>}
        </select>
      </div>
      <div className="chips">
        {[-3, -1, 1, 3, 7].map((d) => (
          <button key={d} className="chip" type="button" onClick={() => onChange({ ...scenario, startMs: scenario.startMs + d * DAY })}>
            {d > 0 ? `+${d}` : d} d
          </button>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      {site && series && (
        <>
          <SkyView site={site} series={series} snap={null} height={130} compact />
          <Timeline series={series} cursorMs={scenario.startMs} height={96} compact />
        </>
      )}
      {metrics && (
        <div className="row" style={{ gap: 16 }}>
          <StatusTag rating={powerRating(metrics)} prefix="Power" />
          <StatusTag rating={commsRating(metrics)} prefix="Comms" />
        </div>
      )}
    </article>
  );
}

interface Row {
  label: string;
  get: (m: Metrics) => number;
  fmt: (v: number) => string;
  better: 'high' | 'low';
}

const ROWS: Row[] = [
  { label: 'Sunlight (any part of Sun visible)', get: (m) => m.sunlitPct, fmt: (v) => `${v.toFixed(1)}%`, better: 'high' },
  { label: 'Longest darkness', get: (m) => m.longestDarkH, fmt: fmtGap, better: 'low' },
  { label: 'Earth in view', get: (m) => m.earthPct, fmt: (v) => `${v.toFixed(1)}%`, better: 'high' },
  { label: 'Longest comm gap', get: (m) => m.longestCommGapH, fmt: fmtGap, better: 'low' },
  { label: 'Sun and Earth together', get: (m) => m.bothPct, fmt: (v) => `${v.toFixed(1)}%`, better: 'high' },
  { label: 'Solar energy per m² (tracking panel)', get: (m) => m.energyKWhM2, fmt: (v) => `${v.toFixed(0)} kWh`, better: 'high' },
  { label: 'Average power per m²', get: (m) => m.meanPowerWM2, fmt: (v) => `${v.toFixed(0)} W`, better: 'high' },
];

function changeLine(a: Metrics, b: Metrics, la: string, lb: string): string {
  const parts: string[] = [];
  const dSun = b.sunlitPct - a.sunlitPct;
  const dEarth = b.earthPct - a.earthPct;
  const dDark = b.longestDarkH - a.longestDarkH;
  const dGap = b.longestCommGapH - a.longestCommGapH;
  if (Math.abs(dSun) >= 0.5) parts.push(`${dSun > 0 ? 'gains' : 'loses'} ${Math.abs(dSun).toFixed(0)} points of sunlight`);
  if (Math.abs(dDark) >= 0.5) parts.push(`${dDark > 0 ? 'adds' : 'cuts'} ${fmtDur(Math.abs(dDark))} ${dDark > 0 ? 'to' : 'from'} the longest darkness`);
  if (Math.abs(dEarth) >= 0.5) parts.push(`${dEarth > 0 ? 'gains' : 'loses'} ${Math.abs(dEarth).toFixed(0)} points of Earth view`);
  if (Math.abs(dGap) >= 0.5) parts.push(`${dGap > 0 ? 'stretches' : 'shortens'} the longest comm gap by ${fmtDur(Math.abs(dGap))}`);
  if (!parts.length) return `${lb} performs about the same as ${la}.`;
  return `Compared with ${la}, ${lb} ${parts.join(', ')}.`;
}

export function ComparePage({ catalog, scenarios, siteFor, onChange, onAdd, onRemove, onOpen }: Props) {
  const [ms, setMs] = useState<Record<string, Metrics | null>>({});
  const list = scenarios.map((s) => ms[s.id] ?? null);
  const names = scenarios.map((s, i) => `${String.fromCharCode(65 + i)} (${siteFor(s)?.short ?? 'site'}, ${fmtUtc(s.startMs).split(' ').slice(0, 2).join(' ')})`);
  const best = useMemo(
    () =>
      ROWS.map((r) => {
        const vals = list.map((m) => (m ? r.get(m) : NaN));
        const ok = vals.filter((v) => Number.isFinite(v));
        if (ok.length < 2) return -1;
        const target = r.better === 'high' ? Math.max(...ok) : Math.min(...ok);
        if (ok.every((v) => Math.abs(v - target) < 1e-6)) return -1;
        return vals.findIndex((v) => Math.abs(v - target) < 1e-6);
      }),
    [list],
  );
  const last = scenarios[scenarios.length - 1];

  return (
    <main className="page stack">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <p className="hint" style={{ margin: 0, maxWidth: 640, fontSize: 14 }}>
          Up to four landing scenarios side by side. Change a site or shift a date and every number updates at once. The best value in each row is marked Best.
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <CopyLink label="Copy link to this comparison" />
          <button className="btn" type="button" disabled={scenarios.length >= 4} onClick={() => onAdd({ ...last, startMs: last.startMs + 3 * DAY })}>
            <Icon name="plus" />
            Same site, 3 days later
          </button>
          <button
            className="btn"
            type="button"
            disabled={scenarios.length >= 4}
            onClick={() => {
              const used = new Set(scenarios.map((s) => s.siteId));
              const next = catalog.sites.find((s) => !used.has(s.id) && s.mask) ?? catalog.sites[0];
              onAdd({ ...last, siteId: next.id, custom: undefined });
            }}
          >
            <Icon name="plus" />
            Same date, another site
          </button>
        </div>
      </div>
      <div className="compare-grid">
        {scenarios.map((s, i) => (
          <Card
            key={s.id}
            idx={i}
            scenario={s}
            site={siteFor(s)}
            catalog={catalog}
            onChange={(x) => onChange(i, x)}
            onRemove={() => onRemove(i)}
            onOpen={() => onOpen(i)}
            onDuplicate={scenarios.length < 4 ? () => onAdd({ ...s }) : undefined}
            onMetrics={(m) => setMs((prev) => (prev[s.id] === m ? prev : { ...prev, [s.id]: m }))}
            canRemove={scenarios.length > 1}
          />
        ))}
      </div>
      {scenarios.length > 1 && list[0] && (
        <div className="panel panel-pad">
          <h2>What changes</h2>
          {list.slice(1).map((m, k) =>
            m ? (
              <p key={k} style={{ margin: '0 0 6px' }}>
                {changeLine(list[0]!, m, names[0], names[k + 1])}
              </p>
            ) : null,
          )}
        </div>
      )}
      <div className="panel panel-pad" style={{ overflowX: 'auto' }}>
        <h2>Side by side</h2>
        <table className="cmp-table">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              {scenarios.map((s, i) => (
                <th key={s.id} scope="col">
                  <span className="swatch" style={{ width: 10, height: 10, margin: '0 6px 0 0', background: SCENARIO_COLORS[i] }} />
                  {names[i]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r, ri) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {list.map((m, i) => (
                  <td key={i} className={`num ${best[ri] === i ? 'best' : ''}`}>
                    {m ? r.fmt(r.get(m)) : '...'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
