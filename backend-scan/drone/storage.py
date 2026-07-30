"""
storage.py

Drone frames go to Cloud Storage rather than through the Render API (per the
doc: large batches must not strain the request path). This module handles the
two directions the scan service needs:

  1. Listing/downloading a mission's frames into the Cloud Run container's
     local scratch for inference.
  2. Writing the waypoint CSV up to Storage for the operator to fetch.

Auth: uses Application Default Credentials, which on Cloud Run resolves to the
service account with Secret Manager-mounted creds (same pattern as the existing
scan service). No keys in code.
"""

from __future__ import annotations

import os
import tempfile
from typing import List, Tuple

from google.cloud import storage


def _client() -> storage.Client:
    return storage.Client()


def upload_csv(bucket: str, blob_path: str, csv_text: str) -> str:
    """Write a Litchi CSV to gs://bucket/blob_path. Returns the gs:// URI."""
    b = _client().bucket(bucket).blob(blob_path)
    b.upload_from_string(csv_text, content_type="text/csv")
    return f"gs://{bucket}/{blob_path}"


def list_mission_frames(bucket: str, prefix: str) -> List[str]:
    """
    List image blobs under a mission prefix, e.g.
    prefix='missions/<scan_id>/frames/'. Returns blob names.
    """
    exts = (".jpg", ".jpeg", ".png")
    return [
        blob.name
        for blob in _client().list_blobs(bucket, prefix=prefix)
        if blob.name.lower().endswith(exts)
    ]


def download_frames(bucket: str, blob_names: List[str]) -> Tuple[str, List[str]]:
    """
    Download frames into a temp dir. Returns (local_dir, local_paths).
    EXIF is preserved because we copy bytes verbatim.
    """
    local_dir = tempfile.mkdtemp(prefix="drone_frames_")
    bkt = _client().bucket(bucket)
    local_paths: List[str] = []
    for name in blob_names:
        dest = os.path.join(local_dir, os.path.basename(name))
        bkt.blob(name).download_to_filename(dest)
        local_paths.append(dest)
    return local_dir, local_paths
