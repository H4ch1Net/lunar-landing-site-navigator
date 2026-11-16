import { useEffect, useState } from 'react';
import type { Site } from '../core/analysis';
import { DEFAULT_MAST_M, DURATIONS, MAST_OPTIONS, mastOf, startOfUtcDay, type Scenario } from '../core/scenario';
import { COVERAGE_LAT } from '../core/terrain';
import { fmtLat, fmtLon, type SiteCatalog } from '../core/sites';
import { Icon } from './Icon';
import { CopyLink, CopyText } from './CopyLink';

interface Props {
  scenario: Scenario;
  site: Site | null;
  catalog: SiteCatalog;
  onChange: (s: Scenario) => void;
  onOpenMap?: () => void;
}

const DAY = 86400e3;
const pad = (n: number) => String(n).padStart(2, '0');

function dateParts(t: number) {
  const d = new Date(t);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

/** 24-hour HH:MM text field (the native time input shows AM/PM in some locales). */
function TimeInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const m = /^(\d{1,2}):?(\d{2})$/.exec(v.trim());
    if (m && +m[1] < 24 && +m[2] < 60) onCommit(`${m[1].padStart(2, '0')}:${m[2]}`);
    else setV(value);
  };
  return (
    <input
      className="input mono"
      aria-label="Landing time, UTC, 24-hour HH:MM"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      style={{ maxWidth: 90 }}
    />
  );
}

export function ScenarioEditor({ scenario, site, catalog, onChange, onOpenMap }: Props) {
  const { date, time } = dateParts(scenario.startMs);
  const [lat, setLat] = useState(String(scenario.custom?.lat ?? ''));
  const [lon, setLon] = useState(String(scenario.custom?.lon ?? ''));
  const [days, setDays] = useState(String(+(scenario.durationH / 24).toFixed(2)));
  useEffect(() => setDays(String(+(scenario.durationH / 24).toFixed(2))), [scenario.durationH]);
  useEffect(() => {
    if (scenario.custom) {
      setLat(String(scenario.custom.lat));
      setLon(String(scenario.custom.lon));
    }
  }, [scenario.custom]);

  const setStart = (dateStr: string, timeStr: string) => {
    const t = Date.parse(`${dateStr}T${timeStr || '00:00'}:00Z`);
    if (Number.isFinite(t)) onChange({ ...scenario, startMs: t });
  };
  const applyCustom = () => {
    const a = parseFloat(lat);
    const b = parseFloat(lon);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90) {
      onChange({ ...scenario, siteId: 'custom', custom: { lat: a, lon: b } });
    }
  };
  const isCustom = scenario.siteId === 'custom';

  return (
    <div className="panel panel-pad">
      <div className="panel-head">
        <h2>Scenario</h2>
        <CopyLink />
      </div>
      <div className="field">
        <label htmlFor="site">Landing site</label>
        <select
          id="site"
          className="input"
          value={isCustom ? 'custom' : scenario.siteId}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'custom') {
              const a = site?.lat ?? -89.5;
              const b = site?.lon ?? 222;
              onChange({ ...scenario, siteId: 'custom', custom: { lat: +a.toFixed(4), lon: +b.toFixed(4) } });
            } else onChange({ ...scenario, siteId: v, custom: undefined });
          }}
        >
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
          <optgroup label="Custom">
            <option value="custom">Enter coordinates...</option>
          </optgroup>
        </select>
        {onOpenMap && (
          <button className="btn small" type="button" onClick={onOpenMap} style={{ alignSelf: 'flex-start' }}>
            <Icon name="map" />
            Pick on the south pole map
          </button>
        )}
      </div>

      {isCustom && (
        <div className="field">
          <span className="field-label">Coordinates (planetocentric, east longitude)</span>
          <div className="row">
            <input
              className="input mono"
              aria-label="Latitude in degrees, negative for south"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              onBlur={applyCustom}
              onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
              placeholder="lat -89.45"
            />
            <input
              className="input mono"
              aria-label="East longitude in degrees"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              onBlur={applyCustom}
              onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
              placeholder="lon 222.8"
            />
          </div>
        </div>
      )}

      <div className="field">
        <span className="field-label">Landing date and time (UTC)</span>
        <div className="row">
          <input className="input mono" type="date" aria-label="Landing date, UTC" value={date} onChange={(e) => setStart(e.target.value, time)} />
          <TimeInput value={time} onCommit={(v) => setStart(date, v)} />
        </div>
        <div className="chips" role="group" aria-label="Shift the landing date">
          {[-7, -1, 1, 3, 7].map((d) => (
            <button key={d} type="button" className="chip" onClick={() => onChange({ ...scenario, startMs: scenario.startMs + d * DAY })}>
              {d > 0 ? `+${d}` : d} d
            </button>
          ))}
          <button type="button" className="chip" onClick={() => onChange({ ...scenario, startMs: startOfUtcDay(Date.now()) })}>
            Today
          </button>
          {site?.landedUtc && (
            <button type="button" className="chip" onClick={() => onChange({ ...scenario, startMs: Date.parse(site.landedUtc!) })}>
              Actual landing
            </button>
          )}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Mission length</span>
        <div className="chips" role="group" aria-label="Mission length presets">
          {DURATIONS.map((d) => (
            <button
              key={d.h}
              type="button"
              className="chip"
              title={d.title}
              aria-pressed={Math.abs(scenario.durationH - d.h) < 0.01}
              onClick={() => onChange({ ...scenario, durationH: d.h })}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="row">
          <input
            className="input mono"
            aria-label="Mission length in days"
            inputMode="decimal"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            onBlur={() => {
              const v = parseFloat(days);
              if (Number.isFinite(v) && v > 0) onChange({ ...scenario, durationH: Math.min(366, Math.max(0.1, v)) * 24 });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            style={{ maxWidth: 110 }}
          />
          <span className="hint" style={{ margin: 0 }}>
            days
          </span>
        </div>
      </div>

      <div className="field">
        <span className="field-label" id="mast-label">
          Panel and antenna height
        </span>
        <div className="chips" role="group" aria-labelledby="mast-label">
          {MAST_OPTIONS.map((h) => (
            <button
              key={h}
              type="button"
              className="chip"
              aria-pressed={mastOf(scenario) === h}
              disabled={!!site && site.lat > COVERAGE_LAT && h !== DEFAULT_MAST_M}
              onClick={() => onChange({ ...scenario, mastM: h === DEFAULT_MAST_M ? undefined : h })}
            >
              {h} m{h === DEFAULT_MAST_M ? ' (deck)' : h >= 10 ? ' (tower)' : ''}
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          {site && site.lat > COVERAGE_LAT
            ? 'Taller masts need terrain tiles, which cover only south of 80.5° S.'
            : 'A taller mast sees over nearby ridges. Heights above 2 m are computed in your browser from terrain tiles.'}
        </p>
      </div>

      <div className="field">
        <label htmlFor="minel">Minimum Earth elevation for contact</label>
        <div className="row">
          <input
            id="minel"
            className="input mono"
            type="number"
            step="0.5"
            min="-5"
            max="20"
            value={scenario.minEarthEl}
            onChange={(e) => onChange({ ...scenario, minEarthEl: parseFloat(e.target.value) || 0 })}
            style={{ maxWidth: 110 }}
          />
          <span className="hint" style={{ margin: 0 }}>
            degrees above terrain
          </span>
        </div>
      </div>

      {site && (
        <div className="site-meta">
          <p className="site-name">{site.name}</p>
          <p className="mono coords">
            <span>
              {fmtLat(site.lat)}, {fmtLon(site.lon)}
              {site.mask ? ` · ${Math.round(site.elevM)} m` : ''}
            </span>
            <CopyText text={`${site.lat.toFixed(5)}, ${(((site.lon % 360) + 360) % 360).toFixed(5)}`} label="Copy" what="coordinates" />
          </p>
          <p>
            <span className={`status ${site.mask ? 'good' : site.terrain.startsWith('computing') ? 'quiet' : 'caution'}`}>
              {site.mask
                ? 'Terrain horizon'
                : site.terrain.startsWith('computing')
                  ? 'Computing terrain horizon'
                  : site.custom && site.lat > -80.5
                    ? 'Outside polar terrain'
                    : 'Smooth horizon'}
            </span>
          </p>
          <p className="hint" style={{ marginTop: 0 }}>
            {site.mask
              ? `From ${site.terrain}.`
              : site.terrain.startsWith('computing')
                ? 'Computing from LOLA terrain tiles in your browser.'
                : 'Terrain is not modeled here, so nearby hills and crater walls are ignored.'}
          </p>
          {site.note && <p>{site.note}</p>}
          {site.landedUtc && <p>Landed {site.landedUtc.replace('T', ' ').replace(':00Z', ' UTC').replace('Z', ' UTC')}</p>}
          {site.source && <p className="hint">Source: {site.source}</p>}
        </div>
      )}
    </div>
  );
}
