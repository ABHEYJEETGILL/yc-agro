import { useEffect, useRef, useState, useCallback } from "react";

// ============================================================
// Vangill — Field Dashboard
//
// Map-first layout: the field is the object, panels annotate it.
// Chrome is neutral (theme.css tokens); the only saturated color
// in the UI is the data layer — NDVI bar, detection severity.
//
// Requires ./theme.css imported once in main.jsx.
//
// Backend contract (unchanged):
//   GET  /api/farmers/me            -> { farmer: { field, scan_status, last_scan } }
//   GET  /api/farmers/me/scan       -> { scan }
//   POST /api/farmers/me/scan       -> starts scan; poll /me for status
//   PUT  /api/farmers/me/field      -> { polygon: GeoJSON Polygon }
//
// scan may include `scene_date` (ISO date the imagery was captured,
// distinct from `date`, when the scan ran). If absent, provenance UI
// degrades gracefully — safe to ship before the pipeline change lands.
// ============================================================

const ACRES_PER_HECTARE = 2.47105;
const STALE_AFTER_DAYS = 14;

const CROP_OPTIONS = ["Rice", "Corn", "Soybeans", "Wheat", "Cotton", "Other"];

const DISEASE_LABELS = {
  "bacterial-blight": "Bacterial blight",
  "bacterial-leaf-streak": "Bacterial leaf streak",
  blast: "Blast",
  "brown-spot": "Brown spot",
  "dead-heart": "Dead heart",
  "downy-mildew": "Downy mildew",
  "false-smut": "False smut",
  normal: "Normal",
  "sheath-blight": "Sheath blight",
  tungro: "Tungro",
};

const DISEASE_SEVERITY = {
  blast: "high",
  "sheath-blight": "high",
  "bacterial-blight": "high",
  tungro: "high",
  "bacterial-leaf-streak": "med",
  "brown-spot": "med",
  "dead-heart": "med",
  "downy-mildew": "low",
  "false-smut": "low",
  normal: "low",
};

function fieldToLatLngs(field) {
  if (!field || !field.coordinates) return null;
  const ring = field.coordinates[0] ?? field.coordinates;
  if (!Array.isArray(ring) || ring.length < 3) return null;

  const points = ring.map((pt) =>
    Array.isArray(pt) ? [pt[1], pt[0]] : [pt.lat, pt.lng]
  );
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1] && points.length > 3) {
    points.pop();
  }
  return points;
}

function daysSince(isoDate) {
  if (!isoDate) return null;
  const then = new Date(isoDate);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}

function formatDate(isoDate) {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function FieldDashboard({ user }) {
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const layerRef = useRef(null);
  const drawnRef = useRef(null);
  const overlayRef = useRef(null);

  const [hasField, setHasField] = useState(false);
  const [area, setArea] = useState(0); // always stored in acres
  const [units, setUnits] = useState(
    () => localStorage.getItem("ycagro:units") || "acres"
  );
  const [theme, setTheme] = useState(
    () => localStorage.getItem("ycagro:theme") || "system"
  );
  const [saveState, setSaveState] = useState("idle");
  const [scan, setScan] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [savedField, setSavedField] = useState(null);
  const [fieldLoaded, setFieldLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [showOverlay, setShowOverlay] = useState(true);

  // ---------- theme ----------
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    localStorage.setItem("ycagro:theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("ycagro:units", units);
  }, [units]);

  const displayArea = units === "acres" ? area : area / ACRES_PER_HECTARE;
  const unitLabel = units === "acres" ? "acres" : "ha";

  // ---------- data ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/farmers/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!cancelled) setSavedField(data.farmer?.field || null);
      } catch (err) {
        console.error("Failed to load saved field:", err);
        if (!cancelled) setError("Couldn't load your field. Check your connection and reload.");
      } finally {
        if (!cancelled) setFieldLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/farmers/me/scan`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!cancelled) setScan(data.scan);
      } catch (err) {
        console.error("Failed to load scan:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const pollForScan = useCallback(() => {
    const started = Date.now();
    const poll = async () => {
      if (Date.now() - started > 300000) {
        setScanLoading(false);
        setError("The scan is taking longer than usual. Reload in a few minutes to check.");
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
        if (status === "error") {
          setScanLoading(false);
          setError("The scan didn't finish. Try running it again.");
          return;
        }
        if (status === "no_field") {
          setScanLoading(false);
          setError("Save your field boundary before running a scan.");
          return;
        }
        setTimeout(poll, 5000);
      } catch (err) {
        console.error(err);
        setScanLoading(false);
        setError("Lost connection while scanning. Reload to check the result.");
      }
    };
    poll();
  }, [user]);

  const triggerScan = async () => {
    setError(null);
    setScanLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/farmers/me/scan`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Couldn't start the scan.");
      }
      pollForScan();
    } catch (err) {
      console.error(err);
      setError(err.message);
      setScanLoading(false);
    }
  };

  // ---------- map ----------
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
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldLoaded]);

  function shoelaceAcres(latlngs) {
    const R = 111320;
    const latMid =
      ((latlngs.reduce((s, p) => s + p.lat, 0) / latlngs.length) * Math.PI) / 180;
    const pts = latlngs.map((p) => [p.lng * R * Math.cos(latMid), p.lat * R]);
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a / 2) / 4046.86;
  }

  function recalc(layer) {
    const latlngs = layer.getLatLngs()[0];
    setArea(shoelaceAcres(latlngs));
    setHasField(true);
    setSaveState("idle");
  }

  function accentColor() {
    return getComputedStyle(document.documentElement)
      .getPropertyValue("--ndvi-moderate")
      .trim() || "#d9a441";
  }

  function initMap() {
    const L = window.L;
    // No hardcoded default: start at a wide view and let the saved
    // field, or the user's location, decide where we land.
    const map = L.map(mapRef.current, { zoomControl: true }).setView([39.5, -98.35], 4);

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Esri" }
    ).addTo(map);

    const drawn = new L.FeatureGroup();
    map.addLayer(drawn);
    drawnRef.current = drawn;

    const stroke = accentColor();
    const initialLatLngs = fieldToLatLngs(savedField);

    if (initialLatLngs) {
      const poly = L.polygon(initialLatLngs, {
        color: stroke,
        weight: 2,
        fillOpacity: 0.12,
      });
      drawn.addLayer(poly);
      layerRef.current = poly;
      recalc(poly);
      map.fitBounds(poly.getBounds(), { padding: [40, 40] });
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 15),
        () => {},
        { timeout: 5000 }
      );
    }

    const drawControl = new L.Control.Draw({
      edit: { featureGroup: drawn },
      draw: {
        polygon: { shapeOptions: { color: stroke, weight: 2 } },
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
    map.on(L.Draw.Event.DELETED, () => {
      layerRef.current = null;
      setHasField(false);
      setArea(0);
    });

    mapObj.current = map;
  }

  // Restyle the polygon when the theme flips so it stays legible.
  useEffect(() => {
    if (layerRef.current?.setStyle) {
      layerRef.current.setStyle({ color: accentColor() });
    }
  }, [theme]);

  
  // Paint the NDVI zone overlay on the map whenever a new scan lands.
  // Removes the previous one first so scans don't stack.
  useEffect(() => {
    const map = mapObj.current;
    if (!map || !window.L) return;

    if (overlayRef.current) {
      map.removeLayer(overlayRef.current);
      overlayRef.current = null;
    }

    if (!showOverlay || !scan?.overlay_png || !scan?.overlay_bounds) return;

    overlayRef.current = window.L.imageOverlay(
      `data:image/png;base64,${scan.overlay_png}`,
      scan.overlay_bounds,
      { opacity: 0.75, interactive: false }
    ).addTo(map);

    return () => {
      if (overlayRef.current && mapObj.current) {
        mapObj.current.removeLayer(overlayRef.current);
        overlayRef.current = null;
      }
    };
  }, [scan, showOverlay]);

  function layerToGeoJSON(layer) {
    const latlngs = layer.getLatLngs()[0];
    const coords = latlngs.map((p) => [p.lng, p.lat]);
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
    return { type: "Polygon", coordinates: [coords] };
  }

  const saveField = async () => {
    if (!layerRef.current) return;
    setError(null);
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
        throw new Error(err.error || `Save failed (${res.status})`);
      }
      setSaveState("saved");
    } catch (err) {
      console.error(err);
      setSaveState("idle");
      setError("Couldn't save your field boundary. Try again.");
    }
  };

  // ---------- provenance ----------
  const sceneAge = daysSince(scan?.scene_date);
  const isStale = sceneAge !== null && sceneAge > STALE_AFTER_DAYS;
  const stressed = scan?.stressedPct ?? 0;
  const healthy = scan ? stressed < 5 : false;

  return (
    <div style={S.page}>
      <header style={S.header}>
        <div style={S.brand}>
          <span style={S.brandMark}>Vangill</span>
          <span style={S.brandDivider} />
          <span style={S.brandContext}>Field monitoring</span>
        </div>
        <div style={S.headerControls}>
          <SegmentedControl
            value={units}
            onChange={setUnits}
            options={[
              { value: "acres", label: "ac" },
              { value: "hectares", label: "ha" },
            ]}
            ariaLabel="Area units"
          />
          <SegmentedControl
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: "Light" },
              { value: "system", label: "Auto" },
              { value: "dark", label: "Dark" },
            ]}
            ariaLabel="Color theme"
          />
        </div>
      </header>

      {error && (
        <div style={S.errorBar} role="alert">
          <span>{error}</span>
          <button style={S.errorDismiss} onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <main style={S.layout}>
        <section style={S.mapWrap}>
          <div ref={mapRef} style={S.map} />
          {fieldLoaded && !hasField && (
            <div style={S.mapEmpty}>
              <p style={S.mapEmptyTitle}>Draw your field boundary</p>
              <p style={S.mapEmptyBody}>
                Use the polygon tool on the left of the map to trace your field,
                then save it. Monitoring starts from your first scan.
              </p>
            </div>
          )}
        </section>

        <aside style={S.sidebar}>
          <Card>
            <div style={S.areaRow}>
              <div>
                <div style={S.label}>Field area</div>
                <div style={S.areaValue}>
                  {displayArea.toFixed(1)}
                  <span style={S.areaUnit}>{unitLabel}</span>
                </div>
              </div>
            </div>
            <button
              style={{
                ...S.btnPrimary,
                opacity: saveState === "saving" || !hasField ? 0.55 : 1,
                cursor: saveState === "saving" || !hasField ? "not-allowed" : "pointer",
              }}
              disabled={saveState === "saving" || !hasField}
              onClick={saveField}
            >
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                ? "Boundary saved"
                : "Save boundary"}
            </button>
          </Card>

          <Card>
            <div style={S.cardHead}>
              <h2 style={S.cardTitle}>Field health</h2>
              {scan && (
                <span
                  style={{
                    ...S.statusPill,
                    color: healthy ? "var(--ndvi-healthy)" : "var(--ndvi-stressed)",
                    borderColor: healthy ? "var(--ndvi-healthy)" : "var(--ndvi-stressed)",
                  }}
                >
                  {healthy ? "Healthy" : "Needs attention"}
                </span>
              )}
            </div>

            {isStale && (
              <div style={S.staleBanner}>
                <div style={S.staleTitle}>Imagery is {sceneAge} days old</div>
                <div style={S.staleBody}>
                  Captured {formatDate(scan.scene_date)}. Recent satellite passes were
                  too cloudy to use, so these readings describe the field as it was on
                  that date.
                </div>
              </div>
            )}

            {scan ? (
              <>
                <StressBar healthyPct={scan.healthyPct} stressedPct={stressed} />
                <Legend />

                <dl style={S.metaList}>
                  <MetaRow label="Imagery captured" value={formatDate(scan.scene_date)} mono />
                  <MetaRow label="Scan run" value={formatDate(scan.date)} mono />
                  {scan.ndvi_mean != null && (
                    <MetaRow label="NDVI mean" value={scan.ndvi_mean.toFixed(3)} mono />
                  )}
                  {scan.cloud_pct != null && (
                    <MetaRow label="Cloud cover" value={`${scan.cloud_pct.toFixed(1)}%`} mono />
                  )}
                </dl>

                <Detections detections={scan.detections} />
              </>
            ) : (
              <p style={S.emptyBody}>
                No scans yet. Save your boundary, then run the first scan.
              </p>
            )}

            <button
              style={{
                ...S.btnSecondary,
                opacity: scanLoading ? 0.55 : 1,
                cursor: scanLoading ? "not-allowed" : "pointer",
              }}
              disabled={scanLoading}
              onClick={triggerScan}
            >
              {scanLoading ? "Scanning…" : "Run scan"}
            </button>
          </Card>
        </aside>
      </main>
    </div>
  );
}

/* ---------------- components ---------------- */

function Card({ children }) {
  return <div style={S.card}>{children}</div>;
}

function SegmentedControl({ value, onChange, options, ariaLabel }) {
  return (
    <div style={S.segment} role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            style={{
              ...S.segmentBtn,
              background: active ? "var(--surface-2)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-muted)",
              boxShadow: active ? "var(--shadow-card)" : "none",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function MetaRow({ label, value, mono }) {
  return (
    <div style={S.metaRow}>
      <dt style={S.metaLabel}>{label}</dt>
      <dd style={{ ...S.metaValue, fontFamily: mono ? "var(--font-mono)" : "inherit" }}>
        {value}
      </dd>
    </div>
  );
}

function StressBar({ healthyPct = 0, stressedPct = 0 }) {
  const moderate = Math.max(0, 100 - healthyPct - stressedPct);
  return (
    <div>
      <div style={S.bar} role="img"
        aria-label={`${Math.round(healthyPct)}% healthy, ${Math.round(moderate)}% some stress, ${Math.round(stressedPct)}% stressed`}>
        <div style={{ width: `${healthyPct}%`, background: "var(--ndvi-healthy)" }} />
        <div style={{ width: `${moderate}%`, background: "var(--ndvi-moderate)" }} />
        <div style={{ width: `${stressedPct}%`, background: "var(--ndvi-stressed)" }} />
      </div>
      <div style={S.barScale}>
        <span>{Math.round(healthyPct)}% healthy</span>
        <span>{Math.round(stressedPct)}% stressed</span>
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    ["var(--ndvi-healthy)", "Healthy canopy"],
    ["var(--ndvi-moderate)", "Some stress"],
    ["var(--ndvi-stressed)", "Stressed"],
  ];
  return (
    <div style={S.legend}>
      {items.map(([color, label]) => (
        <span key={label} style={S.legendItem}>
          <span style={{ ...S.legendSwatch, background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function Detections({ detections }) {
  if (!detections || detections.length === 0) {
    return (
      <div style={S.noDetections}>
        <div style={S.label}>Disease identification</div>
        <p style={S.noDetectionsBody}>
          Satellite imagery shows where a field is stressed, not what's causing it.
          Identifying a specific disease needs drone imagery at leaf resolution.
        </p>
      </div>
    );
  }

  return (
    <div style={S.detections}>
      <div style={S.label}>Detected</div>
      <ul style={S.detectionList}>
        {detections.map((d, i) => {
          const sev = DISEASE_SEVERITY[d.label] || "med";
          const color = `var(--sev-${sev})`;
          return (
            <li key={i} style={{ ...S.detectionItem, borderLeftColor: color }}>
              <span style={S.detectionName}>
                {DISEASE_LABELS[d.label] || d.label}
              </span>
              <span style={{ ...S.detectionConf, color }}>
                {Math.round(d.confidence * 100)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------------- styles ---------------- */

const S = {
  page: { minHeight: "100vh", background: "var(--surface-0)" },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    padding: "14px 20px",
    borderBottom: "1px solid var(--border)",
    flexWrap: "wrap",
  },
  brand: { display: "flex", alignItems: "center", gap: 10 },
  brandMark: { fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" },
  brandDivider: { width: 1, height: 14, background: "var(--border-strong)" },
  brandContext: { fontSize: 14, color: "var(--text-secondary)" },
  headerControls: { display: "flex", gap: 8, alignItems: "center" },

  segment: {
    display: "inline-flex",
    background: "var(--surface-sunken)",
    borderRadius: "var(--radius)",
    padding: 2,
    gap: 2,
  },
  segmentBtn: {
    border: "none",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 12,
    fontFamily: "inherit",
    cursor: "pointer",
    transition: "background 120ms, color 120ms",
  },

  errorBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    margin: "12px 20px 0",
    padding: "10px 14px",
    background: "var(--warn-bg)",
    border: "1px solid var(--warn-border)",
    borderRadius: "var(--radius)",
    color: "var(--warn-text)",
    fontSize: 13,
    lineHeight: 1.5,
  },
  errorDismiss: {
    background: "none",
    border: "none",
    color: "var(--warn-text)",
    fontSize: 18,
    lineHeight: 1,
    cursor: "pointer",
    padding: "0 4px",
  },

  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) 340px",
    gap: 16,
    padding: 20,
    maxWidth: 1400,
    margin: "0 auto",
    alignItems: "start",
  },

  mapWrap: {
    position: "relative",
    borderRadius: "var(--radius-lg)",
    overflow: "hidden",
    border: "1px solid var(--map-frame)",
  },
  map: { width: "100%", height: "clamp(360px, 62vh, 640px)", background: "var(--surface-sunken)" },
  mapEmpty: {
    position: "absolute",
    left: "50%",
    bottom: 24,
    transform: "translateX(-50%)",
    width: "min(460px, calc(100% - 32px))",
    background: "var(--surface-1)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "14px 16px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.16)",
    zIndex: 500,
  },
  mapEmptyTitle: { margin: "0 0 4px", fontSize: 14, fontWeight: 600 },
  mapEmptyBody: { margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" },

  sidebar: { display: "flex", flexDirection: "column", gap: 14 },

  card: {
    background: "var(--surface-1)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    padding: 18,
    boxShadow: "var(--shadow-card)",
  },
  cardHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  cardTitle: { margin: 0, fontSize: 15, fontWeight: 600 },

  statusPill: {
    fontSize: 12,
    fontWeight: 500,
    padding: "3px 9px",
    borderRadius: 100,
    border: "1px solid",
    whiteSpace: "nowrap",
  },

  label: {
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  },

  areaRow: { marginBottom: 14 },
  areaValue: {
    fontFamily: "var(--font-mono)",
    fontSize: 30,
    fontWeight: 500,
    lineHeight: 1.1,
    marginTop: 4,
    letterSpacing: "-0.02em",
  },
  areaUnit: {
    fontSize: 13,
    fontFamily: "var(--font-sans)",
    color: "var(--text-muted)",
    marginLeft: 6,
    fontWeight: 400,
  },

  staleBanner: {
    background: "var(--warn-bg)",
    border: "1px solid var(--warn-border)",
    borderRadius: "var(--radius)",
    padding: "10px 12px",
    marginBottom: 14,
  },
  staleTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--warn-text)",
    marginBottom: 4,
  },
  staleBody: { fontSize: 12.5, lineHeight: 1.55, color: "var(--warn-text)" },

  bar: {
    display: "flex",
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    background: "var(--surface-sunken)",
  },
  barScale: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11.5,
    color: "var(--text-muted)",
    marginTop: 6,
    fontFamily: "var(--font-mono)",
  },

  legend: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px 14px",
    marginTop: 12,
    paddingBottom: 14,
    borderBottom: "1px solid var(--border)",
  },
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  },
  legendSwatch: { width: 9, height: 9, borderRadius: 2 },

  metaList: { margin: "14px 0 0", padding: 0 },
  metaRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 12,
    padding: "5px 0",
  },
  metaLabel: { margin: 0, fontSize: 12.5, color: "var(--text-secondary)" },
  metaValue: { margin: 0, fontSize: 12.5, color: "var(--text-primary)" },

  emptyBody: {
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
    margin: "0 0 4px",
  },

  noDetections: {
    marginTop: 16,
    paddingTop: 14,
    borderTop: "1px solid var(--border)",
  },
  noDetectionsBody: {
    fontSize: 12.5,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
    margin: "6px 0 0",
  },

  detections: { marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" },
  detectionList: { listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 },
  detectionItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    background: "var(--surface-sunken)",
    borderLeft: "3px solid",
    borderRadius: "0 var(--radius) var(--radius) 0",
    padding: "8px 10px",
  },
  detectionName: { fontSize: 13, fontWeight: 500 },
  detectionConf: { fontSize: 12.5, fontFamily: "var(--font-mono)", fontWeight: 500 },

  btnPrimary: {
    width: "100%",
    padding: "10px 0",
    fontSize: 14,
    fontWeight: 500,
    fontFamily: "inherit",
    borderRadius: "var(--radius)",
    border: "none",
    background: "var(--accent)",
    color: "var(--accent-text)",
    transition: "background 120ms",
  },
  btnSecondary: {
    width: "100%",
    marginTop: 16,
    padding: "10px 0",
    fontSize: 14,
    fontWeight: 500,
    fontFamily: "inherit",
    borderRadius: "var(--radius)",
    border: "1px solid var(--border-strong)",
    background: "transparent",
    color: "var(--text-primary)",
    transition: "background 120ms",
  },
};