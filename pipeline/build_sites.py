"""Build web/public/data/sites.json: curated sites with terrain horizon masks.

Sites inside the LOLA 80S product get a mask from a 20 m near field (remote COG window),
the 80 m 80S DEM and the 240 m 60S DEM. Sites between 60S and 80S use the 240 m DEM only.
Other sites have no terrain model (smooth horizon) and say so in the UI.
"""
from __future__ import annotations

import json
import time

import numpy as np

from common import GENERATED, ROOT, WEB_DATA
from horizon import EMPTY, dem20_window, dem80, dem240, horizon_mask, latlon_to_xy

N_AZ = 720
MAST_M = 2.0
INPUT = ROOT / "pipeline" / "sites_input.json"


def main() -> None:
    sites = json.loads(INPUT.read_text(encoding="utf-8"))["sites"]
    g80, g240 = dem80(), dem240()
    out = []
    for s in sites:
        lat, lon = s["lat"], s["lon"]
        rec = {k: v for k, v in s.items() if not k.startswith("_")}
        t = time.time()
        if lat <= -60:
            x, y = latlon_to_xy(lat, lon)
            inside80 = max(abs(x), abs(y)) < 303_000  # finer grids fall back to 240 m outside their extent
            if inside80:
                g20 = dem20_window(x, y)
                a, pa, b, pb = g20.z, g20.params(), g80.z, g80.params()
                rec["terrain"] = "LOLA 20 m near field, 80 m and 240 m far field"
            else:
                a, pa, b, pb = EMPTY.z, EMPTY.params(), EMPTY.z, EMPTY.params()
                rec["terrain"] = "LOLA 240 m"
            mask, zs = horizon_mask(lat, lon, MAST_M, N_AZ, a, pa, b, pb, g240.z, g240.params(), 250000.0, 0.002)
            rec["elev_m"] = round(float(zs), 1)
            rec["mask_cdeg"] = [int(round(v * 100)) for v in mask]
            print(f"{s['id']:24s} z={zs:8.1f} m  horizon {mask.min():6.2f}..{mask.max():6.2f} deg  ({time.time()-t:.1f}s)")
        else:
            rec.setdefault("elev_m", 0.0)
            rec["terrain"] = "none (smooth horizon)"
            rec["mask_cdeg"] = None
            print(f"{s['id']:24s} smooth horizon")
        out.append(rec)
    doc = {"generated_utc": time.strftime("%Y-%m-%d %H:%M", time.gmtime()), "n_az": N_AZ, "mast_m": MAST_M,
           "az_convention": "index k = azimuth k*360/n_az deg from local north, clockwise toward east",
           "sites": out}
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    (WEB_DATA / "sites.json").write_text(json.dumps(doc, separators=(",", ":")))
    (GENERATED / "sites_summary.json").write_text(json.dumps(
        [{k: v for k, v in r.items() if k != "mask_cdeg"} for r in out], indent=1))
    print("wrote", WEB_DATA / "sites.json", len(out), "sites")


if __name__ == "__main__":
    main()
