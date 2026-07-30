"""
drone_pipeline.py

Two Flask endpoints, meant to be registered onto the existing scan service in
backend-scan/main.py (same Cloud Run container, same fire-and-forget +
Firestore-write pattern as the satellite /scan route).

  POST /drone/plan
      Input : { "scan_id": str, "polygon": [{"lng","lat"}, ...] }
      Effect: generate Litchi CSV from the field polygon's NDVI-anomaly bbox,
              upload to Cloud Storage, write the CSV URI + status onto the
              farmer's scan doc. Returns 200 with the gs:// URI.
      This is the Stage-0 human-in-loop handoff: operator downloads the CSV.

  POST /drone/process
      Input : { "scan_id": str }
      Effect: fire-and-forget. Lists the mission's uploaded frames, runs
              per-frame YOLO, extracts EXIF GPS, aggregates to a grid disease
              map, writes it to Firestore. Returns 202 immediately.

Config via env (mounted from Secret Manager / Cloud Run env, never in git):
  DRONE_BUCKET     - Cloud Storage bucket for missions + frames
  YOLO_WEIGHTS     - path to the existing 148 MB YOLOv8 weights in the image
"""

from __future__ import annotations

import os
import threading

from flask import Blueprint, jsonify, request

from waypoint_generator import generate_litchi_csv_from_polygon
from inference import (
    RiceDiseaseModel,
    detections_for_frames,
    aggregate_to_grid,
    build_disease_map,
)
from storage import (
    upload_csv,
    list_mission_frames,
    download_frames,
)

# Firestore Admin SDK handle is created in the parent main.py; we accept it via
# init_drone_routes so this module doesn't re-initialize the app.
drone_bp = Blueprint("drone", __name__)

_DB = None            # firestore client, injected
_MODEL = None         # lazy-loaded RiceDiseaseModel


def _bucket() -> str:
    b = os.environ.get("DRONE_BUCKET")
    if not b:
        raise RuntimeError("DRONE_BUCKET not configured")
    return b


def _model() -> RiceDiseaseModel:
    global _MODEL
    if _MODEL is None:
        weights = os.environ.get("YOLO_WEIGHTS", "weights/rice_yolov8.pt")
        _MODEL = RiceDiseaseModel(weights)
    return _MODEL


def init_drone_routes(app, firestore_db):
    """Call from main.py: init_drone_routes(app, db)."""
    global _DB
    _DB = firestore_db
    app.register_blueprint(drone_bp)


# ---- /drone/plan -------------------------------------------------------------

@drone_bp.route("/drone/plan", methods=["POST"])
def plan():
    body = request.get_json(silent=True) or {}
    scan_id = body.get("scan_id")
    polygon = body.get("polygon")
    if not scan_id or not polygon:
        return jsonify({"error": "scan_id and polygon required"}), 400

    csv_text, n_waypoints = generate_litchi_csv_from_polygon(polygon)
    blob_path = f"missions/{scan_id}/mission.csv"
    uri = upload_csv(_bucket(), blob_path, csv_text)

    _DB.collection("scans").document(scan_id).set(
        {
            "drone_status": "mission_ready",
            "mission_csv_uri": uri,
            "waypoint_count": n_waypoints,
        },
        merge=True,
    )
    return jsonify({"mission_csv_uri": uri, "waypoint_count": n_waypoints}), 200


# ---- /drone/process ----------------------------------------------------------

def _run_processing(scan_id: str):
    """Background worker: frames -> disease map -> Firestore."""
    try:
        prefix = f"missions/{scan_id}/frames/"
        frame_blobs = list_mission_frames(_bucket(), prefix)
        if not frame_blobs:
            _DB.collection("scans").document(scan_id).set(
                {"drone_status": "no_frames"}, merge=True
            )
            return

        _, local_paths = download_frames(_bucket(), frame_blobs)
        detections, skipped = detections_for_frames(_model(), local_paths)
        cells = aggregate_to_grid(detections)
        disease_map = build_disease_map(cells)

        _DB.collection("scans").document(scan_id).set(
            {
                "drone_status": "complete",
                "drone_disease_map": disease_map,
                "frames_processed": len(local_paths),
                "frames_skipped_no_gps": len(skipped),
            },
            merge=True,
        )
    except Exception as e:  # surface failure onto the doc; don't crash the worker
        _DB.collection("scans").document(scan_id).set(
            {"drone_status": "error", "drone_error": str(e)}, merge=True
        )


@drone_bp.route("/drone/process", methods=["POST"])
def process():
    body = request.get_json(silent=True) or {}
    scan_id = body.get("scan_id")
    if not scan_id:
        return jsonify({"error": "scan_id required"}), 400

    _DB.collection("scans").document(scan_id).set(
        {"drone_status": "processing"}, merge=True
    )
    # Fire-and-forget, matching the satellite scan route's pattern.
    threading.Thread(target=_run_processing, args=(scan_id,), daemon=True).start()
    return jsonify({"status": "accepted", "scan_id": scan_id}), 202
