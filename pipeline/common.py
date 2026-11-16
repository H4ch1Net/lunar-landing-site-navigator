"""Shared helpers for the offline pipeline: paths, SPICE setup, topocentric geometry."""
from __future__ import annotations

import os
import pathlib

# Fast windowed HTTP reads of the PGDA cloud-optimized GeoTIFFs.
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".TIF")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")

import numpy as np
import spiceypy as sp

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
KERNELS = RAW / "kernels"
GENERATED = ROOT / "data" / "generated"
WEB_DATA = ROOT / "web" / "public" / "data"

# Lunar reference radius used by LOLA polar products and by Horizons for the Moon.
R_MOON_KM = 1737.4

# MOON_ME is an alias (in moon_de440_250416.tf) for MOON_ME_DE440_ME421, which is
# aligned with the DE421 mean-Earth frame that the LOLA polar DEMs use.
FRAME = "MOON_ME"
ABCORR = "LT+S"

KERNEL_FILES = [
    "latest_leapseconds.tls",
    "pck00011.tpc",
    "moon_pa_de440_200625.bpc",
    "moon_de440_250416.tf",
    "de440s.bsp",
]

_loaded = False


def load_kernels() -> None:
    global _loaded
    if _loaded:
        return
    for k in KERNEL_FILES:
        sp.furnsh(str(KERNELS / k))
    _loaded = True


def body_vectors(et: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Apparent Sun and Earth position (km) from the Moon centre in MOON_ME."""
    load_kernels()
    sun = np.empty((len(et), 3))
    earth = np.empty((len(et), 3))
    for i, t in enumerate(et):
        sun[i], _ = sp.spkpos("SUN", float(t), FRAME, ABCORR, "MOON")
        earth[i], _ = sp.spkpos("EARTH", float(t), FRAME, ABCORR, "MOON")
    return sun, earth


def site_frame(lat_deg: float, lon_deg: float, h_km: float = 0.0):
    """Site position and local east/north/up unit vectors (planetocentric lat, east lon)."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.cross(up, east)
    r = (R_MOON_KM + h_km) * up
    return r, east, north, up


def az_el(body: np.ndarray, lat_deg: float, lon_deg: float, h_km: float = 0.0):
    """Topocentric azimuth (deg from north, clockwise toward east) and elevation (deg)."""
    r, east, north, up = site_frame(lat_deg, lon_deg, h_km)
    d = np.atleast_2d(body) - r
    dist = np.linalg.norm(d, axis=1)
    el = np.degrees(np.arcsin(d @ up / dist))
    az = np.degrees(np.arctan2(d @ east, d @ north)) % 360.0
    return az, el, dist
