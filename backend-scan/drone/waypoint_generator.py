"""
waypoint_generator.py

Converts an NDVI anomaly bounding box into a Litchi-compatible waypoint CSV
describing a lawnmower survey pattern (fixed altitude, fixed heading, camera
capture at each waypoint). This is the Stage 0 artifact: a human loads the CSV
into Litchi and flies the mission.

The same bbox -> mission logic is what later gets swapped for a DJI Cloud API
mission payload at Stage 1/2 (see roadmap). Keep the geometry here; only the
output serializer changes.

Coordinate convention throughout: (lng, lat) in WGS84 degrees, matching the
GeoJSON {lng, lat} maps already stored in Firestore.
"""

from __future__ import annotations

import csv
import io
import math
from dataclasses import dataclass, field
from typing import List, Tuple

# ---- Survey parameters -------------------------------------------------------

# Ground sampling: at 10-15 m AGL with the Mini 4 Pro stock 48 MP sensor the
# doc cites ~0.3-0.5 cm/pixel. Altitude and overlap below are chosen for
# lesion-scale RGB capture with enough overlap for optional ODM stitching.

@dataclass
class SurveyConfig:
    altitude_m: float = 12.0          # AGL; within the 10-15 m band from the spec
    speed_ms: float = 2.5             # slow enough to avoid motion blur at capture
    front_overlap: float = 0.75       # along-track overlap (fraction)
    side_overlap: float = 0.65        # between adjacent passes (fraction)
    sensor_width_m_at_alt: float = 18.0  # approx ground footprint width at altitude_m
    sensor_height_m_at_alt: float = 13.0 # approx ground footprint height at altitude_m
    heading_deg: float = 0.0          # pass heading; 0 = North-South passes
    gimbal_pitch_deg: float = -90.0   # nadir
    max_waypoints: int = 99           # Litchi practical mission cap
    margin_m: float = 5.0             # expand bbox outward so edges are covered


# ---- Geodesy helpers ---------------------------------------------------------

_EARTH_R = 6_378_137.0  # WGS84 equatorial radius, meters


def _meters_per_deg(lat_deg: float) -> Tuple[float, float]:
    """Return (meters_per_deg_lng, meters_per_deg_lat) at a given latitude."""
    lat = math.radians(lat_deg)
    m_per_deg_lat = (
        111_132.92
        - 559.82 * math.cos(2 * lat)
        + 1.175 * math.cos(4 * lat)
        - 0.0023 * math.cos(6 * lat)
    )
    m_per_deg_lng = (
        111_412.84 * math.cos(lat)
        - 93.5 * math.cos(3 * lat)
        + 0.118 * math.cos(5 * lat)
    )
    return m_per_deg_lng, m_per_deg_lat


def _offset(lng: float, lat: float, d_east_m: float, d_north_m: float) -> Tuple[float, float]:
    """Offset a lng/lat point by meters east/north."""
    m_lng, m_lat = _meters_per_deg(lat)
    return lng + d_east_m / m_lng, lat + d_north_m / m_lat


# ---- Bounding box ------------------------------------------------------------

@dataclass
class BBox:
    """Axis-aligned bbox in degrees. min/max lng/lat."""
    min_lng: float
    min_lat: float
    max_lng: float
    max_lat: float

    @classmethod
    def from_polygon(cls, coords: List[dict]) -> "BBox":
        """Build a bbox from Firestore-shaped [{'lng':..,'lat':..}, ...]."""
        lngs = [c["lng"] for c in coords]
        lats = [c["lat"] for c in coords]
        return cls(min(lngs), min(lats), max(lngs), max(lats))

    def expanded(self, margin_m: float) -> "BBox":
        mid_lat = (self.min_lat + self.max_lat) / 2
        m_lng, m_lat = _meters_per_deg(mid_lat)
        dl = margin_m / m_lng
        db = margin_m / m_lat
        return BBox(
            self.min_lng - dl, self.min_lat - db,
            self.max_lng + dl, self.max_lat + db,
        )

    def dims_m(self) -> Tuple[float, float]:
        mid_lat = (self.min_lat + self.max_lat) / 2
        m_lng, m_lat = _meters_per_deg(mid_lat)
        width_m = (self.max_lng - self.min_lng) * m_lng
        height_m = (self.max_lat - self.min_lat) * m_lat
        return width_m, height_m


# ---- Waypoint model ----------------------------------------------------------

@dataclass
class Waypoint:
    lng: float
    lat: float
    altitude_m: float
    heading_deg: float
    gimbal_pitch_deg: float
    speed_ms: float
    capture: bool = True  # take a photo at this waypoint


@dataclass
class Mission:
    waypoints: List[Waypoint] = field(default_factory=list)
    config: SurveyConfig = field(default_factory=SurveyConfig)

    def truncated(self) -> "Mission":
        """Enforce Litchi's practical waypoint ceiling."""
        cap = self.config.max_waypoints
        if len(self.waypoints) <= cap:
            return self
        return Mission(self.waypoints[:cap], self.config)


# ---- Core: bbox -> lawnmower mission ----------------------------------------

def generate_mission(bbox: BBox, config: SurveyConfig | None = None) -> Mission:
    """
    Build a boustrophedon (lawnmower) survey over the bbox.

    Passes run North-South (heading 0) by default. Adjacent passes are spaced by
    the effective side spacing = footprint_width * (1 - side_overlap). Along each
    pass, capture waypoints are spaced by footprint_height * (1 - front_overlap).
    """
    cfg = config or SurveyConfig()
    box = bbox.expanded(cfg.margin_m)
    width_m, height_m = box.dims_m()

    pass_spacing_m = max(1.0, cfg.sensor_width_m_at_alt * (1 - cfg.side_overlap))
    capture_spacing_m = max(1.0, cfg.sensor_height_m_at_alt * (1 - cfg.front_overlap))

    n_passes = max(1, int(math.ceil(width_m / pass_spacing_m)) + 1)
    n_caps = max(2, int(math.ceil(height_m / capture_spacing_m)) + 1)

    origin_lng, origin_lat = box.min_lng, box.min_lat
    waypoints: List[Waypoint] = []

    for p in range(n_passes):
        east_m = min(p * pass_spacing_m, width_m)
        # serpentine: even passes go south->north, odd passes north->south
        rows = range(n_caps) if p % 2 == 0 else range(n_caps - 1, -1, -1)
        for r in rows:
            north_m = min(r * capture_spacing_m, height_m)
            lng, lat = _offset(origin_lng, origin_lat, east_m, north_m)
            waypoints.append(
                Waypoint(
                    lng=lng,
                    lat=lat,
                    altitude_m=cfg.altitude_m,
                    heading_deg=cfg.heading_deg,
                    gimbal_pitch_deg=cfg.gimbal_pitch_deg,
                    speed_ms=cfg.speed_ms,
                    capture=True,
                )
            )

    return Mission(waypoints, cfg).truncated()


# ---- Litchi CSV serializer ---------------------------------------------------

# Litchi's Mission Hub CSV has a wide fixed header. We populate the fields that
# matter for an automated nadir survey and leave the rest at safe defaults.
# Reference column order follows Litchi's documented CSV template.

_LITCHI_HEADER = [
    "latitude", "longitude", "altitude(m)",
    "heading(deg)", "curvesize(m)", "rotationdir",
    "gimbalmode", "gimbalpitchangle",
    "actiontype1", "actionparam1",
    "actiontype2", "actionparam2",
    "altitudemode", "speed(m/s)",
    "poi_latitude", "poi_longitude", "poi_altitude(m)", "poi_altitudemode",
    "photo_timeinterval", "photo_distinterval",
]

# Litchi action type codes: -1 = no action, 1 = take photo, 5 = tilt gimbal.
_ACTION_TAKE_PHOTO = 1
_ACTION_NONE = -1


def mission_to_litchi_csv(mission: Mission) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(_LITCHI_HEADER)
    for wp in mission.waypoints:
        w.writerow([
            f"{wp.lat:.8f}", f"{wp.lng:.8f}", f"{wp.altitude_m:.1f}",
            f"{wp.heading_deg:.1f}", "0.2", "0",
            "2",  # gimbalmode 2 = interpolate/hold
            f"{wp.gimbal_pitch_deg:.1f}",
            _ACTION_TAKE_PHOTO if wp.capture else _ACTION_NONE, "0",
            _ACTION_NONE, "0",
            "1",  # altitudemode 1 = AGL (above takeoff)
            f"{wp.speed_ms:.1f}",
            "0", "0", "0", "0",
            "0", "0",
        ])
    return buf.getvalue()


def generate_litchi_csv_from_polygon(
    polygon: List[dict], config: SurveyConfig | None = None
) -> Tuple[str, int]:
    """
    Convenience entrypoint mirroring the pipeline: Firestore polygon
    ([{'lng','lat'}, ...]) -> (csv_string, waypoint_count).
    """
    bbox = BBox.from_polygon(polygon)
    mission = generate_mission(bbox, config)
    return mission_to_litchi_csv(mission), len(mission.waypoints)


if __name__ == "__main__":
    # Smoke test on a small square field (~120m x 90m) near Bathinda, Punjab.
    demo_polygon = [
        {"lng": 74.9455, "lat": 30.2100},
        {"lng": 74.9468, "lat": 30.2100},
        {"lng": 74.9468, "lat": 30.2108},
        {"lng": 74.9455, "lat": 30.2108},
    ]
    csv_text, n = generate_litchi_csv_from_polygon(demo_polygon)
    print(f"Generated {n} waypoints")
    print("\n".join(csv_text.splitlines()[:6]))
