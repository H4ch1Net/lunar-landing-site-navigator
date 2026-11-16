import type { Site } from './analysis';

interface RawSite {
  id: string;
  name: string;
  short?: string;
  group: string;
  lat: number;
  lon: number;
  elev_m: number;
  terrain: string;
  note?: string;
  landed_utc?: string;
  source?: string;
  mask_cdeg?: number[] | null;
}

export interface SiteCatalog {
  sites: Site[];
  groups: string[];
  nAz: number;
  mastM: number;
}

let catalog: Promise<SiteCatalog> | null = null;

export function loadSites(): Promise<SiteCatalog> {
  if (!catalog) {
    catalog = fetch('data/sites.json')
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load site list (${r.status})`);
        return r.json();
      })
      .then((j: { n_az: number; mast_m: number; sites: RawSite[] }) => {
        const sites: Site[] = j.sites.map((s) => ({
          id: s.id,
          name: s.name,
          short: s.short,
          group: s.group,
          lat: s.lat,
          lon: s.lon,
          elevM: s.elev_m,
          terrain: s.terrain,
          note: s.note,
          landedUtc: s.landed_utc,
          source: s.source,
          mask: s.mask_cdeg ? Float32Array.from(s.mask_cdeg, (v) => v / 100) : null,
        }));
        const groups: string[] = [];
        for (const s of sites) if (!groups.includes(s.group)) groups.push(s.group);
        return { sites, groups, nAz: j.n_az, mastM: j.mast_m };
      });
  }
  return catalog;
}

export function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(Math.abs(lat) > 89 ? 3 : 2)}° ${lat < 0 ? 'S' : 'N'}`;
}

export function fmtLon(lon: number): string {
  const l = ((lon % 360) + 360) % 360;
  return `${l.toFixed(2)}° E`;
}
