// Topocentric geometry on a spherical Moon (R = 1737.4 km, the LOLA reference radius).
// Conventions match JPL Horizons: planetocentric latitude, east longitude, azimuth
// measured from local north clockwise toward east, elevation above the local horizontal.

import type { Vec3 } from './ephemeris';

export const R_MOON_KM = 1737.4;
export const R_SUN_KM = 695700;
export const R_EARTH_KM = 6371.0;
export const AU_KM = 149597870.7;
export const SOLAR_CONSTANT_W_M2 = 1361;
const D = Math.PI / 180;

export interface SiteFrame {
  r: Vec3;
  e: Vec3;
  n: Vec3;
  u: Vec3;
}

export function siteFrame(latDeg: number, lonDeg: number, heightKm = 0): SiteFrame {
  // Keep the pole itself well defined: azimuth is undefined exactly at +-90 deg.
  const lat = Math.max(-89.9999, Math.min(89.9999, latDeg)) * D;
  const lon = lonDeg * D;
  const cl = Math.cos(lat);
  const u: Vec3 = [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)];
  const e: Vec3 = [-Math.sin(lon), Math.cos(lon), 0];
  const n: Vec3 = [u[1] * e[2] - u[2] * e[1], u[2] * e[0] - u[0] * e[2], u[0] * e[1] - u[1] * e[0]];
  const rr = R_MOON_KM + heightKm;
  return { r: [rr * u[0], rr * u[1], rr * u[2]], e, n, u };
}

export interface AzEl {
  az: number;
  el: number;
  dist: number;
}

export function azEl(body: Vec3, f: SiteFrame, out?: AzEl): AzEl {
  const dx = body[0] - f.r[0];
  const dy = body[1] - f.r[1];
  const dz = body[2] - f.r[2];
  const dist = Math.hypot(dx, dy, dz);
  const up = (dx * f.u[0] + dy * f.u[1] + dz * f.u[2]) / dist;
  const east = dx * f.e[0] + dy * f.e[1] + dz * f.e[2];
  const north = dx * f.n[0] + dy * f.n[1] + dz * f.n[2];
  const o = out ?? { az: 0, el: 0, dist: 0 };
  o.el = Math.asin(Math.max(-1, Math.min(1, up))) / D;
  o.az = ((Math.atan2(east, north) / D) % 360 + 360) % 360;
  o.dist = dist;
  return o;
}

/** Terrain horizon elevation (deg) at azimuth, linear interpolation with wrap. null = smooth sphere. */
export function maskAt(mask: Float32Array | null, azDeg: number): number {
  if (!mask) return 0;
  const n = mask.length;
  const x = (((azDeg % 360) + 360) % 360) * (n / 360);
  const i = Math.floor(x);
  const f = x - i;
  return mask[i % n] * (1 - f) + mask[(i + 1) % n] * f;
}

/**
 * Fraction of a disk of angular radius r that is above a locally flat horizon line,
 * given the height h of the disk centre above that line (same units as r).
 */
export function diskFraction(h: number, r: number): number {
  if (h >= r) return 1;
  if (h <= -r) return 0;
  const c = Math.abs(h) / r;
  const seg = (Math.acos(c) - c * Math.sqrt(1 - c * c)) / Math.PI; // segment beyond the chord
  return h > 0 ? 1 - seg : seg;
}

export function angularRadiusDeg(radiusKm: number, distKm: number): number {
  return Math.asin(Math.min(1, radiusKm / distKm)) / D;
}

/** Illuminated fraction of Earth's disk as seen from the Moon (0 = new Earth, 1 = full Earth). */
export function earthPhase(sun: Vec3, earth: Vec3): number {
  const a: Vec3 = [sun[0] - earth[0], sun[1] - earth[1], sun[2] - earth[2]];
  const la = Math.hypot(a[0], a[1], a[2]);
  const le = Math.hypot(earth[0], earth[1], earth[2]);
  const c = -(a[0] * earth[0] + a[1] * earth[1] + a[2] * earth[2]) / (la * le);
  return (1 + c) / 2;
}

/** Great-circle distance in km between two lunar surface points. */
export function surfaceDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D;
  const p2 = lat2 * D;
  const dl = (lon2 - lon1) * D;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_MOON_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
