import { useEffect, useRef } from "react";

// ============================================================
// Vangill — landing page (React component)
//
// The marketing front door, rendered before AuthScreen. The
// "Open the app" actions call onEnter() to advance the flow in
// App.jsx state — no router needed.
//
// Styling reads from theme.css tokens, so this page inherits the
// same dark/light theme as the app screens. The one saturated
// accent is the data layer (the NDVI season-log chart).
//
// Requires ./theme.css imported once in main.jsx.
// ============================================================

export default function LandingPage({ onEnter }) {
  const revealRef = useRef([]);

  useEffect(() => {
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReduced) {
      revealRef.current.forEach((el) => el && el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealRef.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const addReveal = (el) => {
    if (el && !revealRef.current.includes(el)) revealRef.current.push(el);
  };

  return (
    <div style={S.page}>
      <style>{scoped}</style>

      <header style={S.bar}>
        <div style={{ ...S.wrap, ...S.barInner }}>
          <div style={S.logo}>
            <svg style={S.logoMark} viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="1" y="1" width="18" height="18" rx="4" stroke="var(--ndvi-healthy)" strokeWidth="1.5" />
              <path d="M5 13 L8 8 L11 11 L15 5" stroke="var(--ndvi-healthy)" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="15" cy="5" r="1.6" fill="var(--ndvi-stressed)" />
            </svg>
            Vangill
          </div>
          <button style={S.barCta} onClick={onEnter}>
            Open the app →
          </button>
        </div>
      </header>

      <main>
        {/* HERO */}
        <div style={S.hero}>
          <div style={S.wrap}>
            <div style={S.eyebrow}>Precision crop monitoring</div>
            <h1 style={S.h1}>
              Find the <span style={{ color: "var(--ndvi-stressed)" }}>stress</span> before it spreads.
            </h1>
            <p style={S.heroSub}>
              Vangill reads every field from orbit, flags where the crop is under
              stress, and — unlike a weather-app green dot — tells you the day the
              satellite actually saw it. Honest imagery beats a confident guess.
            </p>
            <div style={S.heroActions}>
              <button style={{ ...S.btn, ...S.btnPrimary }} onClick={onEnter}>
                Open the app
              </button>
              <a style={{ ...S.btn, ...S.btnGhost }} href="#how">
                See how it works
              </a>
            </div>

            {/* SIGNATURE: season-log instrument */}
            <div ref={addReveal} className="reveal" style={S.instrument}>
              <div style={S.instrumentHead}>
                <div>
                  <div style={S.instrumentTitle}>Season log · NDVI mean</div>
                  <div style={S.instrumentField}>Test field 04 · paddy · 12 ac</div>
                </div>
                <div style={S.instrumentLegend}>
                  <span><i style={{ ...S.legendDot, background: "var(--ndvi-healthy)" }} />vegetation</span>
                  <span><i style={{ ...S.legendDot, background: "var(--scan, #7fb0d4)" }} />scan</span>
                </div>
              </div>

              <div style={S.chartHolder}>
                <svg viewBox="0 0 800 260" role="img" aria-label="NDVI mean rising across the season from 0.09 to 0.54, with a gap where cloud cover blocked the satellite.">
                  <g stroke="var(--border)" strokeWidth="1">
                    <line x1="60" y1="40" x2="780" y2="40" />
                    <line x1="60" y1="100" x2="780" y2="100" />
                    <line x1="60" y1="160" x2="780" y2="160" />
                    <line x1="60" y1="220" x2="780" y2="220" />
                  </g>
                  <g fill="var(--text-muted)" fontFamily="var(--font-mono)" fontSize="11">
                    <text x="18" y="44">0.60</text>
                    <text x="18" y="104">0.40</text>
                    <text x="18" y="164">0.20</text>
                    <text x="18" y="224">0.00</text>
                  </g>
                  <defs>
                    <linearGradient id="ndviFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--ndvi-healthy)" stopOpacity="0.5" />
                      <stop offset="100%" stopColor="var(--ndvi-healthy)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d="M60 208 L204 196 L348 150 L492 92 L560 128 L636 66 L780 52 L780 220 L60 220 Z" fill="url(#ndviFill)" opacity="0.5" />
                  <path d="M60 208 L204 196 L348 150 L492 92" fill="none" stroke="var(--ndvi-healthy)" strokeWidth="2.5" strokeLinecap="round" />
                  <path d="M492 92 L560 128" fill="none" stroke="var(--ndvi-moderate)" strokeWidth="2.5" strokeDasharray="5 5" strokeLinecap="round" />
                  <path d="M560 128 L636 66 L780 52" fill="none" stroke="var(--ndvi-healthy)" strokeWidth="2.5" strokeLinecap="round" />
                  <g>
                    <circle cx="60" cy="208" r="4" fill="var(--ndvi-healthy)" />
                    <circle cx="204" cy="196" r="4" fill="var(--ndvi-healthy)" />
                    <circle cx="348" cy="150" r="4" fill="var(--ndvi-healthy)" />
                    <circle cx="492" cy="92" r="4" fill="var(--ndvi-healthy)" />
                    <circle cx="560" cy="128" r="4.5" fill="var(--ndvi-moderate)" stroke="var(--surface-0)" strokeWidth="2" />
                    <circle cx="636" cy="66" r="4" fill="var(--ndvi-healthy)" />
                    <circle cx="780" cy="52" r="4" fill="var(--ndvi-healthy)" />
                  </g>
                  <g fill="var(--text-muted)" fontFamily="var(--font-mono)" fontSize="11" textAnchor="middle">
                    <text x="60" y="244">27 Jun</text>
                    <text x="204" y="244">02 Jul</text>
                    <text x="348" y="244">08 Jul</text>
                    <text x="492" y="244">14 Jul</text>
                    <text x="560" y="244">cloud</text>
                    <text x="636" y="244">21 Jul</text>
                    <text x="780" y="244">24 Jul</text>
                  </g>
                </svg>
              </div>

              <div style={S.chartNote}>
                <span style={S.chartTag}>imagery gap</span>
                <span>
                  Two July passes were too cloudy to use. Vangill marks the gap
                  instead of drawing a straight line through it — the product's core
                  promise is knowing when it can't see.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* PROBLEM */}
        <section style={S.section}>
          <div style={S.wrap}>
            <div ref={addReveal} className="reveal" style={S.secLabel}>The problem</div>
            <h2 ref={addReveal} className="reveal" style={S.h2}>
              Farmers spray the whole field to treat a corner of it.
            </h2>
            <p ref={addReveal} className="reveal" style={S.lead}>
              Disease starts in patches. Without a way to see where, the rational
              move is to blanket-spray everything — costly for the grower, and more
              chemical on the crop than the problem warrants. Satellites can see the
              patches. Most tools just don't tell you how fresh the view is.
            </p>

            <div ref={addReveal} className="reveal" style={S.contrast}>
              <div style={S.contrastCell}>
                <h3 style={{ ...S.contrastH3, color: "var(--text-muted)" }}>Typical crop app</h3>
                <div style={S.contrastBig}>"Your field is 94% healthy"</div>
                <p style={S.contrastP}>
                  A single confident number, with no date attached. It might be
                  reading imagery from seven weeks ago behind a clear sky. You can't
                  tell, so you can't trust it.
                </p>
              </div>
              <div style={S.contrastCell}>
                <h3 style={{ ...S.contrastH3, color: "var(--ndvi-healthy)" }}>Vangill</h3>
                <div style={S.contrastBig}>"Healthy — imagery from 3 days ago"</div>
                <p style={S.contrastP}>
                  Every reading carries the date the satellite captured it and the
                  cloud cover it saw through. When the sky's been overcast for a
                  week, Vangill says so rather than pretending.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* PROOF */}
        <section style={S.section}>
          <div style={S.wrap}>
            <div ref={addReveal} className="reveal" style={S.secLabel}>Where it stands today</div>
            <h2 ref={addReveal} className="reveal" style={S.h2}>
              Not a mockup. A working detector on a real field.
            </h2>
            <div ref={addReveal} className="reveal" style={S.metrics}>
              {[
                ["91.7", "%", <>mAP<sub style={{ fontSize: 11 }}>50</sub> on the rice-disease model (YOLOv8m)</>],
                ["43", "k", "labelled training images across 10 disease classes"],
                ["96", "%", "confidence on the first live detection — brown spot"],
                ["~5", "d", "satellite revisit cadence on the monitored field"],
              ].map(([num, unit, label], i) => (
                <div key={i} style={S.metric}>
                  <div style={S.metricNum}>
                    {num}<span style={S.metricUnit}>{unit}</span>
                  </div>
                  <div style={S.metricLabel}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* HOW */}
        <section id="how" style={S.section}>
          <div style={S.wrap}>
            <div ref={addReveal} className="reveal" style={S.secLabel}>How it works</div>
            <h2 ref={addReveal} className="reveal" style={S.h2}>
              Orbit finds the where. Drone finds the what.
            </h2>
            <div ref={addReveal} className="reveal" style={S.steps}>
              {[
                ["01", "Draw your field once", <>Trace the boundary on satellite imagery. Vangill stores it and starts watching that exact polygon — no field visit, no hardware to install.</>],
                ["02", "Sentinel-2 tracks the canopy", <>Every pass, Vangill computes an NDVI vegetation index across the field and logs it. The trend — not a single reading — is what reveals stress creeping in.</>],
                ["03", "Stress flags a zone, not a diagnosis", <>Satellite resolution shows <em>where</em> the crop is struggling. <span style={{ color: "var(--ndvi-moderate)" }}>It can't name the disease — that honestly needs a closer look.</span></>],
                ["04", "Drone imagery names it", <>Flown over the flagged zone, leaf-resolution imagery runs through the disease model — brown spot, blast, sheath blight, and seven more — so the grower treats the right patch with the right thing.</>],
              ].map(([n, title, body]) => (
                <div key={n} style={S.step}>
                  <div style={S.stepN}>{n}</div>
                  <div>
                    <h3 style={S.stepH3}>{title}</h3>
                    <p style={S.stepP}>{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FOUNDER */}
        <section style={S.section}>
          <div style={S.wrap}>
            <div ref={addReveal} className="reveal" style={S.secLabel}>Who's building it</div>
            <h2 ref={addReveal} className="reveal" style={S.h2}>
              One founder, one field, a working pipeline.
            </h2>
            <div ref={addReveal} className="reveal" style={S.founder}>
              <div style={S.founderBadge} aria-hidden="true">V</div>
              <div>
                <div style={S.founderName}>Abheyjeet Gill</div>
                <div style={S.founderRole}>Solo founder · 2nd-year CS · Bathinda, Punjab</div>
                <p style={S.founderP}>
                  Vangill started on a single paddy field in Bathinda — the one still
                  plotted in the season log above. I built the whole stack solo: the
                  Sentinel-2 pipeline, the YOLOv8 disease model trained to 91.7%
                  mAP50, and the app that ties them together with satellite imagery,
                  phone-based sign-in, and per-field scan history.
                </p>
                <p style={S.founderP}>
                  Being in Punjab isn't incidental — it's a working farm belt where
                  blanket spraying is the default and the cost of it is visible. The
                  near-term goal is to widen from one instrumented field to many, and
                  to close the loop from satellite stress-flag to drone diagnosis to
                  a targeted spray recommendation a grower can act on the same week.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CLOSE */}
        <section style={{ ...S.section, ...S.close }}>
          <div style={S.wrap}>
            <h2 style={{ ...S.h2, margin: "0 auto" }}>See the field the way the satellite does.</h2>
            <p style={{ ...S.lead, margin: "18px auto 0" }}>
              The app is live on the field it was built on. Open it, draw a boundary,
              and run a scan.
            </p>
            <div style={{ ...S.heroActions, justifyContent: "center" }}>
              <button style={{ ...S.btn, ...S.btnPrimary }} onClick={onEnter}>
                Open the app
              </button>
              <a style={{ ...S.btn, ...S.btnGhost }} href="mailto:hello@vangill.com">
                Get in touch
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer style={S.footer}>
        <div style={{ ...S.wrap, ...S.footInner }}>
          <span>Vangill · precision crop monitoring</span>
          <span>
            <a style={S.footLink} href="mailto:hello@vangill.com">hello@vangill.com</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

/* Reveal animation + hover states can't be inline; scoped here.
   Everything else is inline style objects reading theme tokens. */
const scoped = `
  .reveal { opacity: 0; transform: translateY(16px); transition: opacity .6s ease, transform .6s ease; }
  .reveal.in { opacity: 1; transform: none; }
  @media (prefers-reduced-motion: reduce) { .reveal { opacity: 1; transform: none; transition: none; } }
`;

const S = {
  page: { background: "var(--surface-0)", color: "var(--text-primary)", minHeight: "100vh", lineHeight: 1.6 },
  wrap: { width: "100%", maxWidth: 1080, margin: "0 auto", padding: "0 24px" },

  bar: {
    position: "sticky", top: 0, zIndex: 50,
    backdropFilter: "blur(12px)",
    background: "color-mix(in srgb, var(--surface-0) 82%, transparent)",
    borderBottom: "1px solid var(--border)",
  },
  barInner: { display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 },
  logo: { fontFamily: "var(--font-display, var(--font-sans))", fontWeight: 700, fontSize: 19, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 9 },
  logoMark: { width: 20, height: 20, flexShrink: 0 },
  barCta: {
    fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-secondary)",
    padding: "7px 14px", border: "1px solid var(--border-strong)", borderRadius: 7,
    background: "transparent", cursor: "pointer",
  },

  hero: { padding: "76px 0 40px" },
  eyebrow: { fontFamily: "var(--font-mono)", fontSize: 12.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ndvi-healthy)", marginBottom: 22 },
  h1: { fontFamily: "var(--font-display, var(--font-sans))", fontWeight: 600, fontSize: "clamp(38px, 6.2vw, 68px)", lineHeight: 1.03, letterSpacing: "-0.03em", maxWidth: "15ch" },
  heroSub: { marginTop: 26, fontSize: "clamp(16px, 2vw, 19px)", color: "var(--text-secondary)", maxWidth: "54ch" },
  heroActions: { marginTop: 34, display: "flex", gap: 12, flexWrap: "wrap" },

  btn: { fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 500, padding: "12px 22px", borderRadius: 9, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid transparent", cursor: "pointer" },
  btnPrimary: { background: "var(--ndvi-healthy)", color: "#08140a" },
  btnGhost: { borderColor: "var(--border-strong)", color: "var(--text-primary)" },

  instrument: { marginTop: 60, background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" },
  instrumentHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "20px 24px 0", flexWrap: "wrap", gap: 12 },
  instrumentTitle: { fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" },
  instrumentField: { fontFamily: "var(--font-display, var(--font-sans))", fontSize: 17, fontWeight: 500, marginTop: 3 },
  instrumentLegend: { display: "flex", gap: 16, fontSize: 12, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" },
  legendDot: { display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 6, verticalAlign: "middle" },
  chartHolder: { padding: "8px 12px 20px" },
  chartNote: { borderTop: "1px solid var(--border)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12, fontSize: 13.5, color: "var(--text-secondary)" },
  chartTag: { fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ndvi-moderate)", border: "1px solid color-mix(in srgb, var(--ndvi-moderate) 45%, transparent)", padding: "3px 8px", borderRadius: 5, whiteSpace: "nowrap" },

  section: { padding: "72px 0" },
  secLabel: { fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 18 },
  h2: { fontFamily: "var(--font-display, var(--font-sans))", fontWeight: 600, fontSize: "clamp(26px, 3.6vw, 38px)", letterSpacing: "-0.02em", lineHeight: 1.1, maxWidth: "20ch" },
  lead: { marginTop: 18, fontSize: 17, color: "var(--text-secondary)", maxWidth: "60ch" },

  contrast: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "var(--border)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", marginTop: 40 },
  contrastCell: { background: "var(--surface-1)", padding: 28 },
  contrastH3: { fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 },
  contrastBig: { fontFamily: "var(--font-display, var(--font-sans))", fontSize: 21, marginBottom: 10, fontWeight: 500, letterSpacing: "-0.01em" },
  contrastP: { fontSize: 15, color: "var(--text-secondary)" },

  metrics: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "var(--border)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", marginTop: 40 },
  metric: { background: "var(--surface-1)", padding: "26px 22px" },
  metricNum: { fontFamily: "var(--font-mono)", fontSize: 30, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1 },
  metricUnit: { fontSize: 15, color: "var(--text-muted)", marginLeft: 2 },
  metricLabel: { marginTop: 10, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45 },

  steps: { marginTop: 40, display: "grid", gap: 1, background: "var(--border)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" },
  step: { background: "var(--surface-1)", padding: "24px 26px", display: "grid", gridTemplateColumns: "48px 1fr", gap: 20, alignItems: "start" },
  stepN: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ndvi-healthy)", paddingTop: 3 },
  stepH3: { fontFamily: "var(--font-display, var(--font-sans))", fontSize: 18, fontWeight: 500, marginBottom: 6 },
  stepP: { fontSize: 14.5, color: "var(--text-secondary)", maxWidth: "62ch" },

  founder: { marginTop: 40, background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 14, padding: 36, display: "grid", gridTemplateColumns: "auto 1fr", gap: 28, alignItems: "start" },
  founderBadge: { width: 84, height: 84, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--border-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display, var(--font-sans))", fontSize: 30, fontWeight: 700, color: "var(--ndvi-healthy)" },
  founderName: { fontFamily: "var(--font-display, var(--font-sans))", fontSize: 20, fontWeight: 600, marginBottom: 2 },
  founderRole: { fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-muted)", marginBottom: 16, letterSpacing: "0.04em" },
  founderP: { color: "var(--text-secondary)", fontSize: 15.5, marginTop: 14 },

  close: { textAlign: "center", borderTop: "1px solid var(--border)" },

  footer: { borderTop: "1px solid var(--border)", padding: "30px 0" },
  footInner: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, fontSize: 13, color: "var(--text-muted)", fontFamily: "var(--font-mono)" },
  footLink: { color: "var(--text-secondary)", textDecoration: "none" },
};