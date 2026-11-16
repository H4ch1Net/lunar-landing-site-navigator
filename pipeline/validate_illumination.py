"""Compare our terrain-aware Sun visibility against published south pole results.

Reference: Glaser et al. 2018, Planetary and Space Science 162 (NTRS 20170007365):
20 m LOLA terrain, hourly from 2017-01-01 to 2037-01-01. Columns: average illumination
(mean visible fraction of the solar disk), solar visibility (any part of the disk
visible) and longest continuous time in shadow.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import numpy as np
import spiceypy as sp

from common import ABCORR, FRAME, GENERATED, R_MOON_KM, load_kernels, site_frame
from horizon import dem20_window, dem80, dem240, horizon_mask, latlon_to_xy

REF = [
    # name, lat, east lon, height above ground (m), avg illum %, solar visibility %, longest shadow h
    ("Connecting ridge C1 (surface)", -89.4505, 222.84, 0.0, 76.0, 81.3, 268),
    ("Connecting ridge C1 (2 m)", -89.4398, 222.83, 2.0, 88.0, 92.1, 112),
    ("Shackleton rim (surface)", -89.7849, 203.97, 0.0, 81.0, 85.5, 221),
    ("Shackleton rim (2 m)", -89.6866, 197.19, 2.0, 85.5, 89.4, 66),
    ("Shackleton rim B (2 m)", -89.7815, 204.70, 2.0, 82.1, 89.8, 65),
]


def sun_vectors_hourly(start: datetime, end: datetime) -> np.ndarray:
    n = int((end - start) / timedelta(hours=1))
    et0 = sp.utc2et(start.strftime("%Y-%m-%dT%H:%M:%S"))
    et = et0 + 3600.0 * np.arange(n)  # uniform TDB-ish grid; leap seconds are irrelevant here
    pos, _ = sp.spkpos("SUN", et, FRAME, ABCORR, "MOON")
    return np.asarray(pos)


def disk_fraction(h, r):
    c = np.clip(np.abs(h) / r, 0, 1)
    seg = (np.arccos(c) - c * np.sqrt(1 - c * c)) / np.pi
    f = np.where(h > 0, 1 - seg, seg)
    return np.where(h >= r, 1.0, np.where(h <= -r, 0.0, f))


def longest_run(mask: np.ndarray) -> int:
    best = cur = 0
    for v in mask:
        cur = cur + 1 if v else 0
        best = max(best, cur)
    return best


def main() -> None:
    load_kernels()
    sun = sun_vectors_hourly(datetime(2017, 1, 1, tzinfo=timezone.utc), datetime(2037, 1, 1, tzinfo=timezone.utc))
    g80, g240 = dem80(), dem240()
    results = []
    print(f"{'point':32s} {'ours avg/vis/shadow':>24s}   {'Glaser 2018':>22s}")
    for name, lat, lon, h, ref_avg, ref_vis, ref_shadow in REF:
        x, y = latlon_to_xy(lat, lon)
        g20 = dem20_window(x, y)
        mask, zs = horizon_mask(lat, lon, max(h, 0.5), 1440, g20.z, g20.params(), g80.z, g80.params(),
                                g240.z, g240.params(), 250000.0, 0.002)
        r, e, n, u = site_frame(lat, lon, (zs + max(h, 0.5)) / 1000.0)
        d = sun - r
        dist = np.linalg.norm(d, axis=1)
        el = np.degrees(np.arcsin(d @ u / dist))
        az = np.degrees(np.arctan2(d @ e, d @ n)) % 360
        hz = np.interp(az, np.arange(1441) * 0.25, np.append(mask, mask[0]))
        rad = np.degrees(np.arcsin(695700.0 / dist))
        frac = disk_fraction(el - hz, rad)
        avg = 100 * frac.mean()
        vis = 100 * (frac > 0).mean()
        shadow = longest_run(frac <= 0)
        print(f"{name:32s} {avg:6.1f}% {vis:6.1f}% {shadow:5d} h     {ref_avg:6.1f}% {ref_vis:6.1f}% {ref_shadow:4d} h")
        results.append({"name": name, "lat": lat, "lon": lon, "height_m": h, "site_elev_m": float(zs),
                         "ours": {"avg_illum_pct": round(avg, 1), "solar_visibility_pct": round(vis, 1), "longest_shadow_h": shadow},
                         "glaser2018": {"avg_illum_pct": ref_avg, "solar_visibility_pct": ref_vis, "longest_shadow_h": ref_shadow}})
    out = GENERATED / "illumination_validation.json"
    out.write_text(json.dumps({"period": "2017-01-01 to 2037-01-01, hourly", "reference": "Glaser et al. 2018, PSS 162",
                               "note": "surface cases use 0.5 m to avoid sampling the ground itself", "rows": results}, indent=1))
    print("wrote", out)
    _ = R_MOON_KM


if __name__ == "__main__":
    main()
