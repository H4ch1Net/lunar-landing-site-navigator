import type { Metrics } from '../core/analysis';

export function fmtDur(h: number | null): string {
  if (h === null) return 'n/a';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

export type Rating = 'Good' | 'Marginal' | 'Poor';

/** Power: share of the window with any part of the Sun above the terrain. */
/** A gap or outage length; "None" when it never happens. */
export function fmtGap(h: number): string {
  return h < 1 / 60 ? 'None' : fmtDur(h);
}

export function powerRating(m: Metrics): Rating {
  if (m.sunlitPct >= 70) return 'Good';
  if (m.sunlitPct >= 40) return 'Marginal';
  return 'Poor';
}

/** Comms: share of the window with Earth above the terrain. */
export function commsRating(m: Metrics): Rating {
  if (m.earthPct >= 60) return 'Good';
  if (m.earthPct >= 25) return 'Marginal';
  return 'Poor';
}

export const RATING_CLASS: Record<Rating, string> = { Good: 'good', Marginal: 'caution', Poor: 'critical' };

export function StatusTag({ rating, prefix }: { rating: Rating; prefix?: string }) {
  return <span className={`status ${RATING_CLASS[rating]}`}>{prefix ? `${prefix} ${rating.toLowerCase()}` : rating}</span>;
}

export function Verdict({ m }: { m: Metrics }) {
  return (
    <section className="verdict" aria-label="Verdict">
      <div className="verdict-head">
        <h2 className="overline">Verdict</h2>
        <StatusTag rating={powerRating(m)} prefix="Power" />
        <StatusTag rating={commsRating(m)} prefix="Comms" />
      </div>
      <p>{verdict(m)}</p>
    </section>
  );
}

export function verdict(m: Metrics): string {
  const sun =
    m.sunlitPct >= 99.9
      ? 'The Sun stays up for the whole window'
      : m.sunlitPct <= 0.1
        ? 'The Sun never clears the terrain in this window'
        : `The Sun is visible ${m.sunlitPct.toFixed(0)}% of the time, with up to ${fmtDur(m.longestDarkH)} of darkness`;
  const earth =
    m.earthPct >= 99.9
      ? 'Earth stays in view, so direct contact is possible throughout'
      : m.earthPct <= 0.1
        ? 'Earth never rises above the terrain, so contact needs a relay satellite'
        : `Earth is in view ${m.earthPct.toFixed(0)}% of the time, with gaps of up to ${fmtDur(m.longestCommGapH)}`;
  return `${sun}. ${earth}.`;
}

export function MetricsPanel({ m }: { m: Metrics }) {
  const sunsetText = m.startsLit
    ? m.firstSunsetH === null
      ? 'No sunset in window'
      : `Sunset after ${fmtDur(m.firstSunsetH)}`
    : m.firstSunriseH === null
      ? 'Dark for the whole window'
      : `Dark at start, sunrise after ${fmtDur(m.firstSunriseH)}`;
  const earthText = m.startsComm
    ? m.firstEarthsetH === null
      ? 'No Earthset in window'
      : `Earthset after ${fmtDur(m.firstEarthsetH)}`
    : m.firstEarthriseH === null
      ? 'Earth below the terrain all window'
      : `Earth hidden at start, rises after ${fmtDur(m.firstEarthriseH)}`;
  return (
    <div className="metrics">
      <div className="metric">
        <div className="label">
          <span className="key sun" />
          Sunlight
        </div>
        <div className="value">
          {m.sunlitPct.toFixed(0)}
          <small>%</small>
        </div>
        <div className="sub">{sunsetText}</div>
        <StatusTag rating={powerRating(m)} prefix="Power" />
      </div>
      <div className="metric">
        <div className="label">
          <span className="key sun" />
          Longest darkness
        </div>
        <div className="value">{fmtGap(m.longestDarkH)}</div>
        <div className="sub">Battery must cover this</div>
      </div>
      <div className="metric">
        <div className="label">
          <span className="key earth" />
          Earth in view
        </div>
        <div className="value">
          {m.earthPct.toFixed(0)}
          <small>%</small>
        </div>
        <div className="sub">{earthText}</div>
        <StatusTag rating={commsRating(m)} prefix="Comms" />
      </div>
      <div className="metric">
        <div className="label">
          <span className="key earth" />
          Longest comm gap
        </div>
        <div className="value">{fmtGap(m.longestCommGapH)}</div>
        <div className="sub">Without a relay satellite</div>
      </div>
      <div className="metric">
        <div className="label">
          <span className="key both" />
          Sun and Earth together
        </div>
        <div className="value">
          {m.bothPct.toFixed(0)}
          <small>%</small>
        </div>
        <div className="sub">Sun up and Earth in view</div>
      </div>
      <div className="metric">
        <div className="label">
          <span className="key sun" />
          Solar energy
        </div>
        <div className="value">
          {m.energyKWhM2.toFixed(0)}
          <small>kWh/m²</small>
        </div>
        <div className="sub">Sun-tracking panel, avg {m.meanPowerWM2.toFixed(0)} W/m²</div>
      </div>
    </div>
  );
}
