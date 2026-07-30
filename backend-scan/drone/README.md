# Drone layer (Stage 0) — YC Agro

Slots into the existing Cloud Run scan service (`backend-scan/main.py`). Same
container, same fire-and-forget + Firestore-write pattern as the satellite scan.

## Files
- `waypoint_generator.py` — NDVI anomaly bbox → Litchi CSV (lawnmower survey).
- `inference.py` — per-frame YOLOv8 + EXIF GPS → grid-aggregated disease map.
- `storage.py` — Cloud Storage upload/download for CSVs and frame batches.
- `drone_pipeline.py` — two Flask routes (`/drone/plan`, `/drone/process`).

## Wire-up in main.py
```python
from drone.drone_pipeline import init_drone_routes
# after `app` and Firestore `db` exist:
init_drone_routes(app, db)
```

## Env (Cloud Run, mounted from Secret Manager — never in git)
- `DRONE_BUCKET` — Cloud Storage bucket for missions + frames
- `YOLO_WEIGHTS` — path to the existing 148 MB YOLOv8 weights in the image

## Stage-0 flow (human in loop)
1. Satellite scan flags a stressed zone → call `POST /drone/plan` with the
   field polygon. Returns a `gs://` CSV URI, writes `drone_status=mission_ready`.
2. Operator downloads the CSV, loads it into Litchi, flies the mission.
3. Frames upload to `gs://<DRONE_BUCKET>/missions/<scan_id>/frames/`.
4. Call `POST /drone/process` → per-frame YOLO + EXIF GPS → disease map on the
   scan doc (`drone_disease_map`), `drone_status=complete`.
5. Frontend overlays `drone_disease_map.cells` on the field map.

## Requirements delta
Add to the scan service requirements (ultralytics/pillow already present):
```
google-cloud-storage
```

## Where this changes at Stage 1/2 (see roadmap)
Only `waypoint_generator` output and the `/drone/plan` handoff change: instead
of writing a CSV for a human, you POST a mission to the DJI Cloud API and the
dock launches. `inference.py`, `storage.py`, and the aggregation/Firestore write
are unchanged. That's the reuse argument — the ML/data half is stage-agnostic.

## Known Stage-0 limits
- Litchi caps at ~99 waypoints; large fields need bbox tiling into sub-missions.
- Footprint constants in `SurveyConfig` are altitude-approximate; calibrate
  against real Mini 4 Pro frames before trusting overlap for ODM stitching.
- Frames without EXIF GPS are skipped and counted (`frames_skipped_no_gps`),
  not silently dropped — check this after each mission.
