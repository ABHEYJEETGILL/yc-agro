"""
YC Agro — Flask backend (main API)
Scan pipeline runs separately in backend-scan/scan.py (heavy ML deps).
This service stays lightweight for Render's free tier.
"""
import google.auth.transport.requests
from google.oauth2 import service_account
import requests as http_requests

import os
from datetime import datetime, timezone
from functools import wraps

from flask import Flask, request, jsonify, g
from flask_cors import CORS

import firebase_admin
from firebase_admin import credentials, auth, firestore

# ── Firebase init ────────────────────────────────────────────
cred_path = os.environ.get("FIREBASE_CRED", "serviceAccountKey.json")
firebase_admin.initialize_app(credentials.Certificate(cred_path))
db = firestore.client()

app = Flask(__name__)
CORS(app, origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(","))

VALID_CROPS = {"paddy", "wheat", "cotton", "other"}


def to_firestore_safe(poly):
    """Firestore disallows nested arrays — convert each [lng,lat] pair to a map."""
    coords = poly["coordinates"][0]
    safe_coords = [{"lng": pt[0], "lat": pt[1]} for pt in coords]
    return {"type": poly["type"], "coordinates": safe_coords}


def from_firestore_safe(stored):
    """Reverse of the above — back to standard GeoJSON for the frontend."""
    if not stored:
        return None
    coords = [[pt["lng"], pt["lat"]] for pt in stored["coordinates"]]
    return {"type": stored["type"], "coordinates": [coords]}


# ── Cloud Run scan service ──────────────────────────────────
SCAN_SERVICE_URL = os.environ.get(
    "SCAN_SERVICE_URL", "https://yc-agro-scan-642921605017.us-central1.run.app"
)
INVOKER_CRED = os.environ.get("INVOKER_CRED", "render-invoker-key.json")


def get_scan_service_token():
    """Mint an OIDC token to authenticate against the private Cloud Run service."""
    creds = service_account.IDTokenCredentials.from_service_account_file(
        INVOKER_CRED, target_audience=SCAN_SERVICE_URL
    )
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token

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
    if d.get("created_at"):
        d["created_at"] = d["created_at"].isoformat()
    if d.get("field"):
        d["field"] = from_firestore_safe(d["field"])
    return jsonify(farmer=d)


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

    doc_ref.update({"field": to_firestore_safe(poly), "field_updated_at": datetime.now(timezone.utc)})
    return jsonify(ok=True)


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


@app.post("/api/farmers/me/scan")
@require_auth
def trigger_scan():
    """Kick off a scan on Cloud Run. Returns immediately (fire-and-forget)."""
    doc_ref = db.collection("farmers").document(g.uid)
    snap = doc_ref.get()
    if not snap.exists:
        return jsonify(error="Not registered"), 404
    if not snap.to_dict().get("field"):
        return jsonify(error="Draw and save your field boundary first"), 400

    # Mark running BEFORE dispatching. Cloud Run owns every status
    # write from here on — if we set it afterwards we can overwrite
    # the "done" it already wrote on a fast scan.
    doc_ref.update({"scan_status": "running"})

    try:
        token = get_scan_service_token()
        http_requests.post(
            f"{SCAN_SERVICE_URL}/scan",
            json={"uid": g.uid},
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        )
    except http_requests.exceptions.ReadTimeout:
        # expected on slower scans — Cloud Run is still working
        pass
    except Exception as err:
        print("Failed to trigger scan:", err)
        doc_ref.update({"scan_status": "error"})
        return jsonify(error="Couldn't start scan"), 500

    return jsonify(status="started"), 202


    
if __name__ == "__main__":
    app.run(debug=True, port=5000)