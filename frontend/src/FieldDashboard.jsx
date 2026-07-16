import { useEffect, useRef, useState } from "react";

// ============================================================
// YC Agro — Field Dashboard
// Leaflet map centered on the Bathinda field. Farmer draws/edits
// the field boundary; on save it POSTs a GeoJSON Polygon to:
//   PUT /api/farmers/me/field   { polygon: {type:"Polygon", coordinates:[...]} }
//
// Leaflet + leaflet-draw are loaded from CDN at runtime (no npm
// build step needed for the artifact preview). In your real Vite
// app, prefer: npm i leaflet leaflet-draw  and import them.
//
// NDVI overlay: the pipeline writes a PNG (red→green health map)
// aligned to the field bbox. Drop its URL + bounds into `ndvi`
// and it renders as an image overlay. Mocked here with the
// baseline scan numbers (223×194 px, 1.7% stressed).
// ============================================================

const FIELD_CENTER = [30.3375, 74.9385]; // Bathinda test field
const DEFAULT_POLY = [
  [30.339, 74.938],
  [30.339, 74.939],
  [30.336, 74.939],
  [30.337, 74.938],
];

const T = {
  en: {
    title: "My Field",
    draw: "Draw field boundary",
    redraw: "Redraw boundary",
    save: "Save field",
    saving: "Saving…",
    saved: "Field saved",
    healthTitle: "Field health",
    lastScan: "Last scan",
    healthy: "Healthy",
    stressed: "Needs attention",
    noField: "Draw your field on the map to start monitoring.",
    legend: { healthy: "Healthy", moderate: "Some stress", stressed: "Stressed crop" },
    acres: "acres",
    scanNow: "Request scan",
  },
};



const C = {
  bg: "#10271a",
  card: "#f7f5ef",
  green: "#1e4d2b",
  gold: "#d9a441",
  rust: "#a63d2f",
  ink: "#2c3527",
  muted: "#5a6354",
};

// Accepts either standard GeoJSON ({coordinates:[[lng,lat],...]})
// or the Firestore-safe shape ({coordinates:[{lng,lat},...]}) and
// returns Leaflet-style [lat,lng] pairs, ring-closing point dropped.
function fieldToLatLngs(field) {
  if (!field || !field.coordinates) return null;
  let ring = field.coordinates[0] ?? field.coordinates; // handle [ [..] ] vs [..]
  if (!Array.isArray(ring) || ring.length < 3) return null;

  const points = ring.map((pt) =>
    Array.isArray(pt) ? [pt[1], pt[0]] : [pt.lat, pt.lng] // [lng,lat] vs {lng,lat}
  );
  // drop closing duplicate point if present
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1] && points.length > 3) {
    points.pop();
  }
  return points;
}

export default function FieldDashboard({ user }) {
  const t = T.en;
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const layerRef = useRef(null);
  const [hasField, setHasField] = useState(true);
  const [acres, setAcres] = useState(0);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved
  const [scan, setScan] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [savedField, setSavedField] = useState(null);
  const [fieldLoaded, setFieldLoaded] = useState(false);
  const healthy = scan ? scan.stressedPct < 5 : false;

  useEffect(() => {
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/farmers/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setSavedField(data.farmer?.field || null);
      } catch (err) {
        console.error("Failed to load saved field:", err);
      } finally {
        setFieldLoaded(true);
      }
    })();
  }, [user]);

  // Fetch latest scan
  useEffect(() => {
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/farmers/me/scan`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setScan(data.scan);
      } catch (err) {
        console.error("Failed to load scan:", err);
      }
    })();
  }, [user]);

  const triggerScan = async () => {
    setScanLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/farmers/me/scan`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Couldn't start scan");
      }

      pollForScan();
    } catch (err) {
      console.error(err);
      alert(err.message);
      setScanLoading(false);
    }
  };

  const pollForScan = async () => {
  const started = Date.now();
  const poll = async () => {
    // give up after 3 minutes
    if (Date.now() - started > 180000) {
      setScanLoading(false);
      alert("Scan is taking longer than expected — try refreshing in a moment.");
      return;
    }
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/farmers/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const status = data.farmer?.scan_status;
      if (status === "done") {
        setScan(data.farmer.last_scan);
        setScanLoading(false);
        return;
      }
      if (status === "error" || status === "no_field") {
        setScanLoading(false);
        alert("Scan failed — please try again.");
        return;
      }
      // still running — poll again in 5s
      setTimeout(poll, 5000);
    } catch (err) {
      console.error(err);
      setScanLoading(false);
    }
  };
  poll();
};

  // Load Leaflet + leaflet-draw from CDN, then init the map once we know the saved field
  useEffect(() => {
    let cancelled = false;
    function add(tag, attrs) {
      return new Promise((res) => {
        const el = document.createElement(tag);
        Object.assign(el, attrs);
        el.onload = res;
        document.head.appendChild(el);
      });
    }
    (async () => {
      if (!window.L) {
        await add("link", {
          rel: "stylesheet",
          href: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
        });
        await add("script", { src: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" });
        await add("link", {
          rel: "stylesheet",
          href: "https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css",
        });
        await add("script", {
          src: "https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js",
        });
      }
      if (cancelled || mapObj.current || !fieldLoaded) return;
      initMap();
    })();
    return () => {
      cancelled = true;
    };
  }, [fieldLoaded]);

  function shoelaceAcres(latlngs) {
    // Approx area via planar shoelace on lat/lng → m² → acres.
    // Good enough for field-size display at this scale.
    const R = 111320; // m per degree latitude
    const latMid = (latlngs.reduce((s, p) => s + p.lat, 0) / latlngs.length) * Math.PI / 180;
    const pts = latlngs.map((p) => [
      p.lng * R * Math.cos(latMid),
      p.lat * R,
    ]);
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a / 2) / 4046.86; // m² → acres
  }

  function recalc(layer) {
    const latlngs = layer.getLatLngs()[0];
    setAcres(shoelaceAcres(latlngs));
    setHasField(true);
    setSaveState("idle");
  }

  function initMap() {
    const L = window.L;
    const map = L.map(mapRef.current).setView(FIELD_CENTER, 16);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Esri" }
    ).addTo(map);

    const drawn = new L.FeatureGroup();
    map.addLayer(drawn);

    const initialLatLngs = fieldToLatLngs(savedField) || DEFAULT_POLY;

    // Seed with the known field polygon
    const poly = L.polygon(initialLatLngs, { color: C.gold, weight: 3, fillOpacity: 0.15 });
    drawn.addLayer(poly);
    layerRef.current = poly;
    recalc(poly);
    map.fitBounds(poly.getBounds(), { padding: [40, 40] });

    const drawControl = new L.Control.Draw({
      edit: { featureGroup: drawn },
      draw: {
        polygon: { shapeOptions: { color: C.gold, weight: 3 } },
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, (e) => {
      drawn.clearLayers();
      drawn.addLayer(e.layer);
      layerRef.current = e.layer;
      recalc(e.layer);
    });
    map.on(L.Draw.Event.EDITED, () => {
      if (layerRef.current) recalc(layerRef.current);
    });

    mapObj.current = map;
  }

  function layerToGeoJSON(layer) {
    const latlngs = layer.getLatLngs()[0]; // array of {lat, lng}
    const coords = latlngs.map((p) => [p.lng, p.lat]); // GeoJSON is [lng, lat]
    // close the ring — first point repeated as last
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coords.push(first);
    }
    return { type: "Polygon", coordinates: [coords] };
  }

  const saveField = async () => {
    if (!layerRef.current) return;
    setSaveState("saving");
    try {
      const polygon = layerToGeoJSON(layerRef.current);
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/farmers/me/field`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ polygon }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Save failed: ${res.status}`);
      }
      setSaveState("saved");
    } catch (err) {
      console.error(err);
      setSaveState("idle");
      alert("Couldn't save field — check the server is running.");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px" }}>
        <h1 style={{ color: C.card, margin: 0, fontSize: 22, fontWeight: 800 }}>
          🌾 YC Agro <span style={{ color: C.gold }}>· {t.title}</span>
        </h1>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 16, padding: "0 16px 24px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ borderRadius: 14, overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,0.4)" }}>
          <div ref={mapRef} style={{ width: "100%", height: 520, background: "#0c1a12" }} />
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Panel>
            <Row label={t.title} value={`${acres.toFixed(1)} ${t.acres}`} />
            <button
              style={{ ...primaryBtn, opacity: saveState === "saving" ? 0.7 : 1 }}
              disabled={saveState === "saving"}
              onClick={saveField}
            >
              {saveState === "saving" ? t.saving : saveState === "saved" ? `✓ ${t.saved}` : t.save}
            </button>
            <p style={{ fontSize: 12, color: C.muted, margin: "8px 0 0", lineHeight: 1.4 }}>
              {t.draw} → {t.save}
            </p>
          </Panel>

          <Panel>
            <h3 style={{ margin: "0 0 10px", color: C.green, fontSize: 16 }}>{t.healthTitle}</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{
                width: 14, height: 14, borderRadius: "50%",
                background: healthy ? "#2f6b35" : C.rust,
              }} />
              <b style={{ color: healthy ? "#2f6b35" : C.rust, fontSize: 17 }}>
                {healthy ? t.healthy : t.stressed}
              </b>
            </div>
            {scan ? (
              <>
                <Row label={t.lastScan} value={scan.date} />
                <Bar healthy={scan.healthyPct} stressed={scan.stressedPct} />
                <Legend t={t} />
                <Detections detections={scan.detections} />
              </>
            ) : (
              <p style={{ fontSize: 13, color: C.muted }}>No scan yet — request one below.</p>
            )}
            <button
              style={{ ...primaryBtn, background: C.green, color: C.card, marginTop: 14, opacity: scanLoading ? 0.7 : 1 }}
              disabled={scanLoading}
              onClick={triggerScan}
            >
              {scanLoading ? "Scanning…" : t.scanNow}
            </button>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Panel({ children }) {
  return (
    <div style={{ background: C.card, borderRadius: 14, padding: 18, boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}>
      {children}
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: C.ink, marginBottom: 8 }}>
      <span style={{ color: C.muted }}>{label}</span>
      <b>{value}</b>
    </div>
  );
}
function Bar({ healthy, stressed }) {
  const moderate = Math.max(0, 100 - healthy - stressed);
  return (
    <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", margin: "6px 0 10px" }}>
      <div style={{ width: `${healthy}%`, background: "#2f6b35" }} />
      <div style={{ width: `${moderate}%`, background: C.gold }} />
      <div style={{ width: `${stressed}%`, background: C.rust }} />
    </div>
  );
}
function Legend({ t }) {
  const items = [
    ["#2f6b35", t.legend.healthy],
    [C.gold, t.legend.moderate],
    [C.rust, t.legend.stressed],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {items.map(([c, label]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.ink }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: c }} />
          {label}
        </div>
      ))}
    </div>
  );
}

function Detections({ detections }) {
  if (!detections || detections.length === 0) return null;

  const SEVERITY = {
    "blast": C.rust,
    "sheath-blight": C.rust,
    "bacterial-blight": C.rust,
    "tungro": C.rust,
    "bacterial-leaf-streak": "#c97b3a",
    "brown-spot": "#c97b3a",
    "dead-heart": "#c97b3a",
    "downy-mildew": C.gold,
    "false-smut": C.gold,
    "normal": "#2f6b35",
  };

  const LABEL = {
    "bacterial-blight": "Bacterial Blight",
    "bacterial-leaf-streak": "Bacterial Leaf Streak",
    "blast": "Blast",
    "brown-spot": "Brown Spot",
    "dead-heart": "Dead Heart",
    "downy-mildew": "Downy Mildew",
    "false-smut": "False Smut",
    "normal": "Normal",
    "sheath-blight": "Sheath Blight",
    "tungro": "Tungro",
  };

  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 6px" }}>
        Detected Issues
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {detections.map((d, i) => (
          <div key={i} style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#f0ece2",
            borderRadius: 8,
            padding: "8px 10px",
            borderLeft: `4px solid ${SEVERITY[d.label] || C.gold}`,
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>
              {LABEL[d.label] || d.label}
            </span>
            <span style={{
              fontSize: 12,
              fontWeight: 700,
              color: SEVERITY[d.label] || C.gold,
            }}>
              {Math.round(d.confidence * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}


const primaryBtn = {
  width: "100%",
  padding: "12px 0",
  fontSize: 15,
  fontWeight: 800,
  borderRadius: 8,
  border: "none",
  background: C.gold,
  color: "#2a2410",
  cursor: "pointer",
  marginTop: 6,
};
