"use client";

import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";

// ═══════════════════════════════════════════════════════════════════
// CONTENT — edit all page copy here or use the visual editor
// ═══════════════════════════════════════════════════════════════════
const DEFAULT_CONTENT = {
  hero_badge: "Automated CIM diligence",
  hero_title_1: "Thesis pillars. Operational narrative. Diligence plan.",
  hero_title_2: "Just hit send.",
  hero_title_3: "",
  hero_subtitle: "Bypass the fluff and get a clear view of the operational narrative at the core of any CIM. CIMScan extracts and pressure tests a CIM's operational claims. You'll get a detailed set of suggested underwriting gates, diligence work streams, an interdependency analysis and thesis support related to growth, retention, margin, moat and risk. All in minutes.",
  hero_cta_primary: "Start scanning",
  hero_cta_secondary: "See how it works",
  hero_trust: "Built for private equity diligence teams",

  how_label: "How it works",
  how_title_1: "Four steps from inbox",
  how_title_2: "to investment committee",
  step1_title: "Email your CIM",
  step1_desc: "Send the CIM PDF to your firm's dedicated ingest address. CIMScan validates the file and creates a deal.",
  step2_title: "Configure your run",
  step2_desc: "Choose CORE (25–28 claims) or FULL (45–60 claims) depth. Accept terms and authorize payment.",
  step3_title: "Pipeline runs",
  step3_desc: "Six sequential analytical stages extract claims, score underwriting gates, map interdependencies, and synthesize thesis pillars.",
  step4_title: "Receive deliverables",
  step4_desc: "Dataset D workbook and IC Insights narrative document — delivered to your inbox with secure download links.",

  del_label: "Deliverables",
  del_title: "Two outputs, one pipeline",
  del_subtitle: "Every run produces a structured workbook for analysts and a narrative document for IC.",
  del1_title: "Dataset D",
  del1_desc: "A 12-sheet Excel workbook with the complete claim register, underwriting gates and kill thresholds, workstream execution plan, interdependency matrix, and thesis pillar validation checks.",
  del2_title: "IC Insights",
  del2_desc: "A styled narrative document written from three analytical perspectives — sympathetic analyst, skeptical IC partner, and domain expert — designed to be read directly in investment committee.",

  engine_label: "The engine",
  engine_title: "Six-stage analytical pipeline",
  engine_subtitle: "Each stage builds on the full context of prior stages. The pipeline enforces 15 structural invariants — quantified kill thresholds, exactly 5 thesis pillars, and strict output validation at every step.",

  pricing_label: "Pricing",
  pricing_title: "Pay per run. No subscriptions.",
  core_claims: "25–28",
  core_desc: "The right depth for initial screening. Covers major diligence surfaces with quantified underwriting gates.",
  full_claims: "45–60",
  full_desc: "Comprehensive extraction across all surfaces. Higher quotas per surface area with extended interdependency analysis.",
  pricing_note: "No charge if the CIM fails the quality gate. Payment is authorized on configuration and only captured on successful completion.",

  cta_title: "Start your first scan",
  cta_subtitle: "Create your account, get your firm's ingest address, and email your first CIM. Deliverables arrive in minutes.",
  cta_button: "Create your account",

  trust_label: "Your data",
  trust_title: "CIMs are confidential. We treat them that way.",
  trust_subtitle: "We know what you're sending us. Here's how we handle it.",
  trust1_title: "No model training",
  trust1_desc: "Your CIM content is never used to train AI models. We process via API with no data retention on the model side.",
  trust2_title: "CIM deleted after processing",
  trust2_desc: "Your CIM PDF is deleted immediately after a successful pipeline run. We don't hold onto the source document.",
  trust3_title: "90-day output retention",
  trust3_desc: "Deliverables are retained for 90 days, then automatically purged. Delivery links expire after 7 days.",
  trust4_title: "You control your data",
  trust4_desc: "Log in to delete your data or your account at any time. Registered users only — unknown senders are rejected on contact.",

  video_cta_title: "Ready to see it in action?",
  video_cta_subtitle: "Get your first CIM scanned in minutes.",
  video_cta_button: "Start scanning",

  footer_entity: "CIMScan — True Bearing LLC",
};

// ═══════════════════════════════════════════════════════════════════
// EDIT CONTEXT
// ═══════════════════════════════════════════════════════════════════
const EditContext = createContext();
function useEdit() { return useContext(EditContext); }

// ── EDITABLE TEXT COMPONENT ───────────────────────────────────────
function E({ k, tag = "span", style = {} }) {
  const { editing, content, update } = useEdit();
  const text = content[k] || "";

  if (!editing) {
    const Tag = tag;
    return <Tag style={style}>{text}</Tag>;
  }

  const isLong = text.length > 80;
  const shared = {
    ...style,
    background: "rgba(201,169,110,0.06)",
    border: "1px dashed rgba(201,169,110,0.3)",
    borderRadius: 6,
    padding: isLong ? "6px 8px" : "4px 8px",
    width: "100%",
    outline: "none",
    fontFamily: style.fontFamily || "inherit",
    fontSize: style.fontSize || "inherit",
    color: style.color || "inherit",
    lineHeight: style.lineHeight || "inherit",
    letterSpacing: style.letterSpacing || "inherit",
    fontWeight: style.fontWeight || "inherit",
  };

  return isLong ? (
    <textarea value={text} onChange={(e) => update(k, e.target.value)} rows={3} style={{ ...shared, resize: "vertical" }} />
  ) : (
    <input type="text" value={text} onChange={(e) => update(k, e.target.value)} style={shared} />
  );
}

// ═══════════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════════
const GOLD = "#c9a96e";
const GOLD_DIM = "#8a7448";
const CREAM = "#f0ebe3";
const MUTED = "#9a9488";
const DIM = "#6a6258";
const BG = "#0f0e0c";
const CARD_BG = "rgba(255,255,255,0.025)";
const CARD_BORDER = "rgba(255,255,255,0.06)";
const SERIF = "'DM Serif Display', Georgia, serif";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', 'SF Mono', monospace";

// ═══════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════
export default function LandingPage() {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(DEFAULT_CONTENT);
  const [copied, setCopied] = useState(false);

  const update = useCallback((key, value) => {
    setContent((prev) => ({ ...prev, [key]: value }));
  }, []);

  const exportJSON = () => {
    const json = JSON.stringify(content, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <EditContext.Provider value={{ editing, content, update }}>
      <Globals />
      <div style={{ background: BG, minHeight: "100vh", overflowX: "hidden" }}>
        {/* ── EDITOR TOOLBAR ── */}
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 200, display: "flex", gap: 8, alignItems: "center",
          background: "rgba(26,24,20,0.95)", backdropFilter: "blur(16px)",
          border: `1px solid ${editing ? "rgba(201,169,110,0.3)" : CARD_BORDER}`,
          borderRadius: 12, padding: "8px 12px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          fontFamily: SANS, fontSize: 13, transition: "border-color 0.3s",
        }}>
          <button onClick={() => setEditing(!editing)} style={{
            padding: "8px 18px", borderRadius: 8, border: "none",
            background: editing ? `linear-gradient(135deg, ${GOLD}, ${GOLD_DIM})` : "rgba(255,255,255,0.06)",
            color: editing ? "#1a1814" : MUTED,
            fontFamily: SANS, fontSize: 13, fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            {editing ? "Editing" : "Edit copy"}
          </button>

          {editing && (
            <>
              <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)" }} />
              <button onClick={exportJSON} style={{
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: "rgba(255,255,255,0.06)", color: copied ? "#10b981" : MUTED,
                fontFamily: SANS, fontSize: 13, fontWeight: 500, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                {copied ? (
                  <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied!</>
                ) : (
                  <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Export JSON</>
                )}
              </button>
              <button onClick={() => setContent(DEFAULT_CONTENT)} style={{
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: "rgba(255,255,255,0.06)", color: MUTED,
                fontFamily: SANS, fontSize: 13, fontWeight: 500, cursor: "pointer",
              }}>Reset</button>
            </>
          )}
        </div>

        <Nav />
        <Hero />
        <HowItWorks />
        <Deliverables />
        <Pipeline />
        <Pricing />
        <Trust />
        <FinalCTA />
        <Footer />
      </div>
    </EditContext.Provider>
  );
}

// ── GLOBALS ───────────────────────────────────────────────────────
function Globals() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      html { scroll-behavior: smooth; }
      body { background: ${BG}; }
      @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes gradientShift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
      .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease, transform 0.7s ease; }
      .reveal.visible { opacity: 1; transform: translateY(0); }
      textarea:focus, input:focus { box-shadow: 0 0 0 2px rgba(201,169,110,0.2) !important; }
    `}</style>
  );
}

// ── SCROLL REVEAL ─────────────────────────────────────────────────
function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.classList.add("visible"); obs.unobserve(el); } }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}
function Reveal({ children, style, delay = 0 }) {
  const ref = useReveal();
  return <div ref={ref} className="reveal" style={{ transitionDelay: `${delay}ms`, ...style }}>{children}</div>;
}

// ── NAV ───────────────────────────────────────────────────────────
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
      padding: "0 40px", height: 64,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      background: scrolled ? "rgba(15,14,12,0.92)" : "transparent",
      backdropFilter: scrolled ? "blur(16px)" : "none",
      borderBottom: scrolled ? `1px solid ${CARD_BORDER}` : "1px solid transparent",
      transition: "all 0.3s ease", fontFamily: SANS,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 7,
          background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DIM})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, color: "#1a1814", fontFamily: SERIF,
        }}>CS</div>
        <span style={{ fontFamily: SERIF, fontSize: 18, color: "#d4cfc6", letterSpacing: "0.02em" }}>CIMScan</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        {[["#how-it-works","How it works"],["#deliverables","Deliverables"],["#pricing","Pricing"],["#security","Security"]].map(([h,l])=>(
          <a key={h} href={h} style={{ color: MUTED, textDecoration: "none", fontSize: 13, fontWeight: 500, transition: "color 0.2s" }}
            onMouseEnter={e=>e.target.style.color=CREAM} onMouseLeave={e=>e.target.style.color=MUTED}>{l}</a>
        ))}
        <a href="/signup" style={{
          padding: "8px 20px", borderRadius: 8,
          background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DIM})`,
          color: "#1a1814", fontSize: 13, fontWeight: 600, textDecoration: "none",
        }}>Get started</a>
      </div>
    </nav>
  );
}

// ── HERO ──────────────────────────────────────────────────────────
function Hero() {
  return (
    <section style={{ padding: "160px 40px 100px", maxWidth: 1100, margin: "0 auto", textAlign: "center", position: "relative" }}>
      <div style={{
        position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)",
        width: 600, height: 400,
        background: "radial-gradient(ellipse, rgba(201,169,110,0.06) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <div style={{ animation: "fadeUp 0.7s ease-out", position: "relative" }}>
        <div style={{
          display: "inline-block", padding: "6px 16px", borderRadius: 20,
          background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.15)", marginBottom: 28,
        }}>
          <E k="hero_badge" style={{ fontSize: 12, fontWeight: 600, color: GOLD, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: SANS }} />
        </div>

        <div style={{ maxWidth: 860, margin: "0 auto 24px" }}>
          <h1 style={{ fontFamily: SERIF, fontSize: 52, fontWeight: 400, color: CREAM, lineHeight: 1.15, letterSpacing: "-0.025em" }}>
            <E k="hero_title_1" style={{ fontFamily: SERIF, fontSize: 52, fontWeight: 400, color: CREAM, lineHeight: 1.15, letterSpacing: "-0.025em" }} />
          </h1>
          <p style={{
            fontFamily: SERIF, fontSize: 44, fontWeight: 400, marginTop: 12,
            background: `linear-gradient(135deg, ${GOLD}, #e8cc8a, ${GOLD_DIM})`,
            backgroundSize: "200% auto", animation: "gradientShift 4s ease infinite",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            letterSpacing: "-0.02em",
          }}>
            <E k="hero_title_2" style={{ fontFamily: SERIF, fontSize: 44, fontWeight: 400, color: GOLD, letterSpacing: "-0.02em" }} />
          </p>
        </div>

        <div style={{ maxWidth: 680, margin: "0 auto 40px" }}>
          <E k="hero_subtitle" tag="p" style={{ fontFamily: SANS, fontSize: 16, color: MUTED, lineHeight: 1.75 }} />
        </div>

        <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/signup" style={{
            padding: "15px 36px", borderRadius: 10,
            background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DIM})`,
            color: "#1a1814", fontSize: 15, fontWeight: 600, textDecoration: "none", fontFamily: SANS,
            boxShadow: "0 4px 24px rgba(201,169,110,0.2)",
          }}>
            <E k="hero_cta_primary" style={{ fontSize: 15, fontWeight: 600, color: "#1a1814", fontFamily: SANS }} />
          </a>
          <a href="#how-it-works" style={{
            padding: "15px 36px", borderRadius: 10,
            background: "rgba(255,255,255,0.04)", border: `1px solid ${CARD_BORDER}`,
            color: "#c0b8a8", fontSize: 15, fontWeight: 500, textDecoration: "none", fontFamily: SANS,
          }}>
            <E k="hero_cta_secondary" style={{ fontSize: 15, fontWeight: 500, color: "#c0b8a8", fontFamily: SANS }} />
          </a>
        </div>
      </div>

      <div style={{ marginTop: 72, paddingTop: 20, borderTop: `1px solid ${CARD_BORDER}`, animation: "fadeIn 1s ease-out 0.5s both" }}>
        <E k="hero_trust" tag="p" style={{ fontFamily: SANS, fontSize: 12, color: DIM, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 500 }} />
      </div>
    </section>
  );
}

// ── HOW IT WORKS ──────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    { num: "01", tK: "step1_title", dK: "step1_desc", icon: <MailIcon /> },
    { num: "02", tK: "step2_title", dK: "step2_desc", icon: <GearIcon /> },
    { num: "03", tK: "step3_title", dK: "step3_desc", icon: <ListIcon /> },
    { num: "04", tK: "step4_title", dK: "step4_desc", icon: <FileIcon /> },
  ];

  return (
    <section id="how-it-works" style={{ padding: "100px 40px", maxWidth: 1100, margin: "0 auto" }}>
      <Reveal>
        <SectionLabel k="how_label" />
        <div style={{ marginBottom: 40 }}>
          <h2 style={{ fontFamily: SERIF, fontSize: 42, color: CREAM, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
            <E k="how_title_1" style={{ fontFamily: SERIF, fontSize: 42, color: CREAM }} />
            <br />
            <E k="how_title_2" style={{ fontFamily: SERIF, fontSize: 42, color: CREAM }} />
          </h2>
        </div>
      </Reveal>

      <Reveal>
        <DemoVideo />
      </Reveal>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, marginTop: 40 }}>
        {steps.map((s, i) => (
          <Reveal key={i} delay={i * 100}>
            <div style={{
              background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 14,
              padding: "32px 24px", height: "100%", transition: "border-color 0.3s, background 0.3s",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(201,169,110,0.15)"; e.currentTarget.style.background = "rgba(255,255,255,0.035)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = CARD_BORDER; e.currentTarget.style.background = CARD_BG; }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                {s.icon}
                <span style={{ fontFamily: MONO, fontSize: 12, color: DIM, fontWeight: 500 }}>{s.num}</span>
              </div>
              <div style={{ marginBottom: 10 }}>
                <E k={s.tK} tag="h3" style={{ fontFamily: SERIF, fontSize: 20, color: CREAM, fontWeight: 400 }} />
              </div>
              <E k={s.dK} tag="p" style={{ fontFamily: SANS, fontSize: 14, color: MUTED, lineHeight: 1.65 }} />
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ── DEMO VIDEO WITH CTA OVERLAY ──────────────────────────────────
function DemoVideo() {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);

  const handlePlay = () => {
    if (videoRef.current) {
      videoRef.current.play();
      setPlaying(true);
      setEnded(false);
    }
  };

  const handleReplay = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play();
      setPlaying(true);
      setEnded(false);
    }
  };

  // ── CONFIGURATION ──────────────────────────────────────────────
  // Replace this placeholder with your actual video:
  //
  // Self-hosted MP4:
  //   <video ref={videoRef} src="/videos/cimscan-demo.mp4" ... />
  //
  // YouTube: replace the entire <video> block with YouTube iframe API
  //   and use onStateChange to detect YT.PlayerState.ENDED
  //
  // HeyGen embed: replace with their embed code and listen for
  //   the postMessage event when playback completes
  //
  // The CTA overlay logic stays the same regardless of source.
  // ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      position: "relative", borderRadius: 14, overflow: "hidden",
      background: "#0a0908", border: `1px solid ${CARD_BORDER}`,
      aspectRatio: "16/9",
    }}>
      {/* Video element — replace src with your actual video */}
      <video
        ref={videoRef}
        src=""
        onEnded={() => { setPlaying(false); setEnded(true); }}
        onPause={() => setPlaying(false)}
        onPlay={() => { setPlaying(true); setEnded(false); }}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        playsInline
      />

      {/* Play button — shown before first play */}
      {!playing && !ended && (
        <div
          onClick={handlePlay}
          style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            background: "rgba(10,9,8,0.85)",
            cursor: "pointer", transition: "background 0.3s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(10,9,8,0.75)"}
          onMouseLeave={e => e.currentTarget.style.background = "rgba(10,9,8,0.85)"}
        >
          <div style={{
            width: 72, height: 72, borderRadius: "50%",
            background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DIM})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 40px rgba(201,169,110,0.25)",
            marginBottom: 16,
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="#1a1814" stroke="none">
              <polygon points="8,5 20,12 8,19" />
            </svg>
          </div>
          <span style={{ fontFamily: SANS, fontSize: 14, fontWeight: 500, color: MUTED }}>
            Watch the demo
          </span>
        </div>
      )}

      {/* CTA overlay — shown when video ends */}
      {ended && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          background: "rgba(10,9,8,0.92)",
          animation: "fadeUp 0.5s ease-out",
        }}>
          <h3 style={{
            fontFamily: SERIF, fontSize: 28, color: CREAM,
            letterSpacing: "-0.02em", marginBottom: 10, textAlign: "center",
          }}>
            <E k="video_cta_title" style={{ fontFamily: SERIF, fontSize: 28, color: CREAM }} />
          </h3>
          <p style={{
            fontFamily: SANS, fontSize: 15, color: MUTED,
            marginBottom: 28, textAlign: "center",
          }}>
            <E k="video_cta_subtitle" style={{ fontFamily: SANS, fontSize: 15, color: MUTED }} />
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            <a href="/signup" style={{
              padding: "13px 32px", borderRadius: 10,
              background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DIM})`,
              color: "#1a1814", fontSize: 15, fontWeight: 600,
              textDecoration: "none", fontFamily: SANS,
              boxShadow: "0 4px 24px rgba(201,169,110,0.25)",
            }}>
              <E k="video_cta_button" style={{ fontSize: 15, fontWeight: 600, color: "#1a1814", fontFamily: SANS }} />
            </a>
            <button
              onClick={handleReplay}
              style={{
                padding: "13px 24px", borderRadius: 10,
                background: "rgba(255,255,255,0.06)",
                border: `1px solid ${CARD_BORDER}`,
                color: MUTED, fontSize: 14, fontWeight: 500,
                cursor: "pointer", fontFamily: SANS,
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 105.64-11.36L1 10"/>
              </svg>
              Replay
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── DELIVERABLES ──────────────────────────────────────────────────
function Deliverables() {
  const items = [
    { tK: "del1_title", dK: "del1_desc", fmt: ".xlsx", sheets: ["Claims Register","Underwriting Gates","Workstream Plan","Interdependency Pairs","Thesis Pillars","Validation Checks"] },
    { tK: "del2_title", dK: "del2_desc", fmt: ".docx", sheets: ["Thesis Overview","Claim Deep-Dives","Existential Threats","Appendix"] },
  ];

  return (
    <section id="deliverables" style={{ padding: "100px 40px", maxWidth: 1100, margin: "0 auto" }}>
      <Reveal>
        <SectionLabel k="del_label" />
        <h2 style={{ fontFamily: SERIF, fontSize: 42, color: CREAM, letterSpacing: "-0.02em", marginBottom: 16, lineHeight: 1.15 }}>
          <E k="del_title" style={{ fontFamily: SERIF, fontSize: 42, color: CREAM }} />
        </h2>
        <div style={{ maxWidth: 560, marginBottom: 56 }}>
          <E k="del_subtitle" tag="p" style={{ fontFamily: SANS, fontSize: 16, color: MUTED, lineHeight: 1.7 }} />
        </div>
      </Reveal>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {items.map((item, i) => (
          <Reveal key={i} delay={i * 120}>
            <div style={{
              background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 14,
              padding: "36px", display: "flex", gap: 40, alignItems: "flex-start", transition: "border-color 0.3s",
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(201,169,110,0.12)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = CARD_BORDER}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
                  <E k={item.tK} tag="h3" style={{ fontFamily: SERIF, fontSize: 24, color: CREAM, fontWeight: 400 }} />
                  <span style={{ fontFamily: MONO, fontSize: 11, color: GOLD_DIM, background: "rgba(201,169,110,0.08)", padding: "3px 8px", borderRadius: 4 }}>{item.fmt}</span>
                </div>
                <E k={item.dK} tag="p" style={{ fontFamily: SANS, fontSize: 14.5, color: MUTED, lineHeight: 1.7 }} />
              </div>
              <div style={{ flexShrink: 0, width: 200 }}>
                <div style={{ fontSize: 11, color: DIM, fontFamily: SANS, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Contains</div>
                {item.sheets.map((s, j) => (
                  <div key={j} style={{
                    fontFamily: MONO, fontSize: 12, color: "#7a7568", padding: "5px 0",
                    borderBottom: j < item.sheets.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
                  }}>{s}</div>
                ))}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ── PIPELINE ──────────────────────────────────────────────────────
function Pipeline() {
  const stages = [
    { label: "Pass 1", name: "Quality Gate + Claims", tokens: "24K" },
    { label: "Stage 2", name: "Underwriting Gates", tokens: "16K" },
    { label: "Stage 3", name: "Workstream Execution", tokens: "16K" },
    { label: "Stage 4", name: "Interdependency Analysis", tokens: "32K" },
    { label: "Stage 5", name: "Thesis Pillars", tokens: "16K" },
    { label: "IC Insights", name: "Narrative Synthesis", tokens: "16K" },
  ];

  return (
    <section style={{ padding: "100px 40px", maxWidth: 1100, margin: "0 auto" }}>
      <Reveal>
        <SectionLabel k="engine_label" />
        <h2 style={{ fontFamily: SERIF, fontSize: 42, color: CREAM, letterSpacing: "-0.02em", marginBottom: 16, lineHeight: 1.15 }}>
          <E k="engine_title" style={{ fontFamily: SERIF, fontSize: 42, color: CREAM }} />
        </h2>
        <div style={{ maxWidth: 540, marginBottom: 56 }}>
          <E k="engine_subtitle" tag="p" style={{ fontFamily: SANS, fontSize: 16, color: MUTED, lineHeight: 1.7 }} />
        </div>
      </Reveal>
      <div style={{ position: "relative" }}>
        <div style={{
          position: "absolute", left: 27, top: 28, bottom: 28, width: 1,
          background: `linear-gradient(to bottom, ${GOLD}22, ${GOLD}44, ${GOLD}22)`,
        }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {stages.map((s, i) => (
            <Reveal key={i} delay={i * 80}>
              <div style={{
                display: "flex", alignItems: "center", gap: 20,
                padding: "16px 20px", borderRadius: 10,
                background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.03)",
                transition: "background 0.3s, border-color 0.3s",
              }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(201,169,110,0.04)"; e.currentTarget.style.borderColor = "rgba(201,169,110,0.1)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.015)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.03)"; }}>
                <div style={{
                  width: 16, height: 16, borderRadius: "50%", background: BG,
                  border: `2px solid ${GOLD}66`, flexShrink: 0, position: "relative", zIndex: 1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: GOLD }} />
                </div>
                <span style={{ fontFamily: MONO, fontSize: 11, color: GOLD_DIM, width: 80, flexShrink: 0, fontWeight: 500 }}>{s.label}</span>
                <span style={{ fontFamily: SANS, fontSize: 14, color: CREAM, flex: 1, fontWeight: 500 }}>{s.name}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: DIM, background: "rgba(255,255,255,0.03)", padding: "3px 10px", borderRadius: 4 }}>{s.tokens} tokens</span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── PRICING ───────────────────────────────────────────────────────
function Pricing() {
  const coreF = ["Claim register + gates","Workstream plan","Interdependency matrix","Thesis pillars","IC Insights narrative"];
  const fullF = ["Everything in Core","Extended claim surface (6+ per major)","80+ interdependency pairs","Deeper threat analysis","Expanded ops coverage"];

  return (
    <section id="pricing" style={{ padding: "100px 40px", maxWidth: 1100, margin: "0 auto" }}>
      <Reveal>
        <SectionLabel k="pricing_label" />
        <h2 style={{ fontFamily: SERIF, fontSize: 42, color: CREAM, letterSpacing: "-0.02em", marginBottom: 56, lineHeight: 1.15 }}>
          <E k="pricing_title" style={{ fontFamily: SERIF, fontSize: 42, color: CREAM }} />
        </h2>
      </Reveal>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, maxWidth: 740 }}>
        <Reveal delay={0}>
          <div style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 14, padding: "36px 32px" }}>
            <div style={{ fontFamily: MONO, fontSize: 11, color: GOLD_DIM, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16, fontWeight: 500 }}>Core</div>
            <div style={{ fontFamily: SERIF, fontSize: 36, color: CREAM, marginBottom: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
              <E k="core_claims" style={{ fontFamily: SERIF, fontSize: 36, color: CREAM }} />
              <span style={{ fontSize: 18, color: MUTED, fontFamily: SERIF }}>claims</span>
            </div>
            <div style={{ marginBottom: 24 }}><E k="core_desc" tag="p" style={{ fontFamily: SANS, fontSize: 13.5, color: MUTED, lineHeight: 1.65 }} /></div>
            <div style={{ borderTop: `1px solid ${CARD_BORDER}`, paddingTop: 16 }}>
              {coreF.map((f,i) => <div key={i} style={{ fontFamily: SANS, fontSize: 13, color: "#7a7568", padding: "6px 0", display: "flex", alignItems: "center", gap: 8 }}><span style={{ color: GOLD, fontSize: 14 }}>✓</span> {f}</div>)}
            </div>
          </div>
        </Reveal>
        <Reveal delay={120}>
          <div style={{
            background: "rgba(201,169,110,0.03)", border: "1px solid rgba(201,169,110,0.12)",
            borderRadius: 14, padding: "36px 32px", position: "relative", overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", top: 0, right: 0,
              background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DIM})`,
              color: "#1a1814", fontSize: 10, fontWeight: 700,
              padding: "4px 14px", borderBottomLeftRadius: 8,
              fontFamily: SANS, textTransform: "uppercase", letterSpacing: "0.06em",
            }}>Deep dive</div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: GOLD, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16, fontWeight: 500 }}>Full</div>
            <div style={{ fontFamily: SERIF, fontSize: 36, color: CREAM, marginBottom: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
              <E k="full_claims" style={{ fontFamily: SERIF, fontSize: 36, color: CREAM }} />
              <span style={{ fontSize: 18, color: MUTED, fontFamily: SERIF }}>claims</span>
            </div>
            <div style={{ marginBottom: 24 }}><E k="full_desc" tag="p" style={{ fontFamily: SANS, fontSize: 13.5, color: MUTED, lineHeight: 1.65 }} /></div>
            <div style={{ borderTop: "1px solid rgba(201,169,110,0.08)", paddingTop: 16 }}>
              {fullF.map((f,i) => <div key={i} style={{ fontFamily: SANS, fontSize: 13, color: "#7a7568", padding: "6px 0", display: "flex", alignItems: "center", gap: 8 }}><span style={{ color: GOLD, fontSize: 14 }}>✓</span> {f}</div>)}
            </div>
          </div>
        </Reveal>
      </div>
      <Reveal delay={200}>
        <div style={{ marginTop: 24 }}><E k="pricing_note" tag="p" style={{ fontFamily: SANS, fontSize: 13, color: DIM, lineHeight: 1.6 }} /></div>
      </Reveal>
    </section>
  );
}

// ── TRUST / SECURITY ──────────────────────────────────────────────
function Trust() {
  const items = [
    { tK: "trust1_title", dK: "trust1_desc", icon: <ShieldIcon /> },
    { tK: "trust2_title", dK: "trust2_desc", icon: <LockIcon /> },
    { tK: "trust3_title", dK: "trust3_desc", icon: <ClockIcon /> },
    { tK: "trust4_title", dK: "trust4_desc", icon: <UserCheckIcon /> },
  ];

  return (
    <section id="security" style={{ padding: "100px 40px", maxWidth: 1100, margin: "0 auto" }}>
      <Reveal>
        <SectionLabel k="trust_label" />
        <h2 style={{ fontFamily: SERIF, fontSize: 42, color: CREAM, letterSpacing: "-0.02em", marginBottom: 12, lineHeight: 1.15 }}>
          <E k="trust_title" style={{ fontFamily: SERIF, fontSize: 42, color: CREAM }} />
        </h2>
        <div style={{ maxWidth: 540, marginBottom: 56 }}>
          <E k="trust_subtitle" tag="p" style={{ fontFamily: SANS, fontSize: 16, color: MUTED, lineHeight: 1.7 }} />
        </div>
      </Reveal>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {items.map((item, i) => (
          <Reveal key={i} delay={i * 100}>
            <div style={{
              background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 14,
              padding: "28px 28px", display: "flex", gap: 20, alignItems: "flex-start",
              transition: "border-color 0.3s, background 0.3s",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(201,169,110,0.15)"; e.currentTarget.style.background = "rgba(255,255,255,0.035)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = CARD_BORDER; e.currentTarget.style.background = CARD_BG; }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: "rgba(201,169,110,0.06)", border: "1px solid rgba(201,169,110,0.1)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                {item.icon}
              </div>
              <div>
                <div style={{ marginBottom: 6 }}>
                  <E k={item.tK} tag="h3" style={{ fontFamily: SANS, fontSize: 15, color: CREAM, fontWeight: 600 }} />
                </div>
                <E k={item.dK} tag="p" style={{ fontFamily: SANS, fontSize: 13.5, color: MUTED, lineHeight: 1.65 }} />
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ── FINAL CTA ─────────────────────────────────────────────────────
function FinalCTA() {
  return (
    <section style={{ padding: "80px 40px 100px", maxWidth: 1100, margin: "0 auto", textAlign: "center" }}>
      <Reveal>
        <div style={{
          background: "linear-gradient(135deg, rgba(201,169,110,0.06), rgba(201,169,110,0.02))",
          border: "1px solid rgba(201,169,110,0.1)", borderRadius: 20, padding: "64px 40px",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: -100, left: "50%", transform: "translateX(-50%)",
            width: 500, height: 300,
            background: "radial-gradient(ellipse, rgba(201,169,110,0.08) 0%, transparent 70%)",
            pointerEvents: "none",
          }} />
          <div style={{ position: "relative" }}>
            <h2 style={{ fontFamily: SERIF, fontSize: 38, color: CREAM, letterSpacing: "-0.02em", marginBottom: 16 }}>
              <E k="cta_title" style={{ fontFamily: SERIF, fontSize: 38, color: CREAM }} />
            </h2>
            <div style={{ maxWidth: 440, margin: "0 auto 32px" }}>
              <E k="cta_subtitle" tag="p" style={{ fontFamily: SANS, fontSize: 15, color: MUTED, lineHeight: 1.7 }} />
            </div>
            <a href="/signup" style={{
              display: "inline-block", padding: "15px 40px", borderRadius: 10,
              background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DIM})`,
              color: "#1a1814", fontSize: 15, fontWeight: 600, textDecoration: "none", fontFamily: SANS,
              boxShadow: "0 4px 24px rgba(201,169,110,0.25)",
            }}>
              <E k="cta_button" style={{ fontSize: 15, fontWeight: 600, color: "#1a1814", fontFamily: SANS }} />
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// ── FOOTER ────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer style={{
      padding: "40px 40px 80px", maxWidth: 1100, margin: "0 auto",
      borderTop: `1px solid ${CARD_BORDER}`,
      display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 24, height: 24, borderRadius: 5,
          background: `linear-gradient(135deg, ${GOLD}44, ${GOLD_DIM}44)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700, color: GOLD_DIM, fontFamily: SERIF,
        }}>CS</div>
        <E k="footer_entity" style={{ fontFamily: SANS, fontSize: 13, color: DIM }} />
      </div>
      <div style={{ fontFamily: SANS, fontSize: 12, color: "#4a4540" }}>© {new Date().getFullYear()} True Bearing LLC. All rights reserved.</div>
    </footer>
  );
}

// ── SHARED ────────────────────────────────────────────────────────
function SectionLabel({ k }) {
  return (
    <div style={{
      display: "inline-block", padding: "6px 14px", borderRadius: 20,
      background: "rgba(201,169,110,0.06)", border: "1px solid rgba(201,169,110,0.1)", marginBottom: 20,
    }}>
      <E k={k} style={{ fontSize: 11, fontWeight: 600, color: GOLD_DIM, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: SANS }} />
    </div>
  );
}

// ── ICONS ─────────────────────────────────────────────────────────
const iconProps = { width: 28, height: 28, viewBox: "0 0 24 24", fill: "none", stroke: GOLD, strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" };
function MailIcon() { return <svg {...iconProps}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13L2 4"/></svg>; }
function GearIcon() { return <svg {...iconProps}><path d="M12 3v1.5M12 19.5V21M4.22 4.22l1.06 1.06M17.72 17.72l1.06 1.06M3 12h1.5M19.5 12H21M4.22 19.78l1.06-1.06M17.72 6.28l1.06-1.06"/><circle cx="12" cy="12" r="4.5"/></svg>; }
function ListIcon() { return <svg {...iconProps}><path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2.5"/></svg>; }
function FileIcon() { return <svg {...iconProps}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l3 3 3-3"/><path d="M12 12v6"/></svg>; }
const trustIconProps = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: GOLD, strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" };
function ShieldIcon() { return <svg {...trustIconProps}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
function LockIcon() { return <svg {...trustIconProps}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>; }
function ClockIcon() { return <svg {...trustIconProps}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>; }
function UserCheckIcon() { return <svg {...trustIconProps}><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>; }
