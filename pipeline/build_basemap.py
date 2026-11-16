"""South pole hillshade basemap for the site picker map (web/public/data/map/).

Made from the LOLA 80 m DEM (Barker et al. 2023). Covers the full 80S product
(+-304 km in polar stereographic), downsampled to 200 m per pixel.
"""
from __future__ import annotations

import json

import numpy as np
import rasterio
from PIL import Image

from common import RAW, WEB_DATA

DECIM = 2  # 80 m -> 160 m before shading
OUT_PX = 3040  # 200 m per pixel over 608 km


def hillshade(z: np.ndarray, res: float, az_deg: float = 300.0, alt_deg: float = 35.0, zf: float = 2.0) -> np.ndarray:
    gy, gx = np.gradient(z * zf, res)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(az_deg), np.radians(alt_deg)
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(hs, 0, 1)


def main() -> None:
    with rasterio.open(RAW / "dem" / "LDEM_80S_80MPP_ADJ.TIF") as ds:
        z = ds.read(1).astype(np.float32)
        b = ds.bounds
    h, w = (z.shape[0] // DECIM) * DECIM, (z.shape[1] // DECIM) * DECIM
    z = z[:h, :w].reshape(h // DECIM, DECIM, w // DECIM, DECIM).mean(axis=(1, 3))
    res = 80.0 * DECIM
    hs = hillshade(z, res)
    # Gentle elevation tint so high ridges read lighter than crater floors.
    zn = np.clip((z + 4000) / 10000, 0, 1)
    base = 0.18 + 0.62 * hs * (0.75 + 0.25 * zn)
    rgb = np.stack([base * 0.98, base * 0.97, base * 1.0], axis=-1)
    img = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).resize((OUT_PX, OUT_PX), Image.LANCZOS)
    out = WEB_DATA / "map"
    out.mkdir(parents=True, exist_ok=True)
    img.save(out / "south_pole_hillshade.webp", quality=82, method=6)
    meta = {"left": b.left, "right": b.right, "bottom": b.bottom, "top": b.top, "px": OUT_PX,
            "projection": "south polar stereographic, R=1737.4 km, x = rho sin(lon), y = rho cos(lon)",
            "source": "LOLA LDEM_80S_80MPP_ADJ (Barker et al. 2023), hillshade light from azimuth 300, altitude 35"}
    (out / "south_pole_hillshade.json").write_text(json.dumps(meta, indent=1))
    print("basemap", img.size, (out / "south_pole_hillshade.webp").stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
