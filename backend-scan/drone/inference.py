"""
inference.py

Stage 0 drone-image inference. Runs the *existing* YOLOv8 weights (the ones the
tech-stack doc reports at 91.7% mAP50 on 43k leaf images) per drone frame, reads
each frame's GPS from EXIF, and aggregates detections into a spatial disease map
keyed by coordinate rather than a flat list.

This is the "correct input at last" step from the doc: same weights, real
leaf-scale RGB input instead of upscaled satellite crops.

Dependencies (already in the scan container's chain): ultralytics, pillow.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from typing import Iterable, List, Optional, Tuple

from PIL import Image
from PIL.ExifTags import GPSTAGS, TAGS


# ---- EXIF GPS extraction -----------------------------------------------------

def _to_degrees(value) -> float:
    """Convert EXIF rational DMS to decimal degrees."""
    d, m, s = value
    return float(d) + float(m) / 60.0 + float(s) / 3600.0


def extract_gps(image_path: str) -> Optional[Tuple[float, float]]:
    """
    Return (lng, lat) in decimal degrees from an image's EXIF GPS block,
    or None if absent. Sign-corrects for S/W hemispheres.
    """
    try:
        img = Image.open(image_path)
        exif = img._getexif()
    except Exception:
        return None
    if not exif:
        return None

    gps_raw = None
    for tag_id, val in exif.items():
        if TAGS.get(tag_id) == "GPSInfo":
            gps_raw = val
            break
    if not gps_raw:
        return None

    gps = {GPSTAGS.get(t, t): v for t, v in gps_raw.items()}
    if "GPSLatitude" not in gps or "GPSLongitude" not in gps:
        return None

    lat = _to_degrees(gps["GPSLatitude"])
    if gps.get("GPSLatitudeRef", "N") in ("S", "s"):
        lat = -lat
    lng = _to_degrees(gps["GPSLongitude"])
    if gps.get("GPSLongitudeRef", "E") in ("W", "w"):
        lng = -lng
    return lng, lat


# ---- Detection model ---------------------------------------------------------

@dataclass
class Detection:
    lng: float
    lat: float
    disease_class: str
    confidence: float
    source_image: str


@dataclass
class ClusterCell:
    """A grid cell aggregating detections at ~cell_m resolution."""
    lng: float                 # cell centroid
    lat: float
    disease_class: str         # dominant (most confident-weighted) class
    detection_count: int
    mean_confidence: float
    classes: dict              # class -> count within the cell


# ---- YOLO wrapper ------------------------------------------------------------

class RiceDiseaseModel:
    """Thin wrapper over the existing Ultralytics YOLOv8 weights."""

    def __init__(self, weights_path: str, conf_threshold: float = 0.35):
        # Imported lazily so the module can be unit-tested (EXIF, clustering)
        # without torch/ultralytics present.
        from ultralytics import YOLO

        self.model = YOLO(weights_path)
        self.conf_threshold = conf_threshold

    def infer_frame(self, image_path: str) -> List[Tuple[str, float]]:
        """
        Run inference on one frame. Returns a list of (class_name, confidence).
        A frame can yield multiple detections; we keep all above threshold.
        """
        results = self.model.predict(
            source=image_path, conf=self.conf_threshold, verbose=False
        )
        out: List[Tuple[str, float]] = []
        for r in results:
            names = r.names
            if r.boxes is None:
                continue
            for cls_id, conf in zip(
                r.boxes.cls.tolist(), r.boxes.conf.tolist()
            ):
                out.append((names[int(cls_id)], float(conf)))
        return out


# ---- Frame -> geolocated detections -----------------------------------------

def detections_for_frames(
    model: RiceDiseaseModel, image_paths: Iterable[str]
) -> Tuple[List[Detection], List[str]]:
    """
    Run the model on each frame, attach the frame's GPS, and return
    (detections, skipped_paths). Frames without EXIF GPS are skipped and
    reported rather than silently dropped, so a mis-configured drone surfaces.
    """
    detections: List[Detection] = []
    skipped: List[str] = []

    for path in image_paths:
        gps = extract_gps(path)
        if gps is None:
            skipped.append(path)
            continue
        lng, lat = gps
        for cls_name, conf in model.infer_frame(path):
            detections.append(
                Detection(
                    lng=lng, lat=lat,
                    disease_class=cls_name,
                    confidence=conf,
                    source_image=path,
                )
            )
    return detections, skipped


# ---- Spatial aggregation -----------------------------------------------------

def _meters_per_deg(lat_deg: float) -> Tuple[float, float]:
    lat = math.radians(lat_deg)
    m_lat = 111_132.92 - 559.82 * math.cos(2 * lat) + 1.175 * math.cos(4 * lat)
    m_lng = 111_412.84 * math.cos(lat) - 93.5 * math.cos(3 * lat)
    return m_lng, m_lat


def aggregate_to_grid(
    detections: List[Detection], cell_m: float = 3.0
) -> List[ClusterCell]:
    """
    Bin detections into a ~cell_m grid so overlapping frames covering the same
    plant collapse into one map cell. Dominant class per cell is chosen by
    confidence-weighted vote (a few high-confidence hits beat many marginal ones).
    """
    if not detections:
        return []

    ref_lat = detections[0].lat
    m_lng, m_lat = _meters_per_deg(ref_lat)
    cell_lng = cell_m / m_lng
    cell_lat = cell_m / m_lat

    buckets: dict = {}
    for d in detections:
        key = (round(d.lng / cell_lng), round(d.lat / cell_lat))
        buckets.setdefault(key, []).append(d)

    cells: List[ClusterCell] = []
    for (ix, iy), items in buckets.items():
        weighted: dict = {}
        counts: dict = {}
        for d in items:
            weighted[d.disease_class] = weighted.get(d.disease_class, 0.0) + d.confidence
            counts[d.disease_class] = counts.get(d.disease_class, 0) + 1
        dominant = max(weighted, key=weighted.get)
        cells.append(
            ClusterCell(
                lng=(ix + 0.5) * cell_lng,
                lat=(iy + 0.5) * cell_lat,
                disease_class=dominant,
                detection_count=len(items),
                mean_confidence=sum(d.confidence for d in items) / len(items),
                classes=counts,
            )
        )
    return cells


def build_disease_map(cells: List[ClusterCell]) -> dict:
    """
    Serialize to the Firestore-friendly shape: a list of {lng,lat} maps plus
    attributes, avoiding nested arrays (the documented Firestore constraint).
    """
    return {
        "type": "drone_disease_map",
        "cell_count": len(cells),
        "cells": [
            {
                "lng": c.lng,
                "lat": c.lat,
                "disease_class": c.disease_class,
                "detection_count": c.detection_count,
                "mean_confidence": round(c.mean_confidence, 4),
                "classes": c.classes,
            }
            for c in cells
        ],
    }


if __name__ == "__main__":
    # Offline test of clustering + serialization without torch, using synthetic
    # detections (three near-duplicate frames over one diseased plant + one apart).
    demo = [
        Detection(74.9460, 30.2104, "sheath_blight", 0.82, "a.jpg"),
        Detection(74.94601, 30.21041, "sheath_blight", 0.77, "b.jpg"),
        Detection(74.94600, 30.21039, "brown_spot", 0.41, "c.jpg"),
        Detection(74.9475, 30.2110, "blast", 0.90, "d.jpg"),
    ]
    cells = aggregate_to_grid(demo, cell_m=3.0)
    import json
    print(json.dumps(build_disease_map(cells), indent=2))
