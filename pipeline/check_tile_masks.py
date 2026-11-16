"""How far are browser-level masks (80/240/960 m) from the 20 m-near-field masks?"""
import json
import numpy as np
from common import WEB_DATA, GENERATED
from horizon import Grid, dem80, dem240, horizon_mask
from build_tiles import block_mean

g80, g240 = dem80(), dem240()
L0 = Grid(g80.z, g80.left, g80.top, 80.0, 8000.0)
L1 = Grid(block_mean(g80.z, 3).astype(np.float32), g80.left, g80.top, 240.0, 60000.0)
half = 600_000; c0 = int((-half - g240.left) / 240); r0 = int((g240.top - half) / 240); n = int(2 * half / 240)
L2 = Grid(block_mean(g240.z[r0:r0+n, c0:c0+n], 4).astype(np.float32), g240.left + c0*240, g240.top - r0*240, 960.0, 1e12)
sites = json.loads((WEB_DATA / "sites.json").read_text())["sites"]
rows = []
for s in sites:
    if not s.get("mask_cdeg") or s["lat"] > -80: continue
    ref = np.array(s["mask_cdeg"]) / 100
    m, zs = horizon_mask(s["lat"], s["lon"], 2.0, 720, L0.z, L0.params(), L1.z, L1.params(), L2.z, L2.params(), 250000.0, 0.002)
    d = m - ref
    rows.append((s["id"], float(np.sqrt((d**2).mean())), float(np.abs(d).max()), float(d.mean())))
    print(f"{s['id']:22s} rms {rows[-1][1]:.2f}  max {rows[-1][2]:.2f}  bias {rows[-1][3]:+.2f} deg")
r = np.array([x[1] for x in rows]); print("median rms", np.median(r), "mean rms", r.mean())
(GENERATED / "tile_mask_check.json").write_text(json.dumps([dict(id=a, rms=b, max=c, bias=d) for a,b,c,d in rows], indent=1))
