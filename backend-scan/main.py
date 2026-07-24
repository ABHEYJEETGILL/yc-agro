"""
YC Agro — Scan service (Cloud Run)
HTTP service that runs the NDVI + YOLO pipeline for a farmer's field.
Endpoints:
  POST /scan       { "uid": "<farmer_uid>" }   → scan one farmer
  POST /scan-all   {}                           → scan all farmers with a field
  GET  /health                                  → liveness
Auth to Firebase + Earth Engine uses the container's mounted service accounts.
"""
import os
import io
import traceback
from datetime import datetime, timedelta, timezone

import numpy as np
import requests
import ee
from PIL import Image
from ultralytics import YOLO
from flask import Flask, request, jsonify

import firebase_admin
from firebase_admin import credentials, firestore

app = Flask(__name__)

# ── Init ────────────────────────────────────────────────────
FIREBASE_CRED = os.environ.get("FIREBASE_CRED", "/secrets/firebase/serviceAccountKey.json")
EE_CRED = os.environ.get("EE_CRED", "/secrets/gee/gee-service-account.json")
EE_SERVICE_ACCOUNT = "yc-agro-ee-backend@yc-agro.iam.gserviceaccount.com"
YOLO_MODEL_PATH = os.environ.get("YOLO_MODEL_PATH", "ycagro_v3_best_91.pt")

firebase_admin.initialize_app(credentials.Certificate(FIREBASE_CRED))
db = firestore.client()

ee_credentials = ee.ServiceAccountCredentials(EE_SERVICE_ACCOUNT, EE_CRED)
ee.Initialize(ee_credentials)

yolo_model = YOLO(YOLO_MODEL_PATH)


# ── Helpers ─────────────────────────────────────────────────
def from_firestore_safe(stored):
    if not stored:
        return None
    coords = [[pt["lng"], pt["lat"]] for pt in stored["coordinates"]]
    return {"type": stored["type"], "coordinates": [coords]}


def band_to_numpy(image, band_name, region, scale=10):
    url = image.select(band_name).getDownloadURL(
        {"scale": scale, "region": region, "format": "NPY"}
    )
    r = requests.get(url)
    r.raise_for_status()
    return np.load(io.BytesIO(r.content))


def run_scan_pipeline(polygon_geojson):
    region = ee.Geometry.Polygon(polygon_geojson["coordinates"])

    s2 = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(region)
        .filterDate(
            (datetime.now(timezone.utc) - timedelta(days=60)).strftime("%Y-%m-%d"),
            datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        )
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 10))
        .sort("CLOUDY_PIXEL_PERCENTAGE")
        .first()
    )

    red_raw = band_to_numpy(s2, "B4", region)
    nir_raw = band_to_numpy(s2, "B8", region)
    red = red_raw[red_raw.dtype.names[0]].astype(float)
    nir = nir_raw[nir_raw.dtype.names[0]].astype(float)
    ndvi = (nir - red) / (nir + red + 1e-8)

    stressed_pct = float(100 * (ndvi < 0.3).mean())
    healthy_pct = float(100 * (ndvi >= 0.5).mean())

    detections = []
    anomaly_mask = ndvi < 0.3
    rows = np.any(anomaly_mask, axis=1)
    cols = np.any(anomaly_mask, axis=0)
    if rows.any() and cols.any():
        rmin, rmax = np.where(rows)[0][[0, -1]]
        cmin, cmax = np.where(cols)[0][[0, -1]]
        crop_red = red[rmin:rmax, cmin:cmax]
        crop_nir = nir[rmin:rmax, cmin:cmax]

        # Satellite crops are far below the resolution this model was
        # trained on (leaf-scale imagery). Only attempt classification
        # when the anomaly region is large enough to carry real signal.
        MIN_CROP_PIXELS = 2000
        if crop_red.size >= MIN_CROP_PIXELS and crop_nir.size >= MIN_CROP_PIXELS:
            def norm(a):
                return ((a - a.min()) / (a.max() - a.min() + 1e-8) * 255).astype(np.uint8)

            img_arr = np.stack([norm(crop_red), norm(crop_nir), norm(crop_nir)], axis=-1)
            img = Image.fromarray(img_arr).resize((640, 640))
            tmp_path = "/tmp/anomaly_crop.jpg"
            img.save(tmp_path)
            results = yolo_model(tmp_path, conf=0.75)   # was 0.4
            boxes = results[0].boxes
            if boxes is not None and len(boxes):
                for box in boxes:
                    detections.append({
                        "label": yolo_model.names[int(box.cls[0])],
                        "confidence": float(box.conf[0]),
                    })

    return {
        "date": datetime.now(timezone.utc).date().isoformat(),
        "stressedPct": round(stressed_pct, 1),
        "healthyPct": round(healthy_pct, 1),
        "detections": detections,
        "total_pixels": int(ndvi.size),
    }


def scan_farmer(uid):
    """Run a scan for one farmer and write the result to Firestore."""
    doc_ref = db.collection("farmers").document(uid)
    snap = doc_ref.get()
    if not snap.exists:
        return {"uid": uid, "status": "not_found"}

    farmer = snap.to_dict()
    stored_field = farmer.get("field")
    if not stored_field:
        doc_ref.update({"scan_status": "no_field"})
        return {"uid": uid, "status": "no_field"}

    # mark in-progress so the frontend can show a spinner
    doc_ref.update({"scan_status": "running"})

    field = from_firestore_safe(stored_field)
    try:
        result = run_scan_pipeline(field)
        doc_ref.update({
            "last_scan": result,
            "last_scan_at": datetime.now(timezone.utc),
            "scan_status": "done",
        })
        return {"uid": uid, "status": "done", "scan": result}
    except Exception:
        traceback.print_exc()
        doc_ref.update({"scan_status": "error"})
        return {"uid": uid, "status": "error"}


# ── Routes ──────────────────────────────────────────────────
@app.get("/health")
def health():
    return jsonify(status="ok")


@app.post("/scan")
def scan_one():
    data = request.get_json(silent=True) or {}
    uid = data.get("uid")
    if not uid:
        return jsonify(error="uid required"), 400
    result = scan_farmer(uid)
    return jsonify(result)


@app.post("/scan-all")
def scan_all():
    """Scheduled endpoint — scan every farmer with a saved field."""
    results = []
    for snap in db.collection("farmers").stream():
        farmer = snap.to_dict()
        if farmer.get("field"):
            results.append(scan_farmer(snap.id))
    return jsonify(scanned=len(results), results=results)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)