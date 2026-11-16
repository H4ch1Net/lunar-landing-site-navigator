"""Terrain tiles so the browser can compute a horizon for any south polar point.

Three levels, each int16 heights in metres (relative to 1737.4 km), row-delta encoded
and gzipped, in south polar stereographic like the source DEMs:

  L0  80 m   from LDEM_80S_80MPP  used 0 to 8 km from the site   tiles within |x|,|y| <= 184 km
  L1  240 m  80 m averaged 3x3    used 8 to 60 km                tiles over the whole 80S product
  L2  960 m  60S 240 m averaged   used beyond 60 km              one file, |x|,|y| <= 600 km

Decoding: gunzip, read int16 LE, then cumulative sum along each row.
"""
from __future__ import annotations

import gzip
import json

import numpy as np

from common import WEB_DATA
from horizon import dem80, dem240

TILE = 256


def block_mean(z: np.ndarray, k: int) -> np.ndarray:
    h, w = (z.shape[0] // k) * k, (z.shape[1] // k) * k
    return z[:h, :w].reshape(h // k, k, w // k, k).mean(axis=(1, 3))


def encode(a: np.ndarray) -> bytes:
    q = np.round(a).astype(np.int32)
    d = np.diff(q, axis=1, prepend=0)
    d = np.clip(d, -32768, 32767).astype("<i2")
    return gzip.compress(d.tobytes(), compresslevel=9, mtime=0)


def write_tiles(z: np.ndarray, left: float, top: float, res: float, name: str, limit_km: float | None):
    out = WEB_DATA / "terrain" / name
    out.mkdir(parents=True, exist_ok=True)
    ny, nx = int(np.ceil(z.shape[0] / TILE)), int(np.ceil(z.shape[1] / TILE))
    present = []
    total = 0
    for ty in range(ny):
        for tx in range(nx):
            x0 = left + tx * TILE * res
            y0 = top - ty * TILE * res
            x1, y1 = x0 + TILE * res, y0 - TILE * res
            if limit_km is not None:
                # keep a tile if any part lies inside the |x|,|y| <= limit square
                if x1 < -limit_km * 1000 or x0 > limit_km * 1000 or y0 < -limit_km * 1000 or y1 > limit_km * 1000:
                    continue
            # One pixel of overlap on the right and bottom so bilinear sampling never needs a neighbour.
            blk = z[ty * TILE: (ty + 1) * TILE + 1, tx * TILE: (tx + 1) * TILE + 1]
            full = np.full((TILE + 1, TILE + 1), np.nan, dtype=np.float32)
            full[: blk.shape[0], : blk.shape[1]] = blk
            if np.isnan(full[:TILE, :TILE]).all():
                continue
            full = np.where(np.isnan(full), np.nanmean(full), full)
            data = encode(full)
            (out / f"{tx}_{ty}.bin").write_bytes(data)
            total += len(data)
            present.append([tx, ty])
    print(f"{name}: {len(present)} tiles, {total/1e6:.1f} MB, res {res} m")
    return {"name": name, "res": res, "left": left, "top": top, "tile": TILE, "stride": TILE + 1,
            "nx": nx, "ny": ny, "tiles": present}


def main() -> None:
    g80, g240 = dem80(), dem240()
    levels = []
    levels.append({**write_tiles(g80.z, g80.left, g80.top, 80.0, "L0", limit_km=184), "max_dist_m": 8000})
    z240 = block_mean(g80.z, 3)
    levels.append({**write_tiles(z240, g80.left, g80.top, 240.0, "L1", limit_km=None), "max_dist_m": 60000})
    # L2: crop 60S product to +-600 km then average 4x4 -> 960 m
    half = 600_000
    c0 = int((-half - g240.left) / 240)
    r0 = int((g240.top - half) / 240)
    n = int(2 * half / 240)
    crop = g240.z[r0: r0 + n, c0: c0 + n]
    z960 = block_mean(crop, 4)
    left, top = g240.left + c0 * 240, g240.top - r0 * 240
    l2 = write_tiles(z960, left, top, 960.0, "L2", limit_km=None)
    levels.append({**l2, "max_dist_m": 1e12})
    meta = {"units": "m relative to 1737.4 km sphere", "projection": "south polar stereographic, x = 2R p_y/(1-p_z), y = 2R p_x/(1-p_z)",
            "encoding": "gzip of int16 LE row deltas, (tile+1) x (tile+1) samples, row 0 at top",
            "source": "LOLA LDEM_80S_80MPP_ADJ and LDEM_60S_240MPP_ADJ (Barker et al. 2023)", "levels": levels}
    (WEB_DATA / "terrain" / "index.json").write_text(json.dumps(meta))


if __name__ == "__main__":
    main()
