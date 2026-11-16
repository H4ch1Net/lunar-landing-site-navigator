"""Map overlays from NASA PGDA Lunar Polar Illumination (Mazarico et al. 2011, product 69).

AVGVISIB_75S_120M_201608 (solar) and _EARTH: fraction of hourly steps over 18.6 years in
which any part of the Sun (or Earth) disk is visible from the surface. Cropped to the
same +-304 km square as the hillshade basemap and colour-mapped with transparency.
Also samples both maps at every curated south polar site for the comparison table.
"""
from __future__ import annotations

import json

import numpy as np
import rasterio
from PIL import Image
from rasterio.windows import from_bounds

from common import GENERATED, RAW, WEB_DATA
from horizon import latlon_to_xy

HALF = 304_000
OUT_PX = 2048


def read_crop(name: str) -> tuple[np.ndarray, rasterio.io.DatasetReader]:
    ds = rasterio.open(RAW / "illum" / name)
    win = from_bounds(-HALF, -HALF, HALF, HALF, transform=ds.transform).round_offsets().round_lengths()
    a = ds.read(1, window=win).astype(np.float32)
    a = np.where(a == ds.nodata, np.nan, a * ds.scales[0])
    return a, ds


def colourise(v: np.ndarray, stops: list[tuple[float, tuple[int, int, int, int]]]) -> np.ndarray:
    xs = np.array([s[0] for s in stops])
    out = np.zeros(v.shape + (4,), dtype=np.float32)
    vv = np.nan_to_num(v, nan=0.0)
    for c in range(4):
        out[..., c] = np.interp(vv, xs, [s[1][c] for s in stops])
    return out.astype(np.uint8)


def sample(ds, lat, lon):
    x, y = latlon_to_xy(lat, lon)
    r, c = ds.index(x, y)
    v = ds.read(1, window=((r, r + 1), (c, c + 1)))[0, 0]
    return None if v == ds.nodata else float(v) * ds.scales[0]


def main() -> None:
    out = WEB_DATA / "map"
    out.mkdir(parents=True, exist_ok=True)
    sun, ds_sun = read_crop("AVGVISIB_75S_120M_201608.TIF")
    earth, ds_earth = read_crop("AVGVISIB_75S_120M_201608_EARTH.TIF")
    sun_rgba = colourise(sun, [(0.0, (20, 10, 40, 0)), (0.05, (40, 20, 90, 90)), (0.3, (150, 50, 90, 150)),
                               (0.55, (230, 120, 40, 190)), (0.8, (255, 205, 80, 225)), (1.0, (255, 250, 210, 240))])
    earth_rgba = colourise(earth, [(0.0, (10, 20, 40, 0)), (0.05, (20, 40, 90, 70)), (0.4, (40, 110, 190, 150)),
                                   (0.8, (100, 180, 240, 200)), (1.0, (200, 235, 255, 225))])
    for name, rgba in (("sun_visibility", sun_rgba), ("earth_visibility", earth_rgba)):
        img = Image.fromarray(rgba, "RGBA").resize((OUT_PX, OUT_PX), Image.BILINEAR)
        img.save(out / f"{name}.webp", quality=80, method=6)
        print(name, (out / f"{name}.webp").stat().st_size // 1024, "KB")

    sites = json.loads((WEB_DATA / "sites.json").read_text())["sites"]
    rows = []
    for s in sites:
        if s["lat"] > -75:
            continue
        rows.append({"id": s["id"], "name": s["name"], "lat": s["lat"], "lon": s["lon"],
                     "pgda_sun": sample(ds_sun, s["lat"], s["lon"]), "pgda_earth": sample(ds_earth, s["lat"], s["lon"])})
        print(f"{s['id']:22s} sun {rows[-1]['pgda_sun']:.3f}  earth {rows[-1]['pgda_earth']:.3f}")
    (GENERATED / "pgda_site_values.json").write_text(json.dumps(rows, indent=1))
    meta = {"left": -HALF, "right": HALF, "bottom": -HALF, "top": HALF,
            "source": "NASA PGDA Lunar Polar Illumination, AVGVISIB_75S_120M_201608 and _EARTH (Mazarico et al. 2011)",
            "meaning": "fraction of hourly time steps over 18.6 years with any part of the disk visible, at the surface"}
    (out / "visibility_overlays.json").write_text(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
