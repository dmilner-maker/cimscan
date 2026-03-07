"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── CONFIG ──────────────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

// ── SIGNUP PAGE ─────────────────────────────────────────────────────
export default function SignupPage() {
  const [step, setStep] = useState("form"); // "form" | "success"
  const [isNewFirm, setIsNewFirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Shared fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  // Existing firm
  const [selectedFirm, setSelectedFirm] = useState(null);

  // New firm
  const [newFirmName, setNewFirmName] = useState("");
  const [newFirmWebsite, setNewFirmWebsite] = useState("");
  const [newFirmAddress, setNewFirmAddress] = useState("");
  const [newFirmPhone, setNewFirmPhone] = useState("");

  const canSubmit = () => {
    if (!email || !password || !displayName) return false;
    if (password.length < 8) return false;
    if (isNewFirm) return newFirmName && newFirmWebsite;
    return !!selectedFirm;
  };

  const handleSubmit = async () => {
    if (!canSubmit()) return;
    setLoading(true);
    setError(null);

    const body = isNewFirm
      ? {
          email,
          password,
          display_name: displayName,
          new_firm_name: newFirmName,
          new_firm_website: newFirmWebsite,
          new_firm_address: newFirmAddress || undefined,
          new_firm_phone: newFirmPhone || undefined,
        }
      : {
          email,
          password,
          display_name: displayName,
          firm_id: selectedFirm.id,
        };

    try {
      const res = await fetch(`${API_BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signup failed");
      setStep("success");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── SUCCESS STATE ───────────────────────────────────────────────
  if (step === "success") {
    return (
      <Shell>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 420,
            textAlign: "center",
            animation: "fadeUp 0.5s ease-out",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #10b981, #059669)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 28,
              boxShadow: "0 0 40px rgba(16,185,129,0.25)",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2
            style={{
              fontFamily: "'DM Serif Display', Georgia, serif",
              fontSize: 28,
              fontWeight: 400,
              color: "#f0ebe3",
              margin: "0 0 12px",
              letterSpacing: "-0.01em",
            }}
          >
            Verify your email
          </h2>
          <p
            style={{
              fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
              fontSize: 15,
              color: "#9a9488",
              lineHeight: 1.6,
              maxWidth: 360,
              margin: 0,
            }}
          >
            We sent a verification link to{" "}
            <span style={{ color: "#d4cfc6", fontWeight: 500 }}>{email}</span>.
            <br />
            Check your inbox and click the link to activate your account.
          </p>
          <div
            style={{
              marginTop: 32,
              padding: "14px 20px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 10,
              fontSize: 13,
              color: "#7a7568",
              fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
              lineHeight: 1.5,
            }}
          >
            Once verified, email any CIM to your firm's ingest address and CIMScan takes it from there.
          </div>
        </div>
      </Shell>
    );
  }

  // ── FORM STATE ──────────────────────────────────────────────────
  return (
    <Shell>
      <div style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontFamily: "'DM Serif Display', Georgia, serif",
            fontSize: 32,
            fontWeight: 400,
            color: "#f0ebe3",
            margin: "0 0 8px",
            letterSpacing: "-0.02em",
          }}
        >
          Create your account
        </h1>
        <p
          style={{
            fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
            fontSize: 14.5,
            color: "#8a8478",
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          Join your firm or register a new one to start scanning CIMs.
        </p>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* ── Your info ── */}
        <FieldGroup label="Your info">
          <Field label="Full name" required>
            <Input value={displayName} onChange={setDisplayName} placeholder="Jane Smith" />
          </Field>
          <Field label="Work email" required>
            <Input value={email} onChange={setEmail} type="email" placeholder="jane@totalcap.com" />
          </Field>
          <Field label="Password" required hint="Min 8 characters">
            <Input value={password} onChange={setPassword} type="password" placeholder="••••••••" />
          </Field>
        </FieldGroup>

        {/* ── Firm ── */}
        <FieldGroup label="Your firm">
          {!isNewFirm ? (
            <>
              <Field label="Search for your firm" required>
                <FirmSearch selected={selectedFirm} onSelect={setSelectedFirm} />
              </Field>
              <button
                onClick={() => {
                  setIsNewFirm(true);
                  setSelectedFirm(null);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#b8a88a",
                  fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
                  fontSize: 13,
                  cursor: "pointer",
                  padding: "4px 0 0",
                  textAlign: "left",
                  textDecoration: "underline",
                  textDecorationColor: "rgba(184,168,138,0.3)",
                  textUnderlineOffset: 3,
                }}
              >
                My firm isn't listed
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setIsNewFirm(false);
                  setNewFirmName("");
                  setNewFirmWebsite("");
                  setNewFirmAddress("");
                  setNewFirmPhone("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#b8a88a",
                  fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
                  fontSize: 13,
                  cursor: "pointer",
                  padding: "0 0 4px",
                  textAlign: "left",
                  textDecoration: "underline",
                  textDecorationColor: "rgba(184,168,138,0.3)",
                  textUnderlineOffset: 3,
                }}
              >
                ← Search existing firms instead
              </button>
              <Field label="Firm name" required>
                <Input value={newFirmName} onChange={setNewFirmName} placeholder="Total Capital Partners" />
              </Field>
              <Field label="Firm website" required>
                <Input value={newFirmWebsite} onChange={setNewFirmWebsite} placeholder="totalcap.com" />
              </Field>
              <Field label="Address">
                <Input value={newFirmAddress} onChange={setNewFirmAddress} placeholder="123 Park Ave, New York, NY 10017" />
              </Field>
              <Field label="Phone">
                <Input value={newFirmPhone} onChange={setNewFirmPhone} placeholder="(212) 555-0100" />
              </Field>
            </>
          )}
        </FieldGroup>
      </div>

      {/* ── Submit ── */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit() || loading}
        style={{
          marginTop: 28,
          width: "100%",
          padding: "14px 0",
          background: canSubmit() && !loading
            ? "linear-gradient(135deg, #c9a96e, #b8944e)"
            : "rgba(255,255,255,0.06)",
          color: canSubmit() && !loading ? "#1a1814" : "#5a5550",
          border: "none",
          borderRadius: 10,
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
          fontSize: 15,
          fontWeight: 600,
          cursor: canSubmit() && !loading ? "pointer" : "not-allowed",
          letterSpacing: "0.01em",
          transition: "all 0.2s ease",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {loading ? (
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Spinner /> Creating account…
          </span>
        ) : (
          "Create account"
        )}
      </button>

      <p
        style={{
          textAlign: "center",
          fontSize: 13,
          color: "#6a6560",
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
          marginTop: 20,
          marginBottom: 0,
        }}
      >
        Already have an account?{" "}
        <a
          href="/login"
          style={{
            color: "#b8a88a",
            textDecoration: "underline",
            textDecorationColor: "rgba(184,168,138,0.3)",
            textUnderlineOffset: 3,
          }}
        >
          Sign in
        </a>
      </p>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function Shell({ children }) {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=IBM+Plex+Sans:wght@400;500;600&display=swap');

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        * { box-sizing: border-box; }

        /* Subtle noise texture via SVG */
        .shell-bg::before {
          content: '';
          position: fixed;
          inset: 0;
          opacity: 0.035;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
          pointer-events: none;
          z-index: 0;
        }
      `}</style>
      <div
        className="shell-bg"
        style={{
          minHeight: "100vh",
          background: "linear-gradient(165deg, #1a1814 0%, #141210 40%, #0f0e0c 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 20px",
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 460,
            position: "relative",
            zIndex: 1,
            animation: "fadeUp 0.45s ease-out",
          }}
        >
          {/* Logo / brand */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 36,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "linear-gradient(135deg, #c9a96e 0%, #8a7448 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                fontWeight: 700,
                color: "#1a1814",
                fontFamily: "'DM Serif Display', Georgia, serif",
                letterSpacing: "-0.02em",
              }}
            >
              CS
            </div>
            <span
              style={{
                fontFamily: "'DM Serif Display', Georgia, serif",
                fontSize: 20,
                color: "#d4cfc6",
                letterSpacing: "0.02em",
              }}
            >
              CIMScan
            </span>
          </div>

          {/* Card */}
          <div
            style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 16,
              padding: "36px 32px 32px",
              backdropFilter: "blur(20px)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03) inset",
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

function FieldGroup({ label, children }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#6a6258",
          marginBottom: 14,
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, required, hint, children }) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: 13,
          fontWeight: 500,
          color: "#a09888",
          marginBottom: 6,
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        }}
      >
        {label}
        {required && <span style={{ color: "#c9a96e", marginLeft: 3 }}>*</span>}
        {hint && (
          <span style={{ color: "#5a5550", fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
            {hint}
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "11px 14px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  color: "#e8e2d8",
  fontSize: 14,
  fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
  outline: "none",
  transition: "border-color 0.2s ease, box-shadow 0.2s ease",
};

function Input({ value, onChange, type = "text", placeholder }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={inputStyle}
      onFocus={(e) => {
        e.target.style.borderColor = "rgba(201,169,110,0.4)";
        e.target.style.boxShadow = "0 0 0 3px rgba(201,169,110,0.08)";
      }}
      onBlur={(e) => {
        e.target.style.borderColor = "rgba(255,255,255,0.08)";
        e.target.style.boxShadow = "none";
      }}
    />
  );
}

// ── Firm Search (debounced, dropdown) ────────────────────────────
function FirmSearch({ selected, onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);

  const search = useCallback(async (q) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`${API_BASE}/api/firms?search=${encodeURIComponent(q)}&limit=20`);
      const data = await res.json();
      setResults(data.firms || data || []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 250);
    return () => clearTimeout(debounceRef.current);
  }, [query, search]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (selected) {
    return (
      <div
        style={{
          ...inputStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "rgba(201,169,110,0.06)",
          borderColor: "rgba(201,169,110,0.2)",
        }}
      >
        <div>
          <span style={{ color: "#e8e2d8", fontWeight: 500 }}>{selected.name}</span>
          {selected.website && (
            <span style={{ color: "#6a6258", fontSize: 12, marginLeft: 8 }}>{selected.website}</span>
          )}
        </div>
        <button
          onClick={() => {
            onSelect(null);
            setQuery("");
          }}
          style={{
            background: "none",
            border: "none",
            color: "#8a7a68",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            padding: "0 0 0 8px",
          }}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => query.length >= 2 && setOpen(true)}
          placeholder="Start typing a firm name…"
          style={inputStyle}
          onFocusCapture={(e) => {
            e.target.style.borderColor = "rgba(201,169,110,0.4)";
            e.target.style.boxShadow = "0 0 0 3px rgba(201,169,110,0.08)";
          }}
          onBlurCapture={(e) => {
            e.target.style.borderColor = "rgba(255,255,255,0.08)";
            e.target.style.boxShadow = "none";
          }}
        />
        {searching && (
          <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>
            <Spinner />
          </div>
        )}
      </div>

      {open && results.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: "#1e1c18",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            maxHeight: 240,
            overflowY: "auto",
            zIndex: 50,
            boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          }}
        >
          {results.map((firm) => (
            <button
              key={firm.id}
              onClick={() => {
                onSelect(firm);
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "10px 14px",
                background: "none",
                border: "none",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,169,110,0.06)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <div style={{ color: "#e0dbd0", fontSize: 14, fontWeight: 500 }}>{firm.name}</div>
              {firm.website && (
                <div style={{ color: "#6a6258", fontSize: 12, marginTop: 2 }}>{firm.website}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {open && query.length >= 2 && !searching && results.length === 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: "#1e1c18",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            padding: "16px 14px",
            zIndex: 50,
            boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
            color: "#6a6258",
            fontSize: 13,
            textAlign: "center",
            fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
          }}
        >
          No firms found matching "{query}"
        </div>
      )}
    </div>
  );
}

function ErrorBanner({ message, onDismiss }) {
  return (
    <div
      style={{
        background: "rgba(220,80,60,0.08)",
        border: "1px solid rgba(220,80,60,0.2)",
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 20,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <p
        style={{
          margin: 0,
          color: "#e8a090",
          fontSize: 13,
          lineHeight: 1.5,
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        }}
      >
        {message}
      </p>
      <button
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          color: "#e8a090",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <div
      style={{
        width: 16,
        height: 16,
        border: "2px solid rgba(201,169,110,0.15)",
        borderTopColor: "#c9a96e",
        borderRadius: "50%",
        animation: "spin 0.6s linear infinite",
        display: "inline-block",
      }}
    />
  );
}
