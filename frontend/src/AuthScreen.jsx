import { useState, useEffect, useRef } from "react";
import { auth } from "./firebase";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";

// ============================================================
// Vangill — Log in / Register
//
// Firebase Phone Auth (signInWithPhoneNumber + invisible
// RecaptchaVerifier). On register, POSTs the profile to:
//   POST /api/farmers/register
// then hands the Firebase user up via onAuthed(result.user).
//
// Requires ./theme.css imported once in main.jsx.
// ============================================================

const COUNTRIES = [
  { name: "United States", dial: "+1", iso: "US", minLen: 10, maxLen: 10 },
  { name: "Canada", dial: "+1", iso: "CA", minLen: 10, maxLen: 10 },
  { name: "United Kingdom", dial: "+44", iso: "GB", minLen: 10, maxLen: 10 },
  { name: "Australia", dial: "+61", iso: "AU", minLen: 9, maxLen: 9 },
  { name: "India", dial: "+91", iso: "IN", minLen: 10, maxLen: 10 },
];

// Single source of truth — the value is what the backend stores,
// the label is what the grower sees. Keeping them in one object
// means adding a crop can't desync the two.
const CROPS = [
  { value: "rice", label: "Rice" },
  { value: "corn", label: "Corn" },
  { value: "soybeans", label: "Soybeans" },
  { value: "wheat", label: "Wheat" },
  { value: "cotton", label: "Cotton" },
  { value: "other", label: "Other" },
];

const ACRES_PER_HECTARE = 2.47105;

export default function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [step, setStep] = useState("form");
  const [countryIdx, setCountryIdx] = useState(0);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [locality, setLocality] = useState("");
  const [fieldSize, setFieldSize] = useState("");
  const [units, setUnits] = useState(
    () => localStorage.getItem("ycagro:units") || "acres"
  );
  const [cropValue, setCropValue] = useState("rice");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("ycagro:theme") || "system"
  );
  const otpRef = useRef(null);

  const country = COUNTRIES[countryIdx];
  const validPhone =
    phone.length >= country.minLen && phone.length <= country.maxLen;

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    localStorage.setItem("ycagro:theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("ycagro:units", units);
  }, [units]);

  useEffect(() => {
    if (step === "otp" && otpRef.current) otpRef.current.focus();
  }, [step]);

  function getVerifier() {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(
        auth,
        "recaptcha-container",
        { size: "invisible" }
      );
    }
    return window.recaptchaVerifier;
  }

  function clearVerifier() {
    try {
      window.recaptchaVerifier?.clear();
    } catch {
      /* verifier may already be torn down */
    }
    window.recaptchaVerifier = null;
  }

  async function requestCode() {
    const e = {};
    if (!validPhone) e.phone = "Enter a valid mobile number.";
    if (mode === "register") {
      if (!name.trim()) e.name = "Enter your name.";
      if (!locality.trim()) e.locality = "Enter your city or town.";
      if (!fieldSize || Number(fieldSize) <= 0)
        e.fieldSize = "Enter your field size.";
    }
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    try {
      const confirmation = await signInWithPhoneNumber(
        auth,
        country.dial + phone,
        getVerifier()
      );
      window.confirmationResult = confirmation;
      setStep("otp");
    } catch (err) {
      console.error(err);
      clearVerifier();
      setErrors({ phone: "Couldn't send the code. Check the number and try again." });
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setErrors({});
    setOtp("");
    setBusy(true);
    // The previous verifier is spent — a fresh one is required or
    // Firebase rejects the second request.
    clearVerifier();
    try {
      const confirmation = await signInWithPhoneNumber(
        auth,
        country.dial + phone,
        getVerifier()
      );
      window.confirmationResult = confirmation;
    } catch (err) {
      console.error(err);
      clearVerifier();
      setErrors({ otp: "Couldn't send a new code. Go back and try again." });
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!/^\d{6}$/.test(otp)) {
      setErrors({ otp: "Enter the 6-digit code." });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const result = await window.confirmationResult.confirm(otp);

      if (mode === "register") {
        const token = await result.user.getIdToken();
        const acres =
          units === "acres"
            ? Number(fieldSize)
            : Number(fieldSize) * ACRES_PER_HECTARE;

        const res = await fetch(
          `${import.meta.env.VITE_API_URL}/api/farmers/register`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              name,
              village: locality,
              acreage: acres,
              crop: cropValue,
              lang: "en",
            }),
          }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Couldn't create your account.");
        }
      }

      clearVerifier();
      onAuthed?.(result.user);
    } catch (err) {
      console.error(err);
      setErrors({ otp: err.message || "That code was wrong or has expired." });
      setBusy(false);
    }
  }

  function goBack() {
    clearVerifier();
    setOtp("");
    setErrors({});
    setStep("form");
  }

  return (
    <div style={S.page}>
      <div id="recaptcha-container" />

      <div style={S.themeCorner}>
        <Segmented
          value={theme}
          onChange={setTheme}
          ariaLabel="Color theme"
          options={[
            { value: "light", label: "Light" },
            { value: "system", label: "Auto" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>

      <div style={S.card}>
        <header style={S.head}>
          <div style={S.brand}>Vangill</div>
          <p style={S.tagline}>
            Satellite monitoring for your fields. Find stress early, spray only
            where it's needed.
          </p>
        </header>

        <div style={S.body}>
          {step === "form" ? (
            <>
              <div style={S.tabs} role="tablist" aria-label="Log in or register">
                {[
                  ["login", "Log in"],
                  ["register", "Register"],
                ].map(([val, label]) => {
                  const active = mode === val;
                  return (
                    <button
                      key={val}
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        setMode(val);
                        setErrors({});
                      }}
                      style={{
                        ...S.tab,
                        background: active ? "var(--surface-2)" : "transparent",
                        color: active ? "var(--text-primary)" : "var(--text-muted)",
                        boxShadow: active ? "var(--shadow-card)" : "none",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {mode === "register" && (
                <>
                  <Field label="Full name" error={errors.name}>
                    <input
                      style={S.input(errors.name)}
                      value={name}
                      placeholder="John Carter"
                      autoComplete="name"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>

                  <Field label="City or town" error={errors.locality}>
                    <input
                      style={S.input(errors.locality)}
                      value={locality}
                      placeholder="Fresno, CA"
                      autoComplete="address-level2"
                      onChange={(e) => setLocality(e.target.value)}
                    />
                  </Field>

                  <Field label="Field size" error={errors.fieldSize}>
                    <div style={S.row}>
                      <input
                        style={{ ...S.input(errors.fieldSize), flex: 1 }}
                        value={fieldSize}
                        placeholder="120"
                        inputMode="decimal"
                        onChange={(e) =>
                          setFieldSize(e.target.value.replace(/[^\d.]/g, ""))
                        }
                      />
                      <Segmented
                        value={units}
                        onChange={setUnits}
                        ariaLabel="Area units"
                        options={[
                          { value: "acres", label: "ac" },
                          { value: "hectares", label: "ha" },
                        ]}
                      />
                    </div>
                  </Field>

                  <Field label="Main crop this season">
                    <div style={S.chipRow}>
                      {CROPS.map((c) => {
                        const active = cropValue === c.value;
                        return (
                          <button
                            key={c.value}
                            aria-pressed={active}
                            onClick={() => setCropValue(c.value)}
                            style={{
                              ...S.chip,
                              borderColor: active
                                ? "var(--accent)"
                                : "var(--border-strong)",
                              background: active
                                ? "var(--accent-bg)"
                                : "transparent",
                              color: active
                                ? "var(--accent)"
                                : "var(--text-secondary)",
                            }}
                          >
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                </>
              )}

              <Field label="Mobile number" error={errors.phone}>
                <div style={S.row}>
                  <select
                    style={S.select}
                    value={countryIdx}
                    onChange={(e) => setCountryIdx(Number(e.target.value))}
                    aria-label="Country code"
                  >
                    {COUNTRIES.map((c, i) => (
                      <option key={c.iso} value={i}>
                        {c.iso} {c.dial}
                      </option>
                    ))}
                  </select>
                  <input
                    style={{ ...S.input(errors.phone), flex: 1 }}
                    value={phone}
                    placeholder="555 018 2740"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={country.maxLen}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
              </Field>

              <button
                style={{ ...S.primary, opacity: busy ? 0.55 : 1 }}
                disabled={busy}
                onClick={requestCode}
              >
                {busy ? "Sending…" : "Send code"}
              </button>

              <p style={S.fineprint}>
                We'll text you a 6-digit code. Standard message rates apply.
              </p>
            </>
          ) : (
            <>
              <p style={S.otpIntro}>
                Code sent to{" "}
                <span style={S.otpNumber}>
                  {country.dial} {phone}
                </span>
              </p>

              <Field label="6-digit code" error={errors.otp}>
                <input
                  ref={otpRef}
                  style={{
                    ...S.input(errors.otp),
                    letterSpacing: "0.4em",
                    textAlign: "center",
                    fontSize: 22,
                    fontFamily: "var(--font-mono)",
                  }}
                  value={otp}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                />
              </Field>

              <button
                style={{ ...S.primary, opacity: busy ? 0.55 : 1 }}
                disabled={busy}
                onClick={verifyCode}
              >
                {busy ? "Verifying…" : "Verify and continue"}
              </button>

              <div style={S.otpActions}>
                <button style={S.link} disabled={busy} onClick={resendCode}>
                  Send a new code
                </button>
                <span style={S.linkDivider} />
                <button style={S.link} disabled={busy} onClick={goBack}>
                  Change number
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- components ---------------- */

function Field({ label, error, children }) {
  return (
    <div style={S.field}>
      <label style={S.label}>{label}</label>
      {children}
      {error && <p style={S.error}>{error}</p>}
    </div>
  );
}

function Segmented({ value, onChange, options, ariaLabel }) {
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

/* ---------------- styles ---------------- */

const S = {
  page: {
    minHeight: "100vh",
    background: "var(--surface-0)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    position: "relative",
  },
  themeCorner: { position: "absolute", top: 16, right: 16 },

  card: {
    width: "100%",
    maxWidth: 400,
    background: "var(--surface-1)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    overflow: "hidden",
    boxShadow: "var(--shadow-card)",
  },

  head: { padding: "26px 26px 0" },
  brand: {
    fontSize: 17,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    color: "var(--text-primary)",
  },
  tagline: {
    margin: "8px 0 0",
    fontSize: 13.5,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  },

  body: { padding: "20px 26px 26px" },

  tabs: {
    display: "flex",
    gap: 2,
    padding: 2,
    background: "var(--surface-sunken)",
    borderRadius: "var(--radius)",
    marginBottom: 6,
  },
  tab: {
    flex: 1,
    padding: "7px 0",
    fontSize: 13.5,
    fontWeight: 500,
    fontFamily: "inherit",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    transition: "background 120ms, color 120ms",
  },

  field: { marginTop: 16 },
  label: {
    display: "block",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  },
  input: (err) => ({
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    fontSize: 15,
    fontFamily: "inherit",
    borderRadius: "var(--radius)",
    border: `1px solid ${err ? "var(--ndvi-stressed)" : "var(--border-strong)"}`,
    background: "var(--surface-2)",
    color: "var(--text-primary)",
    outline: "none",
  }),
  select: {
    padding: "10px 8px",
    fontSize: 14,
    fontFamily: "inherit",
    borderRadius: "var(--radius)",
    border: "1px solid var(--border-strong)",
    background: "var(--surface-2)",
    color: "var(--text-primary)",
    outline: "none",
    width: 96,
  },
  row: { display: "flex", gap: 8, alignItems: "center" },

  chipRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: {
    padding: "6px 12px",
    borderRadius: 100,
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "inherit",
    cursor: "pointer",
    border: "1px solid",
    transition: "background 120ms, border-color 120ms, color 120ms",
  },

  error: {
    margin: "6px 0 0",
    fontSize: 12.5,
    color: "var(--ndvi-stressed)",
    lineHeight: 1.5,
  },

  primary: {
    width: "100%",
    marginTop: 22,
    padding: "11px 0",
    fontSize: 14.5,
    fontWeight: 500,
    fontFamily: "inherit",
    borderRadius: "var(--radius)",
    border: "none",
    background: "var(--accent)",
    color: "var(--accent-text)",
    cursor: "pointer",
    transition: "background 120ms",
  },

  fineprint: {
    margin: "12px 0 0",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-muted)",
    textAlign: "center",
  },

  otpIntro: {
    margin: "0 0 4px",
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  },
  otpNumber: { fontFamily: "var(--font-mono)", color: "var(--text-primary)" },

  otpActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginTop: 14,
  },
  link: {
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 13,
    fontFamily: "inherit",
    color: "var(--accent)",
    cursor: "pointer",
  },
  linkDivider: { width: 1, height: 12, background: "var(--border-strong)" },

  segment: {
    display: "inline-flex",
    background: "var(--surface-sunken)",
    borderRadius: "var(--radius)",
    padding: 2,
    gap: 2,
    flexShrink: 0,
  },
  segmentBtn: {
    border: "none",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 12,
    fontFamily: "inherit",
    cursor: "pointer",
    transition: "background 120ms, color 120ms",
  },
};