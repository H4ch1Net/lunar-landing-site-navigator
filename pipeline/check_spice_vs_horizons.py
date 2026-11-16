"""Compare direct SPICE topocentric az/el against the frozen Horizons fixtures."""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime

import numpy as np
import spiceypy as sp

from common import GENERATED, az_el, body_vectors, load_kernels


def main() -> None:
    load_kernels()
    rows = json.loads((GENERATED / "horizons_fixtures.json").read_text())["rows"]
    errs = defaultdict(list)
    for r in rows:
        utc = datetime.strptime(r["utc"], "%Y-%b-%d %H:%M").strftime("%Y-%m-%dT%H:%M:00")
        et = sp.str2et(utc)
        sun, earth = body_vectors(np.array([et]))
        body = sun if r["body"] == "Sun" else earth
        az, el, _ = az_el(body, r["lat"], r["lon"], r["alt_km"])
        daz = (az[0] - r["az"] + 180) % 360 - 180
        # azimuth error expressed as angle on the sky (shrinks near zenith)
        daz_sky = daz * np.cos(np.radians(r["el"]))
        errs[(r["site"], r["body"])].append((el[0] - r["el"], daz_sky, daz))
    print(f"{'site':40s} {'body':5s}  max|del|   max|daz*cos(el)|   max|daz|   (degrees)")
    allv = []
    for k, v in errs.items():
        v = np.array(v)
        allv.append(v)
        print(f"{k[0]:40s} {k[1]:5s}  {np.abs(v[:,0]).max():.6f}   {np.abs(v[:,1]).max():.6f}          {np.abs(v[:,2]).max():.6f}")
    allv = np.vstack(allv)
    print("overall max |d el| =", np.abs(allv[:, 0]).max(), " max sky |d az| =", np.abs(allv[:, 1]).max())


if __name__ == "__main__":
    main()
