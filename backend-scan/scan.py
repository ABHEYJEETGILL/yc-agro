"""
Vangill — Local scan runner
Run this manually to trigger a scan for a specific farmer:
  python scan.py <farmer_uid>
"""
import sys
import os
import io
import traceback
import numpy as np
import requests
import ee
from PIL import Image
from ultralytics import YOLO
from datetime import datetime, timedelta, timezone

import firebase_admin
from firebase_admin import credentials, firestore

# ── Init ────────────────────────────────────────────────────
firebase_admin.initialize_app(credentials.Certificate("../backend/serviceAccountKey.json"))
db = firestore.client()

ee_credentials = ee.ServiceAccountCredentials(
    "yc-agro-ee-backend@yc-agro.iam.gserviceaccount.com",
    "../backend/gee-service-account.json"
)
ee.Initialize(ee_credentials)

YOLO_MODEL_PATH = os.environ.get("YOLO_MODEL_PATH", "../backend/ycagro_v3_best_91.pt")
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

    scene_date = s2.date().format("YYYY-MM-dd").getInfo()
    cloud_pct = s2.get("CLOUDY_PIXEL_PERCENTAGE").getInfo()
    print(f"[scan] scene={scene_date}, cloud%={cloud_pct}")

    red_raw = band_to_numpy(s2, "B4", region)
    nir_raw = band_to_numpy(s2, "B8", region)
    red = red_raw[red_raw.dtype.names[0]].astype(float)
    nir = nir_raw[nir_raw.dtype.names[0]].astype(float)
    ndvi = (nir - red) / (nir + red + 1e-8)

    print(f"[scan] ndvi min={ndvi.min():.3f} max={ndvi.max():.3f} mean={ndvi.mean():.3f} px={ndvi.size}")

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

        def norm(a):
            return ((a - a.min()) / (a.max() - a.min() + 1e-8) * 255).astype(np.uint8)

        if crop_red.size and crop_nir.size:
            img_arr = np.stack([norm(crop_red), norm(crop_nir), norm(crop_nir)], axis=-1)
            img = Image.fromarray(img_arr).resize((640, 640))
            tmp_path = "anomaly_crop.jpg"
            img.save(tmp_path)
            results = yolo_model(tmp_path, conf=0.4)
            boxes = results[0].boxes
            if boxes is not None and len(boxes):
                for box in boxes:
                    detections.append({
                        "label": yolo_model.names[int(box.cls[0])],
                        "confidence": float(box.conf[0]),
                    })

    return {
        "date": datetime.now(timezone.utc).date().isoformat(),
        "scene_date": scene_date,
        "stressedPct": round(stressed_pct, 1),
        "healthyPct": round(healthy_pct, 1),
        "detections": detections,
        "total_pixels": int(ndvi.size),
    }

# ── Main ─────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scan.py <farmer_uid>")
        sys.exit(1)

    uid = sys.argv[1]
    print(f"Running scan for farmer: {uid}")

    doc_ref = db.collection("farmers").document(uid)
    snap = doc_ref.get()
    if not snap.exists:
        print("Farmer not found.")
        sys.exit(1)

    farmer = snap.to_dict()
    stored_field = farmer.get("field")
    if not stored_field:
        print("No field saved for this farmer.")
        sys.exit(1)

    field = from_firestore_safe(stored_field)

    try:
        result = run_scan_pipeline(field)
        doc_ref.update({
            "last_scan": result,
            "last_scan_at": datetime.now(timezone.utc),
        })
        print(f"Scan saved: {result}")
    except Exception:
        traceback.print_exc()