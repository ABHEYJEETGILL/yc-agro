"""
YC Agro — Flask backend
=======================
Endpoints:
  POST /api/farmers/register   create farmer profile after phone auth
  GET  /api/farmers/me         fetch own profile
  PUT  /api/farmers/me/field   save field polygon (GeoJSON)
  GET  /api/health             liveness check

Auth model:
  Frontend signs in with Firebase Phone Auth and sends the ID token
  in the Authorization header:  Authorization: Bearer <idToken>
  The backend verifies it with firebase_admin — never trust the phone
  number from the request body.

Setup:
  pip install flask flask-cors firebase-admin
  Download a service-account key from Firebase Console →
  Project Settings → Service Accounts, save as serviceAccountKey.json
  (NEVER commit this file — add it to .gitignore).
"""

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
        g.phone = decoded.get("phone_number")  # e.g. "+919876543210"
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
        "phone": g.phone,           # from verified token, not request body
        "name": name,
        "village": village,
        "acreage": acreage,
        "crop": crop,
        "lang": data.get("lang", "pa"),
        "field": None,              # GeoJSON polygon, set later on the map screen
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
    return jsonify(farmer=d)


@app.put("/api/farmers/me/field")
@require_auth
def save_field():
    """Save the farmer's field boundary as a GeoJSON Polygon."""
    data = request.get_json(silent=True) or {}
    poly = data.get("polygon")

    # Minimal GeoJSON Polygon validation
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

    doc_ref.update({"field": poly, "field_updated_at": datetime.now(timezone.utc)})
    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
