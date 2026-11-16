"""Fetch Sun and Earth apparent azimuth/elevation from JPL Horizons for Moon surface sites.

The results are frozen as fixtures (data/generated/horizons_fixtures.json) and used to
validate both the Python pipeline and the TypeScript code that ships in the browser.
"""
from __future__ import annotations

import json
import re
import time

import requests

from common import GENERATED

API = "https://ssd.jpl.nasa.gov/api/horizons.api"

# name, planetocentric lat (deg), east lon (deg), altitude above 1737.4 km sphere (km)
SITES = [
    ("Connecting Ridge (near Shackleton)", -89.45, 222.69, 1.8),
    ("Odysseus (IM-1), Malapert A", -80.13, 1.44, 2.579),
    ("Near south pole", -89.99, 0.0, 0.0),
    ("Apollo 11, Tranquility Base", 0.67408, 23.47297, 0.0),
    ("Blue Ghost 1, Mare Crisium", 18.562, 61.810, 0.0),
    ("Chang'e 6, far side", -41.6385, 206.0148, 0.0),
]

RANGES = [
    ("2026-11-14 00:00", "2026-12-14 00:00", "19h"),
    ("2028-02-01 00:00", "2028-03-01 00:00", "23h"),
]
# Apollo 11 lunar module touchdown, 1969-07-20 20:17:40 UTC.
APOLLO11 = ("1969-07-20 20:17", "1969-07-20 20:18", "1m")

BODIES = {"Sun": "10", "Earth": "399"}

ROW = re.compile(r"^\s*(\d{4}-[A-Za-z]{3}-\d{2} \d{2}:\d{2})\s+\S*\s*\S*\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s*$")


def query(body_id: str, lat: float, lon: float, alt: float, start: str, stop: str, step: str):
    params = {
        "format": "json",
        "COMMAND": f"'{body_id}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon % 360:.6f},{lat:.6f},{alt:.4f}'",
        "START_TIME": f"'{start}'",
        "STOP_TIME": f"'{stop}'",
        "STEP_SIZE": f"'{step}'",
        "QUANTITIES": "'4'",
        "CAL_FORMAT": "'CAL'",
        "TIME_DIGITS": "'MINUTES'",
    }
    for attempt in range(4):
        r = requests.get(API, params=params, timeout=60)
        if r.ok:
            break
        time.sleep(2 + attempt * 3)
    r.raise_for_status()
    text = r.json()["result"]
    block = text.split("$$SOE")[1].split("$$EOE")[0]
    rows = []
    for line in block.strip().splitlines():
        m = ROW.match(line)
        if not m:
            # Fallback: last two numbers on the line are azimuth and elevation.
            nums = re.findall(r"-?\d+\.\d+", line)
            date = re.match(r"^\s*(\d{4}-[A-Za-z]{3}-\d{2} \d{2}:\d{2})", line)
            if not date or len(nums) < 2:
                raise ValueError(f"cannot parse Horizons row: {line!r}")
            rows.append((date.group(1), float(nums[-2]), float(nums[-1])))
        else:
            rows.append((m.group(1), float(m.group(2)), float(m.group(3))))
    return rows, text


def main() -> None:
    fixtures = []
    for name, lat, lon, alt in SITES:
        ranges = list(RANGES)
        if name.startswith("Apollo 11"):
            ranges.append(APOLLO11)
        for body, bid in BODIES.items():
            for start, stop, step in ranges:
                rows, _ = query(bid, lat, lon, alt, start, stop, step)
                for utc, az, el in rows:
                    fixtures.append(
                        {"site": name, "lat": lat, "lon": lon, "alt_km": alt, "body": body,
                         "utc": utc, "az": az, "el": el}
                    )
                print(f"{name:40s} {body:5s} {start} -> {len(rows)} rows")
                time.sleep(0.5)
    GENERATED.mkdir(parents=True, exist_ok=True)
    out = GENERATED / "horizons_fixtures.json"
    out.write_text(json.dumps({"source": "JPL Horizons API, QUANTITIES=4 (apparent az/el), center coord@301",
                               "fetched_utc": time.strftime("%Y-%m-%d %H:%M", time.gmtime()),
                               "rows": fixtures}, indent=1))
    print("wrote", out, len(fixtures), "rows")


if __name__ == "__main__":
    main()
