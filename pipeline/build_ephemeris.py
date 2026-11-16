"""Build compact per-year Sun/Earth vector files for the browser.

Each file web/public/data/eph/<year>.bin is a little-endian Float32 array with 6 values
per sample: Sun xyz, Earth xyz (km, apparent, LT+S, Moon centre, MOON_ME frame).
Samples are on a uniform UTC grid with step STEP_H hours, from Jan 1 00:00 UTC minus one
step to Jan 1 of the next year plus one step, so a 4-point cubic Lagrange interpolation
works everywhere inside the year without reading a neighbouring file.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import numpy as np
import spiceypy as sp

from common import ABCORR, FRAME, KERNEL_FILES, WEB_DATA, load_kernels

STEP_H = 2
YEARS = [1969, 1970, 1971, 1972, 2013, 2019, 2020, 2023] + list(range(2024, 2036))


def utc_grid(year: int) -> list[datetime]:
    t0 = datetime(year, 1, 1, tzinfo=timezone.utc)
    t1 = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    m = int((t1 - t0) / timedelta(hours=STEP_H))
    return [t0 + timedelta(hours=STEP_H * k) for k in range(-1, m + 2)]


def ets(times: list[datetime]) -> np.ndarray:
    return np.array([sp.utc2et(t.strftime("%Y-%m-%dT%H:%M:%S.%f")) for t in times])


def vectors(et: np.ndarray) -> np.ndarray:
    sun, _ = sp.spkpos("SUN", et, FRAME, ABCORR, "MOON")
    earth, _ = sp.spkpos("EARTH", et, FRAME, ABCORR, "MOON")
    return np.hstack([np.asarray(sun), np.asarray(earth)])


def lagrange4(samples: np.ndarray, f: np.ndarray) -> np.ndarray:
    """samples: (n, 4, 6) for nodes -1, 0, 1, 2; f in [0, 1)."""
    w = np.stack([
        -f * (f - 1) * (f - 2) / 6,
        (f + 1) * (f - 1) * (f - 2) / 2,
        -(f + 1) * f * (f - 2) / 2,
        (f + 1) * f * (f - 1) / 6,
    ], axis=1)
    return np.einsum("nk,nkj->nj", w, samples)


def interpolation_error(year: int, data: np.ndarray, n: int = 3000) -> dict:
    rng = np.random.default_rng(year)
    t0 = datetime(year, 1, 1, tzinfo=timezone.utc)
    m = data.shape[0] - 3
    x = rng.uniform(0, m, n)
    i = np.floor(x).astype(int)
    f = x - i
    idx = (i[:, None] + np.arange(4)[None, :])  # data row of node -1 is i (offset by one pre-sample)
    interp = lagrange4(data[idx].astype(np.float64), f)
    times = [t0 + timedelta(hours=STEP_H * xx) for xx in x]
    truth = vectors(ets(times))

    def ang(a, b):
        a = a / np.linalg.norm(a, axis=1, keepdims=True)
        b = b / np.linalg.norm(b, axis=1, keepdims=True)
        return np.degrees(np.arccos(np.clip((a * b).sum(1), -1, 1)))

    return {"sun_max_deg": float(ang(interp[:, :3], truth[:, :3]).max()),
            "earth_max_deg": float(ang(interp[:, 3:], truth[:, 3:]).max()),
            "earth_max_km": float(np.linalg.norm(interp[:, 3:] - truth[:, 3:], axis=1).max())}


def main() -> None:
    load_kernels()
    out = WEB_DATA / "eph"
    out.mkdir(parents=True, exist_ok=True)
    manifest = {"frame": FRAME, "abcorr": ABCORR, "center": "MOON", "units": "km",
                "step_hours": STEP_H, "layout": "float32 LE [sun_x,sun_y,sun_z,earth_x,earth_y,earth_z] per sample; "
                                                 "sample k at Jan 1 00:00 UTC + (k-1)*step",
                "kernels": KERNEL_FILES, "years": YEARS, "interp_check": {}}
    for y in YEARS:
        data = vectors(ets(utc_grid(y))).astype("<f4")
        (out / f"{y}.bin").write_bytes(data.tobytes())
        if y in (1969, 2026, 2030):
            manifest["interp_check"][str(y)] = interpolation_error(y, data)
            print(y, manifest["interp_check"][str(y)])
        print(y, data.shape, f"{data.nbytes/1024:.0f} KB")
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
