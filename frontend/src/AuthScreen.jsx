import { useState } from "react";
import { auth } from "./firebase";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
// ============================================================
// YC Agro — Login + Farmer Registration
// Phone-first auth (farmers rarely use email).
// Firebase wiring: replace the mock handlers below with
// Firebase Phone Auth (signInWithPhoneNumber + RecaptchaVerifier)
// and POST the registration payload to the Flask backend:
//   POST /api/farmers/register
// ============================================================

const T = {
  en: {
    brand: "YC Agro",
    tagline: "Satellite eyes on your field. Spray only where it's needed.",
    login: "Log in",
    register: "New farmer",
    phone: "Mobile number",
    phonePh: "10-digit mobile number",
    sendOtp: "Send OTP",
    otp: "Enter the 6-digit code",
    otpSent: "Code sent to",
    verify: "Verify and continue",
    resend: "Send code again",
    name: "Full name",
    namePh: "e.g. Gurpreet Singh",
    village: "Village / town",
    villagePh: "e.g. Bhucho Mandi, Bathinda",
    acreage: "Field size (acres)",
    acreagePh: "e.g. 12",
    crop: "Main crop this season",
    createAccount: "Create account",
    haveAccount: "Already registered? Log in",
    newHere: "New to YC Agro? Register",
    crops: ["Paddy (rice)", "Wheat", "Cotton", "Other"],
    errPhone: "Enter a valid 10-digit mobile number",
    errOtp: "Enter the 6-digit code",
    errName: "Enter your name",
    errVillage: "Enter your village or town",
    errAcre: "Enter your field size in acres",
  },
  pa: {
    brand: "YC Agro",
    tagline: "ਤੁਹਾਡੇ ਖੇਤ 'ਤੇ ਸੈਟੇਲਾਈਟ ਦੀ ਨਜ਼ਰ। ਸਪਰੇਅ ਸਿਰਫ਼ ਉੱਥੇ ਜਿੱਥੇ ਲੋੜ ਹੈ।",
    login: "ਲਾਗਇਨ",
    register: "ਨਵਾਂ ਕਿਸਾਨ",
    phone: "ਮੋਬਾਈਲ ਨੰਬਰ",
    phonePh: "10 ਅੰਕਾਂ ਦਾ ਮੋਬਾਈਲ ਨੰਬਰ",
    sendOtp: "OTP ਭੇਜੋ",
    otp: "6 ਅੰਕਾਂ ਦਾ ਕੋਡ ਭਰੋ",
    otpSent: "ਕੋਡ ਭੇਜਿਆ ਗਿਆ",
    verify: "ਤਸਦੀਕ ਕਰੋ",
    resend: "ਕੋਡ ਦੁਬਾਰਾ ਭੇਜੋ",
    name: "ਪੂਰਾ ਨਾਮ",
    namePh: "ਜਿਵੇਂ ਗੁਰਪ੍ਰੀਤ ਸਿੰਘ",
    village: "ਪਿੰਡ / ਸ਼ਹਿਰ",
    villagePh: "ਜਿਵੇਂ ਭੁੱਚੋ ਮੰਡੀ, ਬਠਿੰਡਾ",
    acreage: "ਖੇਤ ਦਾ ਆਕਾਰ (ਏਕੜ)",
    acreagePh: "ਜਿਵੇਂ 12",
    crop: "ਇਸ ਸੀਜ਼ਨ ਦੀ ਮੁੱਖ ਫਸਲ",
    createAccount: "ਖਾਤਾ ਬਣਾਓ",
    haveAccount: "ਪਹਿਲਾਂ ਰਜਿਸਟਰ ਹੋ? ਲਾਗਇਨ ਕਰੋ",
    newHere: "ਨਵੇਂ ਹੋ? ਰਜਿਸਟਰ ਕਰੋ",
    crops: ["ਝੋਨਾ (ਚਾਵਲ)", "ਕਣਕ", "ਕਪਾਹ", "ਹੋਰ"],
    errPhone: "ਸਹੀ 10 ਅੰਕਾਂ ਦਾ ਨੰਬਰ ਭਰੋ",
    errOtp: "6 ਅੰਕਾਂ ਦਾ ਕੋਡ ਭਰੋ",
    errName: "ਆਪਣਾ ਨਾਮ ਭਰੋ",
    errVillage: "ਆਪਣਾ ਪਿੰਡ ਜਾਂ ਸ਼ਹਿਰ ਭਰੋ",
    errAcre: "ਖੇਤ ਦਾ ਆਕਾਰ ਏਕੜ ਵਿੱਚ ਭਰੋ",
  },
};

// NDVI strip — the product's signature: red (stress) → green (healthy)
const NDVI = ["#a63d2f", "#c97b3a", "#d9a441", "#9aa83f", "#5c8a3c", "#2f6b35"];

const css = {
  page: {
    minHeight: "100vh",
    background: "#10271a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    background: "#f7f5ef",
    borderRadius: 14,
    overflow: "hidden",
    boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
  },
  strip: { display: "flex", height: 8 },
  head: { padding: "26px 28px 10px" },
  brand: {
    margin: 0,
    fontSize: 30,
    fontWeight: 800,
    letterSpacing: "-0.5px",
    color: "#1e4d2b",
  },
  tagline: { margin: "6px 0 0", fontSize: 14, color: "#5a6354", lineHeight: 1.45 },
  body: { padding: "18px 28px 28px" },
  tabs: { display: "flex", gap: 8, margin: "14px 0 20px" },
  tab: (active) => ({
    flex: 1,
    padding: "10px 0",
    borderRadius: 8,
    border: active ? "2px solid #1e4d2b" : "2px solid #d8d4c8",
    background: active ? "#1e4d2b" : "transparent",
    color: active ? "#f7f5ef" : "#4a5345",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
  }),
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 700,
    color: "#3a4435",
    margin: "14px 0 6px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  input: (err) => ({
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 14px",
    fontSize: 17,
    borderRadius: 8,
    border: err ? "2px solid #a63d2f" : "2px solid #c9c4b4",
    background: "#fff",
    color: "#222",
    outline: "none",
  }),
  err: { color: "#a63d2f", fontSize: 13, margin: "5px 0 0" },
  primary: {
    width: "100%",
    marginTop: 22,
    padding: "14px 0",
    fontSize: 17,
    fontWeight: 800,
    borderRadius: 8,
    border: "none",
    background: "#d9a441",
    color: "#2a2410",
    cursor: "pointer",
  },
  ghost: {
    width: "100%",
    marginTop: 12,
    padding: "8px 0",
    fontSize: 14,
    border: "none",
    background: "transparent",
    color: "#1e4d2b",
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "underline",
  },
  langBtn: (active) => ({
    border: "none",
    background: "transparent",
    color: active ? "#d9a441" : "#7d8a78",
    fontWeight: active ? 800 : 500,
    fontSize: 13,
    cursor: "pointer",
    padding: "2px 6px",
  }),
  cropRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: (active) => ({
    padding: "8px 14px",
    borderRadius: 999,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    border: active ? "2px solid #1e4d2b" : "2px solid #c9c4b4",
    background: active ? "#e4ead9" : "#fff",
    color: "#2c3527",
  }),
};

export default function AuthScreen({ onAuthed }) {
  const [lang, setLang] = useState("pa");
  const [mode, setMode] = useState("login"); // login | register
  const [step, setStep] = useState("form"); // form | otp | done
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [village, setVillage] = useState("");
  const [acreage, setAcreage] = useState("");
  const [crop, setCrop] = useState(0);
  const [errors, setErrors] = useState({});
  const t = T[lang];

  const validPhone = /^[6-9]\d{9}$/.test(phone);

  const sendOtp = async () => {
  const e = {};
  if (!validPhone) e.phone = t.errPhone;
  if (mode === "register") {
    if (!name.trim()) e.name = t.errName;
    if (!village.trim()) e.village = t.errVillage;
    if (!acreage || Number(acreage) <= 0) e.acreage = t.errAcre;
  }
  setErrors(e);
  if (Object.keys(e).length) return;

  try {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", {
        size: "invisible",
      });
    }
    const confirmation = await signInWithPhoneNumber(
      auth,
      "+91" + phone,
      window.recaptchaVerifier
    );
    window.confirmationResult = confirmation;
    setStep("otp");
  } catch (err) {
    setErrors({ phone: "Could not send code. Try again." });
    console.error(err);
  }
};

  const verify = async () => {
  if (!/^\d{6}$/.test(otp)) return setErrors({ otp: t.errOtp });
  setErrors({});
  try {
    const result = await window.confirmationResult.confirm(otp);
    const token = await result.user.getIdToken();
    if (mode === "register") {
      await fetch("http://localhost:5000/api/farmers/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          village,
          acreage,
          crop: ["paddy", "wheat", "cotton", "other"][crop],
          lang,
        }),
      });
    }
    setStep("done");
    setTimeout(() => onAuthed && onAuthed(result.user), 1200);
  } catch (err) {
    setErrors({ otp: "Wrong or expired code." });
    console.error(err);
  }
};
  return (
    <div style={css.page}>
      <div style={css.card}>
        <div style={css.strip}>
          {NDVI.map((c) => (
            <div key={c} style={{ flex: 1, background: c }} />
          ))}
        </div>

        <div style={css.head}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h1 style={css.brand}>{t.brand}</h1>
            <div>
              <button style={css.langBtn(lang === "pa")} onClick={() => setLang("pa")}>ਪੰਜਾਬੀ</button>
              <span style={{ color: "#c9c4b4" }}>|</span>
              <button style={css.langBtn(lang === "en")} onClick={() => setLang("en")}>English</button>
            </div>
          </div>
          <p style={css.tagline}>{t.tagline}</p>
        </div>
        <div id="recaptcha-container"></div>
        <div style={css.body}>
          {step === "form" && (
            <>
              <div style={css.tabs}>
                <button style={css.tab(mode === "login")} onClick={() => setMode("login")}>{t.login}</button>
                <button style={css.tab(mode === "register")} onClick={() => setMode("register")}>{t.register}</button>
              </div>

              {mode === "register" && (
                <>
                  <label style={css.label}>{t.name}</label>
                  <input style={css.input(errors.name)} value={name} placeholder={t.namePh}
                    onChange={(e) => setName(e.target.value)} />
                  {errors.name && <p style={css.err}>{errors.name}</p>}

                  <label style={css.label}>{t.village}</label>
                  <input style={css.input(errors.village)} value={village} placeholder={t.villagePh}
                    onChange={(e) => setVillage(e.target.value)} />
                  {errors.village && <p style={css.err}>{errors.village}</p>}

                  <label style={css.label}>{t.acreage}</label>
                  <input style={css.input(errors.acreage)} value={acreage} placeholder={t.acreagePh}
                    inputMode="numeric" onChange={(e) => setAcreage(e.target.value.replace(/[^\d.]/g, ""))} />
                  {errors.acreage && <p style={css.err}>{errors.acreage}</p>}

                  <label style={css.label}>{t.crop}</label>
                  <div style={css.cropRow}>
                    {t.crops.map((c, i) => (
                      <button key={c} style={css.chip(crop === i)} onClick={() => setCrop(i)}>{c}</button>
                    ))}
                  </div>
                </>
              )}

              <label style={css.label}>{t.phone}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ ...css.input(false), width: 64, flex: "none", textAlign: "center", color: "#555" }}>+91</div>
                <input style={css.input(errors.phone)} value={phone} placeholder={t.phonePh}
                  inputMode="numeric" maxLength={10}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} />
              </div>
              {errors.phone && <p style={css.err}>{errors.phone}</p>}

              <button style={css.primary} onClick={sendOtp}>{t.sendOtp}</button>
              <button style={css.ghost} onClick={() => setMode(mode === "login" ? "register" : "login")}>
                {mode === "login" ? t.newHere : t.haveAccount}
              </button>
            </>
          )}

          {step === "otp" && (
            <>
              <p style={{ fontSize: 15, color: "#3a4435" }}>
                {t.otpSent} <b>+91 {phone}</b>
              </p>
              <label style={css.label}>{t.otp}</label>
              <input style={{ ...css.input(errors.otp), letterSpacing: 8, textAlign: "center", fontSize: 24 }}
                value={otp} inputMode="numeric" maxLength={6}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
              {errors.otp && <p style={css.err}>{errors.otp}</p>}
              <button style={css.primary} onClick={verify}>{t.verify}</button>
              <button style={css.ghost} onClick={() => setStep("form")}>{t.resend}</button>
            </>
          )}

          {step === "done" && (
            <div style={{ textAlign: "center", padding: "30px 0" }}>
              <div style={{ fontSize: 48 }}>🌾</div>
              <h2 style={{ color: "#1e4d2b", margin: "10px 0 4px" }}>
                {mode === "register" ? (lang === "pa" ? "ਖਾਤਾ ਬਣ ਗਿਆ!" : "Account created!") : (lang === "pa" ? "ਜੀ ਆਇਆਂ ਨੂੰ!" : "Welcome back!")}
              </h2>
              <p style={{ color: "#5a6354", fontSize: 14 }}>
                {lang === "pa" ? "ਡੈਸ਼ਬੋਰਡ ਖੁੱਲ੍ਹ ਰਿਹਾ ਹੈ…" : "Loading your field dashboard…"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
