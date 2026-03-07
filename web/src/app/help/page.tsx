"use client";
import { useState } from "react";

// ── Design tokens ──────────────────────────────────────────────────
const BG      = "#0f0e0c";
const CREAM   = "#f0ebe3";
const MUTED   = "#9a9488";
const DIM     = "#6a6258";
const GOLD    = "#c9a96e";
const GOLD_DIM = "#8a7448";
const CARD_BORDER = "rgba(255,255,255,0.07)";
const SERIF   = "'DM Serif Display', Georgia, serif";
const SANS    = "'IBM Plex Sans', Arial, sans-serif";
const MONO    = "'IBM Plex Mono', 'Courier New', monospace";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

// ── Data ───────────────────────────────────────────────────────────

const HOW_TO_STEPS = [
  {
    n: "1",
    title: "Sign up and verify your email",
    body: "Create an account at cimscan.ai/signup. After signup you will receive a verification email — click the link to activate your account. Once verified, you will receive a second welcome email containing your firm's unique ingest email address.",
  },
  {
    n: "2",
    title: "Email a CIM to your ingest address",
    body: "Attach the CIM as a PDF and send it to your firm's unique ingest address (e.g. firmname@ingest.cimscan.ai). The subject line is ignored — CIMScan reads the attachment. Only registered users at your firm can trigger a scan.",
  },
  {
    n: "3",
    title: "Configure your scan",
    body: "Within a few minutes you will receive a confirmation email. Open it, choose your scan depth (CORE or FULL), review and accept the CIMScan Terms of Service, and confirm payment. Your first scan is free — no credit card required.",
  },
  {
    n: "4",
    title: "Receive your deliverables",
    body: "When the pipeline completes you will receive an email with two attachments: Dataset D (an Excel workbook with structured diligence data) and IC Insights (a narrative analysis document). Turnaround is typically 15–30 minutes for CORE and 45–90 minutes for FULL.",
  },
];

const GLOSSARY = [
  { term: "CIM", def: "Confidential Information Memorandum. The primary marketing document provided by a seller or their banker describing a business for sale. CIMScan ingests CIMs in PDF form." },
  { term: "Ingest Address", def: "Your firm's unique email address on the ingest.cimscan.ai domain. Sending a CIM PDF to this address initiates the scan workflow." },
  { term: "CORE Depth", def: "A focused scan extracting 25–30 high-priority diligence claims from the CIM. Best for rapid screening. Priced at $249 per scan." },
  { term: "FULL Depth", def: "A comprehensive scan extracting up to 60 diligence claims across all major sections. Best for IC preparation. Priced at $399 per scan." },
  { term: "Claim", def: "A discrete, verifiable assertion extracted from the CIM — e.g. \"Revenue grew 28% YoY in FY2024.\" Each claim includes source page reference and confidence level." },
  { term: "Dataset D", def: "The structured Excel deliverable. Contains all extracted claims organized by diligence category, with source citations, confidence scores, and a deal summary tab." },
  { term: "IC Insights", def: "The narrative deliverable. A Word-format document synthesizing key findings into a coherent analysis suitable as a starting point for IC materials." },
  { term: "First-Run-Free", def: "A promotional promo code issued to each new firm at signup. Covers one scan at either CORE or FULL depth at no charge." },
  { term: "Pipeline", def: "The automated processing sequence CIMScan runs after a CIM is received and payment confirmed — extraction, structuring, scoring, and document generation." },
  { term: "Confidence Score", def: "A rating (High / Medium / Low) assigned to each extracted claim indicating how explicitly and clearly the claim is supported by the CIM text." },
];

const INTERPRET = [
  {
    title: "Dataset D — Structure",
    body: "Dataset D is organized into tabbed sections by diligence category: Business Overview, Financial Performance, Market & Competition, Management & Operations, Risk Factors, and a Summary tab. Each row in the category tabs is a single claim with columns for the claim text, source page, confidence score, and analyst notes (blank by default, for your use).",
  },
  {
    title: "Reading confidence scores",
    body: "High confidence means the claim is stated explicitly and numerically in the CIM with a clear source. Medium means it is implied or requires minor inference. Low means it is present but ambiguous, contradictory, or unsupported by data. Low-confidence claims warrant direct seller follow-up.",
  },
  {
    title: "IC Insights — Purpose and Scope",
    body: "IC Insights is not a finished IC memo — it is a structured starting point. It synthesizes CIMScan's extracted claims into narrative form organized around the key questions an investment committee typically asks. Expect to augment it with your own analysis, market data, and management call notes.",
  },
  {
    title: "What CIMScan does not do",
    body: "CIMScan extracts and structures what is in the CIM. It does not verify claims against external data, perform market comparables analysis, assess management quality, or predict outcomes. All extracted claims should be treated as seller representations pending your own diligence.",
  },
  {
    title: "When claims seem missing",
    body: "If a claim category appears sparse, it typically means the CIM does not address that area in depth — not that the pipeline missed it. FULL depth increases coverage significantly. If you believe the pipeline has missed material content, contact support.",
  },
];

// ── Components ─────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div style={{
      display: "inline-block", padding: "6px 14px", borderRadius: 20,
      background: "rgba(201,169,110,0.06)", border: "1px solid rgba(201,169,110,0.1)",
      marginBottom: 20,
    }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: GOLD_DIM, letterSpacing: "0.06em", textTransform: "uppercase" as const, fontFamily: SANS }}>
        {label}
      </span>
    </div>
  );
}

function Card({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)", border: `1px solid ${CARD_BORDER}`,
      borderRadius: 12, padding: "24px 28px", ...style,
    }}>
      {children}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────

export default function HelpPage() {
  const [activeTab, setActiveTab] = useState<"howto" | "glossary" | "interpret" | "contact">("howto");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const handleSubmit = async () => {
    if (!name.trim() || !email.trim() || !message.trim()) return;
    setStatus("sending");
    try {
      const res = await fetch(`${API_URL}/api/support`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });
      if (!res.ok) throw new Error("Failed");
      setStatus("sent");
      setName(""); setEmail(""); setMessage("");
    } catch {
      setStatus("error");
    }
  };

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: "howto",    label: "How To" },
    { id: "glossary", label: "Glossary" },
    { id: "interpret",label: "Interpreting Outputs" },
    { id: "contact",  label: "Contact Support" },
  ];

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: SANS }}>
      {/* Nav */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        padding: "0 40px", height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(15,14,12,0.92)", backdropFilter: "blur(16px)",
        borderBottom: `1px solid ${CARD_BORDER}`, fontFamily: SANS,
      }}>
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <div style={{
            width: 32, height: 32, borderRadius: 7,
            background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DIM})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 700, color: "#1a1814", fontFamily: SERIF,
          }}>CS</div>
          <span style={{ fontFamily: SERIF, fontSize: 18, color: "#d4cfc6", letterSpacing: "0.02em" }}>CIMScan</span>
        </a>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <a href="/login" style={{ color: MUTED, textDecoration: "none", fontSize: 13, fontWeight: 500 }}>Sign in</a>
          <a href="/signup" style={{
            padding: "8px 20px", borderRadius: 8,
            background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DIM})`,
            color: "#1a1814", fontSize: 13, fontWeight: 600, textDecoration: "none",
          }}>Get started</a>
        </div>
      </nav>

      {/* Page content */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "120px 40px 80px" }}>

        {/* Header */}
        <div style={{ marginBottom: 48 }}>
          <SectionLabel label="Help Center" />
          <h1 style={{ fontFamily: SERIF, fontSize: 42, fontWeight: 400, color: CREAM, margin: "0 0 16px", letterSpacing: "-0.02em" }}>
            How can we help?
          </h1>
          <p style={{ fontFamily: SANS, fontSize: 16, color: MUTED, margin: 0, lineHeight: 1.6, maxWidth: 560 }}>
            Documentation, glossary, output guidance, and direct support — everything you need to get the most out of CIMScan.
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 40, borderBottom: `1px solid ${CARD_BORDER}`, paddingBottom: 0 }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "10px 20px", background: "none", border: "none",
                borderBottom: activeTab === tab.id ? `2px solid ${GOLD}` : "2px solid transparent",
                color: activeTab === tab.id ? CREAM : MUTED,
                fontSize: 14, fontWeight: activeTab === tab.id ? 600 : 400,
                fontFamily: SANS, cursor: "pointer", marginBottom: -1,
                transition: "color 0.2s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── HOW TO ── */}
        {activeTab === "howto" && (
          <div>
            <p style={{ fontFamily: SANS, fontSize: 14, color: MUTED, marginBottom: 32, lineHeight: 1.7 }}>
              CIMScan is an email-native workflow. There is no portal to upload files — everything happens through email. Here is how to run your first scan.
            </p>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
              {HOW_TO_STEPS.map(step => (
                <Card key={step.n} style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
                  <div style={{
                    flexShrink: 0, width: 32, height: 32, borderRadius: "50%",
                    background: "rgba(201,169,110,0.1)", border: "1px solid rgba(201,169,110,0.25)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: SANS, fontSize: 13, fontWeight: 700, color: GOLD,
                  }}>{step.n}</div>
                  <div>
                    <p style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, color: CREAM, margin: "0 0 8px" }}>{step.title}</p>
                    <p style={{ fontFamily: SANS, fontSize: 14, color: MUTED, margin: 0, lineHeight: 1.7 }}>{step.body}</p>
                  </div>
                </Card>
              ))}
            </div>
            <div style={{ marginTop: 32, padding: "16px 20px", borderRadius: 8, background: "rgba(201,169,110,0.04)", border: "1px solid rgba(201,169,110,0.12)" }}>
              <p style={{ fontFamily: SANS, fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.6 }}>
                <span style={{ color: GOLD, fontWeight: 600 }}>Your ingest address</span> was included in your welcome email after you verified your account. If you cannot find it, check your account settings or{" "}
                <span
                  onClick={() => setActiveTab("contact")}
                  style={{ color: GOLD, cursor: "pointer", textDecoration: "underline" }}
                >contact support</span>.
              </p>
            </div>
          </div>
        )}

        {/* ── GLOSSARY ── */}
        {activeTab === "glossary" && (
          <div>
            <p style={{ fontFamily: SANS, fontSize: 14, color: MUTED, marginBottom: 32, lineHeight: 1.7 }}>
              Key terms used throughout CIMScan and its deliverables.
            </p>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 2 }}>
              {GLOSSARY.map((item, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "200px 1fr", gap: 24,
                  padding: "18px 0",
                  borderBottom: i < GLOSSARY.length - 1 ? `1px solid ${CARD_BORDER}` : "none",
                }}>
                  <p style={{ fontFamily: MONO, fontSize: 13, color: GOLD, margin: 0, paddingTop: 2 }}>{item.term}</p>
                  <p style={{ fontFamily: SANS, fontSize: 14, color: MUTED, margin: 0, lineHeight: 1.7 }}>{item.def}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── INTERPRET ── */}
        {activeTab === "interpret" && (
          <div>
            <p style={{ fontFamily: SANS, fontSize: 14, color: MUTED, marginBottom: 32, lineHeight: 1.7 }}>
              How to read and work with your Dataset D and IC Insights deliverables.
            </p>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
              {INTERPRET.map((item, i) => (
                <Card key={i}>
                  <p style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, color: CREAM, margin: "0 0 10px" }}>{item.title}</p>
                  <p style={{ fontFamily: SANS, fontSize: 14, color: MUTED, margin: 0, lineHeight: 1.7 }}>{item.body}</p>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ── CONTACT ── */}
        {activeTab === "contact" && (
          <div style={{ maxWidth: 560 }}>
            <p style={{ fontFamily: SANS, fontSize: 14, color: MUTED, marginBottom: 32, lineHeight: 1.7 }}>
              Send us a message and we will respond directly to your email address, typically within one business day.
            </p>

            {status === "sent" ? (
              <Card style={{ textAlign: "center" as const, padding: "40px 28px" }}>
                <div style={{
                  width: 48, height: 48, borderRadius: "50%", margin: "0 auto 16px",
                  background: "rgba(201,169,110,0.1)", border: "1px solid rgba(201,169,110,0.25)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <p style={{ fontFamily: SERIF, fontSize: 20, color: CREAM, margin: "0 0 8px" }}>Message sent</p>
                <p style={{ fontFamily: SANS, fontSize: 14, color: MUTED, margin: 0 }}>We'll be in touch shortly.</p>
              </Card>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <label style={{ fontFamily: SANS, fontSize: 12, color: DIM, letterSpacing: "0.05em", textTransform: "uppercase" as const, display: "block", marginBottom: 8 }}>Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="Your name"
                      style={{
                        width: "100%", padding: "12px 14px", borderRadius: 8, boxSizing: "border-box" as const,
                        background: "rgba(255,255,255,0.03)", border: `1px solid ${CARD_BORDER}`,
                        color: CREAM, fontFamily: SANS, fontSize: 14, outline: "none",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontFamily: SANS, fontSize: 12, color: DIM, letterSpacing: "0.05em", textTransform: "uppercase" as const, display: "block", marginBottom: 8 }}>Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      style={{
                        width: "100%", padding: "12px 14px", borderRadius: 8, boxSizing: "border-box" as const,
                        background: "rgba(255,255,255,0.03)", border: `1px solid ${CARD_BORDER}`,
                        color: CREAM, fontFamily: SANS, fontSize: 14, outline: "none",
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ fontFamily: SANS, fontSize: 12, color: DIM, letterSpacing: "0.05em", textTransform: "uppercase" as const, display: "block", marginBottom: 8 }}>Message</label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Describe your question or issue..."
                    rows={6}
                    style={{
                      width: "100%", padding: "12px 14px", borderRadius: 8, boxSizing: "border-box" as const,
                      background: "rgba(255,255,255,0.03)", border: `1px solid ${CARD_BORDER}`,
                      color: CREAM, fontFamily: SANS, fontSize: 14, outline: "none",
                      resize: "vertical" as const,
                    }}
                  />
                </div>

                {status === "error" && (
                  <p style={{ fontFamily: SANS, fontSize: 13, color: "#e07070", margin: 0 }}>
                    Something went wrong. Please try again or email us directly at help@truebearingllc.com
                  </p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={status === "sending" || !name.trim() || !email.trim() || !message.trim()}
                  style={{
                    padding: "13px 32px", borderRadius: 8, border: "none", cursor: "pointer",
                    background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DIM})`,
                    color: "#1a1814", fontSize: 14, fontWeight: 600, fontFamily: SANS,
                    opacity: (status === "sending" || !name.trim() || !email.trim() || !message.trim()) ? 0.5 : 1,
                    alignSelf: "flex-start" as const,
                    transition: "opacity 0.2s",
                  }}
                >
                  {status === "sending" ? "Sending..." : "Send message"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer style={{
        maxWidth: 900, margin: "0 auto", padding: "32px 40px 60px",
        borderTop: `1px solid ${CARD_BORDER}`,
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" as const, gap: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 24, height: 24, borderRadius: 5,
            background: `linear-gradient(135deg, ${GOLD}44, ${GOLD_DIM}44)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 700, color: GOLD_DIM, fontFamily: SERIF,
          }}>CS</div>
          <span style={{ fontFamily: SANS, fontSize: 13, color: DIM }}>CIMScan — True Bearing LLC</span>
        </div>
        <span style={{ fontFamily: SANS, fontSize: 12, color: "#4a4540" }}>© {new Date().getFullYear()} True Bearing LLC. All rights reserved.</span>
      </footer>
    </div>
  );
}
