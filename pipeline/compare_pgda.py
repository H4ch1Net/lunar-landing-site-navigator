"""Our 18.6-year Sun and Earth visibility at curated polar sites vs NASA PGDA maps (Mazarico)."""
import json
from datetime import datetime, timezone
import numpy as np
import spiceypy as sp
from common import ABCORR, FRAME, GENERATED, load_kernels, site_frame
from horizon import dem20_window, dem80, dem240, horizon_mask, latlon_to_xy, EMPTY

load_kernels()
t0 = datetime(2017, 1, 1, tzinfo=timezone.utc)
n = int(18.6 * 365.25 * 24)
et = sp.utc2et(t0.strftime("%Y-%m-%dT%H:%M:%S")) + 3600.0 * np.arange(n)
sun = np.asarray(sp.spkpos("SUN", et, FRAME, ABCORR, "MOON")[0])
earth = np.asarray(sp.spkpos("EARTH", et, FRAME, ABCORR, "MOON")[0])
g80, g240 = dem80(), dem240()
pg = json.loads((GENERATED / "pgda_site_values.json").read_text())
rows = []
for s in pg:
    lat, lon = s["lat"], s["lon"]
    x, y = latlon_to_xy(lat, lon)
    if max(abs(x), abs(y)) < 303000:
        g20 = dem20_window(x, y); a, pa, b, pb = g20.z, g20.params(), g80.z, g80.params()
    else:
        a, pa, b, pb = EMPTY.z, EMPTY.params(), EMPTY.z, EMPTY.params()
    mask, zs = horizon_mask(lat, lon, 0.5, 1440, a, pa, b, pb, g240.z, g240.params(), 250000.0, 0.002)
    r, e, nn, u = site_frame(lat, lon, (zs + 0.5) / 1000)
    out = {}
    for name, vec, rad in (("sun", sun, 695700.0), ("earth", earth, 6371.0)):
        d = vec - r; dist = np.linalg.norm(d, axis=1)
        el = np.degrees(np.arcsin(d @ u / dist)); az = np.degrees(np.arctan2(d @ e, d @ nn)) % 360
        hz = np.interp(az, np.arange(1441) * 0.25, np.append(mask, mask[0]))
        out[name] = float(((el + np.degrees(np.arcsin(rad / dist))) > hz).mean())
    rows.append({**s, "ours_sun": out["sun"], "ours_earth": out["earth"]})
    print(f"{s['id']:22s} sun ours {out['sun']:.3f} pgda {s['pgda_sun']:.3f} | earth ours {out['earth']:.3f} pgda {s['pgda_earth']:.3f}")
ds = np.array([r["ours_sun"] - r["pgda_sun"] for r in rows]); de = np.array([r["ours_earth"] - r["pgda_earth"] for r in rows])
print("sun diff median abs %.3f, earth diff median abs %.3f" % (np.median(np.abs(ds)), np.median(np.abs(de))))
(GENERATED / "pgda_comparison.json").write_text(json.dumps({"period": "2017-01-01 + 18.6 years, hourly", "height_m": 0.5, "rows": rows}, indent=1))
