"""
YC Agro — Flask backend
"""

import os
import io
from datetime import datetime, timedelta, timezone
from functools import wraps

import numpy as np
import requests
from PIL import Image
from flask import Flask, request, jsonify, g
from flask_cors import CORS

import firebase_admin
from firebase_admin import credentials, auth, firestore

import ee
from ultralytics import YOLO

# ── Firebase init ────────────────────────────────────────────
cred_path = os.environ.get("FIREBASE_CRED", "serviceAccountKey.json")
firebase_admin.initialize_app(credentials.Certificate(cred_path))
db = firestore.client()

app = Flask(__name__)
CORS(app, origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(","))

VALID_CROPS = {"paddy", "wheat", "cotton", "other"}

# ── Earth Engine init (service account, not interactive) ────
EE_CRED_PATH = os.environ.get("EE_CRED", "gee-service-account.json")
ee_credentials = ee.ServiceAccountCredentials(
    "yc-agro-ee-backend@yc-agro.iam.gserviceaccount.com", EE_CRED_PATH
)
ee.Initialize(ee_credentials)

YOLO_MODEL_PATH = os.environ.get("YOLO_MODEL_PATH", "ycagro_v3_best_91.pt")
yolo_model = YOLO(YOLO_MODEL_PATH)


# ── Auth decorator ───────────────────────────────────────────
def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify(error="Missing Authorization header"), 401
        try:
            decoded = auth.verify_id_token(header.split(" ", 1)[1])
        except Exception:
            return jsonify(error="Invalid or expired token"), 401
        g.uid = decoded["uid"]
        g.phone = decoded.get("phone_number")
        return fn(*args, **kwargs)
    return wrapper


# ── Routes ───────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return jsonify(status="ok")


@app.post("/api/farmers/register")
@require_auth
def register_farmer():
    data = request.get_json(silent=True) or {}

    name = (data.get("name") or "").strip()
    village = (data.get("village") or "").strip()
    crop = (data.get("crop") or "other").strip().lower()
    try:
        acreage = float(data.get("acreage", 0))
    except (TypeError, ValueError):
        acreage = 0

    errors = {}
    if not (2 <= len(name) <= 80):
        errors["name"] = "Name must be 2–80 characters"
    if not (2 <= len(village) <= 120):
        errors["village"] = "Village must be 2–120 characters"
    if not (0 < acreage <= 10000):
        errors["acreage"] = "Acreage must be between 0 and 10000"
    if crop not in VALID_CROPS:
        errors["crop"] = f"Crop must be one of {sorted(VALID_CROPS)}"
    if errors:
        return jsonify(errors=errors), 400

    doc_ref = db.collection("farmers").document(g.uid)
    if doc_ref.get().exists:
        return jsonify(error="Farmer already registered"), 409

    farmer = {
        "uid": g.uid,
        "phone": g.phone,
        "name": name,
        "village": village,
        "acreage": acreage,
        "crop": crop,
        "lang": data.get("lang", "en"),
        "field": None,
        "created_at": datetime.now(timezone.utc),
    }
    doc_ref.set(farmer)
    farmer["created_at"] = farmer["created_at"].isoformat()
    return jsonify(farmer=farmer), 201


@app.get("/api/farmers/me")
@require_auth
def get_me():
    snap = db.collection("farmers").document(g.uid).get()
    if not snap.exists:
        return jsonify(error="Not registered"), 404
    d = snap.to_dict()
    if d.get("field"):
        d["field"] = from_firestore_safe(d["field"])
    


@app.put("/api/farmers/me/field")
@require_auth
def save_field():
    """Save the farmer's field boundary as a GeoJSON Polygon."""
    data = request.get_json(silent=True) or {}
    poly = data.get("polygon")

    if (
        not isinstance(poly, dict)
        or poly.get("type") != "Polygon"
        or not isinstance(poly.get("coordinates"), list)
        or not poly["coordinates"]
        or len(poly["coordinates"][0]) < 4
    ):
        return jsonify(error="polygon must be a GeoJSON Polygon with ≥4 points"), 400

    doc_ref = db.collection("farmers").document(g.uid)
    if not doc_ref.get().exists:
        return jsonify(error="Not registered"), 404
    
    def to_firestore_safe(poly):
    #Firestore disallows nested arrays — convert each [lng,lat] pair to a map."""
        coords = poly["coordinates"][0]
        safe_coords = [{"lng": pt[0], "lat": pt[1]} for pt in coords]
        return {"type": poly["type"], "coordinates": safe_coords}


    def from_firestore_safe(stored):
    #Reverse of the above — back to standard GeoJSON for the frontend."""
        if not stored:
            return None
        coords = [[pt["lng"], pt["lat"]] for pt in stored["coordinates"]]
        return {"type": stored["type"], "coordinates": [coords]}
    
    doc_ref.update({"field": to_firestore_safe(poly), "field_updated_at": datetime.now(timezone.utc)})
    return jsonify(ok=True)


# ── Scan pipeline ─────────────────────────────────────────────
def band_to_numpy(image, band_name, region, scale=10):
    url = image.select(band_name).getDownloadURL(
        {"scale": scale, "region": region, "format": "NPY"}
    )
    r = requests.get(url)
    r.raise_for_status()
    return np.load(io.BytesIO(r.content))


def run_scan_pipeline(polygon_geojson):
    """polygon_geojson: {"type": "Polygon", "coordinates": [[[lng,lat], ...]]}"""
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

    total = ndvi.size
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
            tmp_path = "anomaly_crop.jpg"  # relative path — see Windows note below
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
        "stressedPct": round(stressed_pct, 1),
        "healthyPct": round(healthy_pct, 1),
        "detections": detections,
        "total_pixels": int(total),
    }


@app.post("/api/farmers/me/scan")
@require_auth
def trigger_scan():
    doc_ref = db.collection("farmers").document(g.uid)
    snap = doc_ref.get()
    if not snap.exists:
        return jsonify(error="Not registered"), 404
    farmer = snap.to_dict()
    field = farmer.get("field")
    if not field:
        return jsonify(error="Draw and save your field boundary first"), 400

    try:
        scan_result = run_scan_pipeline(field)
    except Exception as err:
        print("Scan pipeline failed:", err)
        return jsonify(error="Scan failed — try again in a moment"), 500

    doc_ref.update({
        "last_scan": scan_result,
        "last_scan_at": datetime.now(timezone.utc),
    })
    return jsonify(scan=scan_result)


@app.get("/api/farmers/me/scan")
@require_auth
def get_scan():
    snap = db.collection("farmers").document(g.uid).get()
    if not snap.exists:
        return jsonify(error="Not registered"), 404
    farmer = snap.to_dict()
    scan = farmer.get("last_scan")
    if not scan:
        return jsonify(scan=None)
    return jsonify(scan=scan)


if __name__ == "__main__":
    app.run(debug=True, port=5000)