"""Terrain horizon masks from LOLA south polar DEMs.

Geometry: spherical Moon (R = 1737.4 km, the LOLA reference radius). For each azimuth we
march along the great circle from the site and keep the highest elevation angle of the
terrain, including the drop of the curved surface:

    el = atan( ((R + z_p) cos t - (R + z_s)) / ((R + z_p) sin t) ),   t = s / R

A point on the unit sphere p maps to south polar stereographic (true scale at the pole)
as x = 2R p_y / (1 - p_z), y = 2R p_x / (1 - p_z), which matches the DEM CRS.

Several DEM levels are used, finest first, each up to a distance limit.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import rasterio
from common import RAW, R_MOON_KM  # noqa: E402  (sets GDAL env before rasterio use)
from numba import njit, prange
from rasterio.windows import Window, from_bounds

R_M = R_MOON_KM * 1000.0
PGDA = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"


@dataclass
class Grid:
    z: np.ndarray  # float32 heights (m) relative to 1737.4 km, row 0 at top
    left: float
    top: float
    res: float
    limit_m: float  # use this grid for ground distances below this value

    def params(self):
        return np.array([self.left, self.top, self.res, self.limit_m], dtype=np.float64)


def read_grid(path: str, limit_m: float, bounds=None, decimate: int = 1) -> Grid:
    with rasterio.open(path) as ds:
        if bounds is None:
            z = ds.read(1, out_dtype="float32")
            left, top = ds.bounds.left, ds.bounds.top
        else:
            win = from_bounds(*bounds, transform=ds.transform).round_offsets().round_lengths()
            # Clip to the raster so window_transform matches the pixels actually read.
            win = win.intersection(Window(0, 0, ds.width, ds.height))
            z = ds.read(1, window=win, out_dtype="float32")
            t = ds.window_transform(win)
            left, top = t.c, t.f
        res = ds.res[0]
    if decimate > 1:
        h, w = (z.shape[0] // decimate) * decimate, (z.shape[1] // decimate) * decimate
        z = z[:h, :w].reshape(h // decimate, decimate, w // decimate, decimate).mean(axis=(1, 3))
        res = res * decimate
    z = np.nan_to_num(z, nan=0.0).astype(np.float32)
    return Grid(np.ascontiguousarray(z), left, top, res, limit_m)


def dem80() -> Grid:
    return read_grid(str(RAW / "dem" / "LDEM_80S_80MPP_ADJ.TIF"), limit_m=60_000.0)


def dem240() -> Grid:
    return read_grid(str(RAW / "dem" / "LDEM_60S_240MPP_ADJ.TIF"), limit_m=1e12)


def dem20_window(x: float, y: float, half_m: float = 10_000.0) -> Grid:
    url = "/vsicurl/" + PGDA + "LDEM_80S_20MPP_ADJ.TIF"
    return read_grid(url, limit_m=half_m * 0.8, bounds=(x - half_m, y - half_m, x + half_m, y + half_m))


def latlon_to_xy(lat_deg, lon_deg):
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    rho = 2 * R_M * np.tan((np.pi / 2 + lat) / 2)
    return rho * np.sin(lon), rho * np.cos(lon)


def xy_to_latlon(x, y):
    rho = np.hypot(x, y)
    lat = -np.pi / 2 + 2 * np.arctan(rho / (2 * R_M))
    lon = np.arctan2(x, y)
    return np.degrees(lat), np.degrees(lon) % 360


@njit(fastmath=True, cache=True, error_model="numpy")
def _sample(z, left, top, res, x, y):
    c = (x - left) / res - 0.5
    r = (top - y) / res - 0.5
    nr, nc = z.shape
    if c < 0.0 or r < 0.0 or c >= nc - 1 or r >= nr - 1:
        return np.nan
    c0 = int(c)
    r0 = int(r)
    fc = c - c0
    fr = r - r0
    return (z[r0, c0] * (1 - fc) * (1 - fr) + z[r0, c0 + 1] * fc * (1 - fr)
            + z[r0 + 1, c0] * (1 - fc) * fr + z[r0 + 1, c0 + 1] * fc * fr)


@njit(fastmath=True, cache=True, error_model="numpy")
def _height(s, x, y, z0, p0, z1, p1, z2, p2):
    """Height from the finest grid whose distance limit and extent cover the point."""
    if s < p0[3]:
        v = _sample(z0, p0[0], p0[1], p0[2], x, y)
        if not np.isnan(v):
            return v, p0[2]
    if s < p1[3]:
        v = _sample(z1, p1[0], p1[1], p1[2], x, y)
        if not np.isnan(v):
            return v, p1[2]
    v = _sample(z2, p2[0], p2[1], p2[2], x, y)
    return v, p2[2]


@njit(fastmath=True, cache=True, error_model="numpy")
def _site_basis(lat, lon):
    u = np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])
    e = np.array([-math.sin(lon), math.cos(lon), 0.0])
    n = np.array([u[1] * e[2] - u[2] * e[1], u[2] * e[0] - u[0] * e[2], u[0] * e[1] - u[1] * e[0]])
    return u, e, n


@njit(fastmath=True, cache=True, error_model="numpy")
def _ray(u, e, n, a, zs, z0, p0, z1, p1, z2, p2, s_max, frac):
    R = 1737400.0
    ca = math.cos(a)
    sa = math.sin(a)
    d0 = ca * n[0] + sa * e[0]
    d1 = ca * n[1] + sa * e[1]
    d2 = ca * n[2] + sa * e[2]
    best = -1e9
    s = 0.5 * p0[2] if p0[3] > 0 else 0.5 * p1[2]
    while s < s_max:
        t = s / R
        ct = math.cos(t)
        st = math.sin(t)
        px = ct * u[0] + st * d0
        py = ct * u[1] + st * d1
        pz = ct * u[2] + st * d2
        k = 2.0 * R / (1.0 - pz)
        zp, res = _height(s, k * py, k * px, z0, p0, z1, p1, z2, p2)
        if not np.isnan(zp):
            q = ((R + zp) * ct - (R + zs)) / ((R + zp) * st)
            if q > best:
                best = q
        else:
            res = 1000.0
        step = s * frac
        if step < 0.5 * res:
            step = 0.5 * res
        s += step
    return math.degrees(math.atan(best))


@njit(parallel=True, fastmath=True, cache=True, error_model="numpy")
def horizon_mask(lat_deg, lon_deg, mast_m, n_az, z0, p0, z1, p1, z2, p2, s_max, frac):
    lat = math.radians(max(lat_deg, -89.9999))
    lon = math.radians(lon_deg)
    u, e, n = _site_basis(lat, lon)
    k = 2.0 * 1737400.0 / (1.0 - u[2])
    zs, _ = _height(0.0, k * u[1], k * u[0], z0, p0, z1, p1, z2, p2)
    zs += mast_m
    out = np.empty(n_az)
    for i in prange(n_az):
        out[i] = _ray(u, e, n, 2.0 * math.pi * i / n_az, zs, z0, p0, z1, p1, z2, p2, s_max, frac)
    return out, zs - mast_m


@njit(parallel=True, fastmath=True, cache=True, error_model="numpy")
def horizon_masks_many(lats, lons, mast_m, n_az, z0, p0, z1, p1, z2, p2, s_max, frac):
    """Masks for many sites (used for map products). Returns (n_sites, n_az) float32."""
    m = lats.shape[0]
    out = np.empty((m, n_az), dtype=np.float32)
    zsite = np.empty(m, dtype=np.float32)
    for j in prange(m):
        lat = math.radians(max(lats[j], -89.9999))
        lon = math.radians(lons[j])
        u, e, n = _site_basis(lat, lon)
        k = 2.0 * 1737400.0 / (1.0 - u[2])
        zs, _ = _height(0.0, k * u[1], k * u[0], z0, p0, z1, p1, z2, p2)
        zsite[j] = zs
        for i in range(n_az):
            out[j, i] = _ray(u, e, n, 2.0 * math.pi * i / n_az, zs + mast_m, z0, p0, z1, p1, z2, p2, s_max, frac)
    return out, zsite


EMPTY = Grid(np.zeros((2, 2), np.float32), 0.0, 0.0, 1.0, 0.0)
