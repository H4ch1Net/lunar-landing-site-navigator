import { useEffect, useState } from 'react';
import { bodyVectors, ensureRange } from '../core/ephemeris';
import { azEl, siteFrame } from '../core/geometry';

interface HRow {
  site: string;
  lat: number;
  lon: number;
  alt_km: number;
  body: 'Sun' | 'Earth';
  utc: string;
  az: number;
  el: number;
}

interface IllumRow {
  name: string;
  lat: number;
  lon: number;
  height_m: number;
  ours: { avg_illum_pct: number; solar_visibility_pct: number; longest_shadow_h: number };
  glaser2018: { avg_illum_pct: number; solar_visibility_pct: number; longest_shadow_h: number };
}

const MON: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const parseH = (s: string) => {
  const m = /^(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})$/.exec(s)!;
  return Date.UTC(+m[1], MON[m[2]], +m[3], +m[4], +m[5]);
};

interface Check {
  site: string;
  body: string;
  n: number;
  maxEl: number;
  maxAz: number;
}

function useHorizonsCheck() {
  const [res, setRes] = useState<{ rows: Check[]; total: number; maxEl: number; maxAz: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const j = (await (await fetch('data/validation/horizons_fixtures.json')).json()) as { rows: HRow[] };
      const groups = new Map<string, Check>();
      let maxEl = 0;
      let maxAz = 0;
      for (const r of j.rows) {
        const t = parseH(r.utc);
        await ensureRange(t, t);
        const v = bodyVectors(t);
        const a = azEl(r.body === 'Sun' ? v.sun : v.earth, siteFrame(r.lat, r.lon, r.alt_km));
        const dEl = Math.abs(a.el - r.el);
        const dAz = Math.abs(((a.az - r.az + 540) % 360) - 180) * Math.cos((r.el * Math.PI) / 180);
        const k = `${r.site}|${r.body}`;
        const g = groups.get(k) ?? { site: r.site, body: r.body, n: 0, maxEl: 0, maxAz: 0 };
        g.n++;
        g.maxEl = Math.max(g.maxEl, dEl);
        g.maxAz = Math.max(g.maxAz, dAz);
        groups.set(k, g);
        maxEl = Math.max(maxEl, dEl);
        maxAz = Math.max(maxAz, dAz);
      }
      setRes({ rows: [...groups.values()], total: j.rows.length, maxEl, maxAz });
    })().catch((e: Error) => setErr(e.message));
  }, []);
  return { res, err };
}

interface PgdaRow {
  id: string;
  name: string;
  pgda_sun: number;
  pgda_earth: number;
  ours_sun: number;
  ours_earth: number;
}

interface TileRow {
  id: string;
  rms: number;
  max: number;
  bias: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function useJson<T>(url: string): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    fetch(url)
      .then((r) => r.json())
      .then((j) => setV(j as T))
      .catch(() => setV(null));
  }, [url]);
  return v;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

const deg = (v: number) => (v < 0.001 ? `${(v * 3600).toFixed(2)}″` : `${v.toFixed(4)}°`);

export function AboutPage() {
  const { res, err } = useHorizonsCheck();
  const [illum, setIllum] = useState<IllumRow[] | null>(null);
  const pgda = useJson<{ rows: PgdaRow[] }>('data/validation/pgda_comparison.json');
  const tiles = useJson<TileRow[]>('data/validation/tile_mask_check.json');
  const pgdaRows = pgda?.rows ?? [];
  const pgdaUsed = pgdaRows.filter((r) => r.pgda_sun > 0 || r.pgda_earth > 0);
  const medSun = median(pgdaUsed.map((r) => Math.abs(r.ours_sun - r.pgda_sun))) * 100;
  const medEarth = median(pgdaUsed.map((r) => Math.abs(r.ours_earth - r.pgda_earth))) * 100;
  const nameOf = (id: string) => pgdaRows.find((r) => r.id === id)?.name ?? id;
  useEffect(() => {
    fetch('data/validation/illumination_validation.json')
      .then((r) => r.json())
      .then((j) => setIllum(j.rows))
      .catch(() => setIllum([]));
  }, []);

  return (
    <main className="page">
      <article className="prose">
        <h2 style={{ marginTop: 4 }}>What this tool answers</h2>
        <p>
          A lander at the lunar south pole lives or dies by two questions. Can its solar panels see the Sun? Can its antenna see Earth? Near the pole the Sun
          circles the horizon, never more than about 1.5° above the level, so a ridge a few kilometres away can cast a shadow for days. Earth hangs low in one
          part of the sky and bobs up and down by several degrees each month. Moving a landing by a few days or a few kilometres can change both answers.
        </p>
        <p>
          This tool shows the Sun and Earth against the real terrain horizon for any site and date, measures power and contact over a mission window, and puts
          scenarios side by side so a slipped launch or a new site can be judged in seconds.
        </p>

        <h2>How it works</h2>
        <h3>Where the Sun and Earth are</h3>
        <p>
          Positions come from NASA&apos;s NAIF SPICE toolkit with the JPL DE440 planetary ephemeris and the DE440 lunar orientation kernel. We compute the
          apparent direction (light time and stellar aberration) of the Sun and Earth from the Moon&apos;s centre in the MOON_ME frame, every 2 hours, for
          1969 to 1972, selected years with landings, and 2024 to 2035. The browser interpolates these vectors with a cubic polynomial (error under 0.00001°)
          and turns them into azimuth and elevation for any latitude and longitude. Parallax from the observer&apos;s position on the surface is included, which
          matters for Earth: it shifts Earth by up to about 0.25°.
        </p>
        <h3>Where the horizon is</h3>
        <p>
          For south polar sites the horizon comes from NASA LRO LOLA elevation models (Barker et al. 2023). From each site we march outward along 720
          directions, sampling a 20 m model near the site, an 80 m model to 60 km and a 240 m model out to 250 km, and keep the highest elevation angle,
          including the drop of the curved surface. The observer is 2 m above the ground, about the height of lander solar panels. Sites outside the polar
          terrain models use a smooth horizon and are marked as such.
        </p>
        <h3>What the numbers mean</h3>
        <ul>
          <li>
            <b>Sunlight</b>: share of the window when any part of the solar disk is above the terrain. Power on a panel that tracks the Sun scales with the
            visible part of the disk and the Sun&apos;s distance (1361 W/m² at 1 AU).
          </li>
          <li>
            <b>Earth in view</b>: share of the window when the centre of Earth is above the terrain plus the minimum elevation you set. This is direct line of
            sight for a direct-to-Earth antenna. It does not model ground station schedules.
          </li>
          <li>
            <b>Longest darkness</b> and <b>longest comm gap</b>: the longest continuous stretch inside the window without Sun or without Earth.
          </li>
          <li>
            <b>Battery needed</b>: the smallest usable battery that carries a constant load through the window, starting full, charged by a Sun-tracking panel
            of the area and efficiency you enter. It ignores panel temperature, dust, battery losses and depth-of-discharge limits; the mass figure assumes
            150 Wh/kg.
          </li>
          <li>
            <b>Mast height</b>: the default observer is 2 m above the ground. For taller masts the app keeps the 20 m terrain horizon and adds the change that
            the extra height makes, measured on the browser terrain tiles at both heights.
          </li>
          <li>
            <b>Better spot nearby</b>: every point on the grid, the site included, uses the browser terrain tiles, so the points compare fairly with each
            other. Its numbers can differ slightly from the main view.
          </li>
        </ul>

        <h2>Validation</h2>
        <h3>1. Sun and Earth positions against JPL Horizons (runs live in your browser)</h3>
        <p>
          We asked JPL Horizons for the apparent azimuth and elevation of the Sun and Earth at six lunar surface sites (south pole, connecting ridge, Malapert,
          Apollo 11, Mare Crisium and the far side) over two months in 2026 and 2028, plus the moment Apollo 11 landed. This page runs the same code the app
          uses against every one of those answers.
        </p>
        {err && <div className="error">{err}</div>}
        {!res && !err && <p className="hint">Running {''}the check...</p>}
        {res && (
          <>
            <p>
              <b>
                {res.total} comparisons. Largest elevation difference {deg(res.maxEl)}, largest azimuth difference {deg(res.maxAz)}.
              </b>{' '}
              For scale, the Sun is 0.53° across.
            </p>
            <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Body</th>
                  <th>Rows</th>
                  <th>Max elevation error</th>
                  <th>Max azimuth error (on sky)</th>
                </tr>
              </thead>
              <tbody>
                {res.rows.map((r) => (
                  <tr key={r.site + r.body}>
                    <td>{r.site}</td>
                    <td>{r.body}</td>
                    <td className="num">{r.n}</td>
                    <td className="num">{deg(r.maxEl)}</td>
                    <td className="num">{deg(r.maxAz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}

        <h3>2. Terrain-aware sunlight against published results</h3>
        <p>
          Gläser et al. (2018) computed sunlight at the best-lit south pole points hourly from 2017 to 2037 with a 20 m LOLA terrain model. We ran our horizon
          code at the same points and period. Average illumination is the mean visible fraction of the solar disk; solar visibility counts any part of the disk.
        </p>
        {illum && illum.length > 0 && (
          <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Point</th>
                <th>Avg illumination, ours / published</th>
                <th>Solar visibility, ours / published</th>
                <th>Longest shadow, ours / published</th>
              </tr>
            </thead>
            <tbody>
              {illum.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className="num">
                    {r.ours.avg_illum_pct.toFixed(1)}% / {r.glaser2018.avg_illum_pct.toFixed(1)}%
                  </td>
                  <td className="num">
                    {r.ours.solar_visibility_pct.toFixed(1)}% / {r.glaser2018.solar_visibility_pct.toFixed(1)}%
                  </td>
                  <td className="num">
                    {r.ours.longest_shadow_h} h / {r.glaser2018.longest_shadow_h} h
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <p>
          Four of the five points agree within about 1 percentage point. The fifth differs by 2 to 3 points, which is expected for a point on a steep rim where a
          few metres of terrain error change the horizon.
        </p>

        <h3>3. Long-term Sun and Earth visibility against NASA&apos;s polar maps</h3>
        <p>
          NASA&apos;s Planetary Geodesy Data Archive publishes maps of how often the Sun and Earth are visible from each 120 m pixel of the south pole over a
          full 18.6-year lunar cycle (Mazarico et al. 2011). These are the overlays on the south pole map. We ran our own horizons, 0.5 m above the ground, hourly over the same length
          of time at each curated site and compared.
        </p>
        {pgdaUsed.length > 0 && (
          <>
            <p>
              <b>
                Across {pgdaUsed.length} sites, the median difference is {medSun.toFixed(1)} percentage points for the Sun and {medEarth.toFixed(1)} for Earth.
              </b>{' '}
              Broad terrain agrees closely. Sharp peaks and rims differ more, because our 20 m near field resolves slopes that a 120 m pixel averages away.
              At the exact pole the map reads 0 for both bodies, which we read as a missing value at the projection centre, so that site is left out.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>Sun visible, ours / NASA map</th>
                    <th>Earth visible, ours / NASA map</th>
                  </tr>
                </thead>
                <tbody>
                  {pgdaUsed.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td className="num">
                        {pct(r.ours_sun)} / {pct(r.pgda_sun)}
                      </td>
                      <td className="num">
                        {pct(r.ours_earth)} / {pct(r.pgda_earth)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <h3>4. Terrain computed in your browser against the pipeline</h3>
        <p>
          When you pick your own point south of 80.5° S, your browser computes its horizon from compact terrain tiles (80 m near the point, then 240 m and
          960 m). The curated sites use the full pipeline with a 20 m near field. At the same {tiles?.length ?? 15} sites, the two horizons differ by a
          median of <b>{tiles ? median(tiles.map((t) => t.rms)).toFixed(2) : '...'}°</b> (root mean square over 720 directions). Steep rims and the pole
          differ most, up to about 1°.
        </p>
        {tiles && tiles.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Site</th>
                  <th>RMS difference</th>
                  <th>Largest difference</th>
                  <th>Mean offset</th>
                </tr>
              </thead>
              <tbody>
                {tiles.map((t) => (
                  <tr key={t.id}>
                    <td>{nameOf(t.id)}</td>
                    <td className="num">{t.rms.toFixed(2)}°</td>
                    <td className="num">{t.max.toFixed(2)}°</td>
                    <td className="num">{t.bias >= 0 ? '+' : ''}{t.bias.toFixed(2)}°</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2>Limits</h2>
        <ul>
          <li>Terrain is modeled only from 60° S to the pole. Other sites use a smooth horizon, which ignores nearby hills and crater walls.</li>
          <li>
            Polar terrain models have errors of a few metres to tens of metres. Near the pole that can move sunrise and sunset by hours at grazing Sun angles.
          </li>
          <li>The lander itself, its shadow, and nearby boulders smaller than the terrain grid are not modeled.</li>
          <li>Custom points use a smooth horizon unless terrain is computed for them.</li>
          <li>
            NASA has not published coordinates for its candidate regions. Region points here are the centres of LROC image mosaics of each region and are
            approximate. Artemis III is now planned as an Earth-orbit test flight (May 2026); the first crewed landing is planned for a later mission.
          </li>
          <li>Ephemeris data covers 1969 to 1972, 2013, 2019, 2020 and 2023 to 2035. Times are UTC.</li>
          <li>This is a planning aid built in a weekend, not a flight tool.</li>
        </ul>

        <h2>Data and credits</h2>
        <ul>
          <li>
            NASA NAIF SPICE toolkit and generic kernels: DE440 ephemeris (de440s.bsp), lunar orientation (moon_pa_de440_200625.bpc, moon_de440_250416.tf),
            leap seconds, PCK. Accessed through SpiceyPy.
          </li>
          <li>JPL Horizons System, used to validate positions.</li>
          <li>
            NASA LRO LOLA south pole elevation models, Barker et al. 2023, Planetary Science Journal 4, 183, doi:10.3847/PSJ/acf3e1, data
            doi:10.60903/gsfcpgda-lola-spole, via NASA GSFC PGDA.
          </li>
          <li>Site coordinates: NSSDCA lunar artifact table, LROC (Arizona State University) images and mosaics, IAU Gazetteer of Planetary Nomenclature, Gläser et al. 2018, Bussey et al. 2010, De Rosa et al. 2012.</li>
          <li>
            NASA LRO LOLA lunar polar illumination maps (average Sun and Earth visibility), Mazarico et al. 2011, Icarus 211, 1066, via NASA GSFC PGDA product
            69.
          </li>
          <li>Software: React, Vite, TypeScript, Leaflet, NumPy, Numba, Rasterio, SciPy, Pillow.</li>
          <li>
            Design: built on the <a href="https://github.com/nasa/hds-core">NASA Horizon Design System</a> (HDS Core, public domain), including its icons. No
            NASA insignia or logotype is used. Fonts: Inter and DM Mono (SIL Open Font License), Public Sans (SIL Open Font License, with public domain
            changes by GSA). License texts are in <a href="licenses/Inter-OFL.txt">licenses/</a>.
          </li>
        </ul>

        <h2>Use of AI</h2>
        <p>
          The code and text of this project were written with help from Claude, an AI model by Anthropic, working under the direction of the team. All
          numbers shown in the app come from NASA data and the validation above, not from an AI model.
        </p>
      </article>
    </main>
  );
}
