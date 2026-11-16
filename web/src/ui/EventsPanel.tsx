import { useMemo } from 'react';
import type { Metrics, Series, Site } from '../core/analysis';
import { downloadText, isoUtc, missionEvents, toCsv } from '../core/plan';
import { fmtDur } from './MetricsPanel';
import { fmtUtc } from './Timeline';
import { Icon } from './Icon';

const KIND_CLASS: Record<string, string> = { Sunrise: 'sun', Sunset: 'sun', Earthrise: 'earth', Earthset: 'earth' };

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function EventsPanel({ site, series, metrics, onJump }: { site: Site; series: Series; metrics: Metrics; onJump: (t: number) => void }) {
  const t0 = series.t[0];
  const t1 = series.t[series.n - 1];
  const events = useMemo(() => missionEvents(metrics, t0, t1), [metrics, t0, t1]);
  const name = `${slug(site.short ?? site.name)}-${new Date(t0).toISOString().slice(0, 10)}`;

  const exportEvents = () => {
    const rows: (string | number)[][] = [['event', 'utc', 'hours_after_start']];
    for (const e of events) rows.push([e.kind, isoUtc(e.t), ((e.t - t0) / 3600e3).toFixed(2)]);
    downloadText(`${name}-events.csv`, toCsv(rows));
  };

  const exportSeries = () => {
    const rows: (string | number)[][] = [
      [
        'utc',
        'sun_az_deg',
        'sun_el_deg',
        'sun_terrain_deg',
        'sun_visible_fraction',
        'solar_w_m2',
        'earth_az_deg',
        'earth_el_deg',
        'earth_terrain_deg',
        'earth_in_view',
        'earth_phase',
      ],
    ];
    for (let i = 0; i < series.n; i++) {
      rows.push([
        isoUtc(series.t[i]),
        series.sunAz[i].toFixed(3),
        series.sunEl[i].toFixed(4),
        series.sunHz[i].toFixed(3),
        series.sunFrac[i].toFixed(3),
        series.sunW[i].toFixed(1),
        series.earthAz[i].toFixed(3),
        series.earthEl[i].toFixed(4),
        series.earthHz[i].toFixed(3),
        series.earthUp[i],
        series.earthPhase[i].toFixed(3),
      ]);
    }
    const head = `# ${site.name}, ${site.lat.toFixed(4)} lat, ${site.lon.toFixed(4)} E lon. Terrain: ${site.terrain}. Lunar Landing Site Navigator.\n`;
    downloadText(`${name}-timeline.csv`, head + toCsv(rows));
  };

  return (
    <section className="panel panel-pad" aria-labelledby="events-h">
      <div className="panel-head">
        <h2 id="events-h">Events in the window</h2>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn small" type="button" onClick={exportEvents} disabled={!events.length}>
            <Icon name="download" />
            Events CSV
          </button>
          <button className="btn small" type="button" onClick={exportSeries}>
            <Icon name="download" />
            Full timeline CSV
          </button>
        </div>
      </div>
      {events.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          No sunrise, sunset, Earthrise or Earthset inside this window.
        </p>
      ) : (
        <div className="table-wrap events-wrap">
          <table className="cmp-table events">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Time (UTC)</th>
                <th scope="col">After landing</th>
                <th scope="col">
                  <span className="sr-only">Show in the charts</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={`${e.kind}${e.t}`}>
                  <td>
                    <span className="legend-inline">
                      <i className={`key ${KIND_CLASS[e.kind]}`} />
                      {e.kind}
                    </span>
                  </td>
                  <td className="num">{fmtUtc(e.t, true)}</td>
                  <td className="num">{fmtDur((e.t - t0) / 3600e3)}</td>
                  <td>
                    <button className="btn ghost small" type="button" onClick={() => onJump(e.t)}>
                      Show
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
