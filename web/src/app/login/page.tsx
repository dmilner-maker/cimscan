'use client'

// web/src/app/login/page.tsx

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

type Mode = 'login' | 'forgot'
type Status = 'idle' | 'loading' | 'success' | 'error'

const T = {
  BG:          '#0f0e0c',
  CARD_BG:     'rgba(255,255,255,0.025)',
  CARD_BORDER: 'rgba(255,255,255,0.06)',
  GOLD:        '#c9a96e',
  GOLD_DIM:    '#8a7448',
  CREAM:       '#f0ebe3',
  MUTED:       '#9a9488',
  DIM:         '#6a6258',
  ERROR:       '#e07070',
  GREEN:       '#6dbf8a',
}

export default function LoginPage() {
  const [mode, setMode]           = useState<Mode>('login')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [status, setStatus]       = useState<Status>('idle')
  const [message, setMessage]     = useState('')
  const [verified, setVerified]   = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('verified') === 'true') {
      setVerified(true)
      // Clean the URL without reloading
      window.history.replaceState({}, '', '/login')
    }
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setMessage('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setStatus('error')
      setMessage(error.message)
      return
    }

    setStatus('success')
    setMessage('Signed in. Redirecting...')
    window.location.href = '/'
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setMessage('')

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!res.ok) throw new Error('Request failed')

      setStatus('success')
      setMessage('Check your inbox — a reset link is on its way.')
    } catch {
      setStatus('error')
      setMessage('Something went wrong. Please try again.')
    }
  }

  function switchMode(next: Mode) {
    setMode(next)
    setStatus('idle')
    setMessage('')
    setPassword('')
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: ${T.BG};
          color: ${T.CREAM};
          font-family: 'IBM Plex Sans', sans-serif;
          min-height: 100vh;
        }

        .login-root {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: ${T.BG};
          background-image:
            radial-gradient(ellipse 80% 50% at 50% -10%, rgba(201,169,110,0.07) 0%, transparent 70%);
        }

        .wordmark {
          display: flex; align-items: center; gap: 10px;
          margin-bottom: 40px; text-decoration: none;
        }
        .wordmark-icon {
          width: 32px; height: 32px;
          border: 1.5px solid ${T.GOLD}; border-radius: 6px;
          display: flex; align-items: center; justify-content: center;
        }
        .wordmark-icon svg { display: block; }
        .wordmark-text {
          font-family: 'DM Serif Display', serif;
          font-size: 20px; color: ${T.CREAM}; letter-spacing: 0.01em;
        }

        /* ── Verified banner ── */
        .verified-banner {
          width: 100%;
          max-width: 400px;
          background: rgba(109,191,138,0.08);
          border: 1px solid rgba(109,191,138,0.25);
          border-radius: 10px;
          padding: 12px 16px;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          color: ${T.GREEN};
          line-height: 1.4;
        }
        .verified-icon {
          flex-shrink: 0;
          width: 18px; height: 18px;
          border-radius: 50%;
          background: rgba(109,191,138,0.15);
          display: flex; align-items: center; justify-content: center;
        }

        .card {
          width: 100%; max-width: 400px;
          background: ${T.CARD_BG};
          border: 1px solid ${T.CARD_BORDER};
          border-radius: 12px;
          padding: 40px 36px 36px;
        }

        .pill {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 10px;
          border: 1px solid rgba(201,169,110,0.3); border-radius: 999px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px; font-weight: 500;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: ${T.GOLD}; margin-bottom: 16px;
        }
        .pill-dot { width: 5px; height: 5px; border-radius: 50%; background: ${T.GOLD}; }

        .heading {
          font-family: 'DM Serif Display', serif;
          font-size: 28px; font-weight: 400; color: ${T.CREAM};
          line-height: 1.2; margin-bottom: 8px;
        }
        .subheading {
          font-size: 14px; color: ${T.MUTED};
          line-height: 1.5; margin-bottom: 32px;
        }

        .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
        .label {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px; font-weight: 500;
          letter-spacing: 0.08em; text-transform: uppercase; color: ${T.DIM};
        }
        .input {
          width: 100%;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px; padding: 11px 14px;
          font-family: 'IBM Plex Sans', sans-serif;
          font-size: 14px; color: ${T.CREAM}; outline: none;
          transition: border-color 0.15s;
        }
        .input::placeholder { color: ${T.DIM}; }
        .input:focus { border-color: ${T.GOLD}; }

        .btn-primary {
          width: 100%; margin-top: 8px; padding: 13px;
          border: none; border-radius: 8px;
          background: linear-gradient(135deg, ${T.GOLD} 0%, ${T.GOLD_DIM} 100%);
          font-family: 'IBM Plex Sans', sans-serif;
          font-size: 14px; font-weight: 600; color: #0f0e0c;
          cursor: pointer; transition: opacity 0.15s, transform 0.1s;
          letter-spacing: 0.02em;
        }
        .btn-primary:hover:not(:disabled) { opacity: 0.88; }
        .btn-primary:active:not(:disabled) { transform: scale(0.99); }
        .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }

        .msg {
          margin-top: 16px; padding: 10px 14px;
          border-radius: 8px; font-size: 13px; line-height: 1.4;
        }
        .msg-error {
          background: rgba(224,112,112,0.08);
          border: 1px solid rgba(224,112,112,0.25);
          color: ${T.ERROR};
        }
        .msg-success {
          background: rgba(201,169,110,0.08);
          border: 1px solid rgba(201,169,110,0.2);
          color: ${T.GOLD};
        }

        .divider { height: 1px; background: ${T.CARD_BORDER}; margin: 28px 0; }

        .footer-row {
          display: flex; align-items: center;
          justify-content: space-between;
          font-size: 13px; color: ${T.MUTED};
        }
        .link {
          color: ${T.GOLD}; background: none; border: none;
          cursor: pointer; font-family: 'IBM Plex Sans', sans-serif;
          font-size: 13px; padding: 0; text-decoration: none;
          transition: opacity 0.15s;
        }
        .link:hover { opacity: 0.7; }

        @keyframes spin { to { transform: rotate(360deg); } }
        .spinner {
          display: inline-block; width: 14px; height: 14px;
          border: 2px solid rgba(15,14,12,0.3);
          border-top-color: #0f0e0c; border-radius: 50%;
          animation: spin 0.7s linear infinite;
          vertical-align: middle; margin-right: 6px;
        }
      `}</style>

      <div className="login-root">

        <a href="/" className="wordmark">
          <div className="wordmark-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 4h10M3 8h7M3 12h5" stroke={T.GOLD} strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="wordmark-text">CIMScan</span>
        </a>

        {verified && (
          <div className="verified-banner">
            <div className="verified-icon">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5l2 2 4-4" stroke={T.GREEN} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span>Email verified — you&apos;re all set. Sign in below to get started.</span>
          </div>
        )}

        <div className="card">

          {mode === 'login' ? (
            <>
              <div className="pill">
                <span className="pill-dot" />
                Secure Access
              </div>
              <h1 className="heading">Sign in to CIMScan</h1>
              <p className="subheading">
                Access your deal pipeline and analysis outputs.
              </p>

              <form onSubmit={handleLogin}>
                <div className="field">
                  <label className="label">Email address</label>
                  <input
                    className="input"
                    type="email"
                    placeholder="you@yourfirm.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>

                <div className="field">
                  <label className="label">Password</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>

                <button
                  className="btn-primary"
                  type="submit"
                  disabled={status === 'loading'}
                >
                  {status === 'loading'
                    ? <><span className="spinner" />Signing in…</>
                    : 'Sign in'}
                </button>
              </form>

              {message && (
                <div className={`msg ${status === 'error' ? 'msg-error' : 'msg-success'}`}>
                  {message}
                </div>
              )}

              <div className="divider" />

              <div className="footer-row">
                <span>
                  Don&apos;t have an account?{' '}
                  <a href="/signup" className="link">Sign up</a>
                </span>
                <button className="link" onClick={() => switchMode('forgot')}>
                  Forgot password
                </button>
              </div>
            </>

          ) : (
            <>
              <div className="pill">
                <span className="pill-dot" />
                Password Reset
              </div>
              <h1 className="heading">Reset your password</h1>
              <p className="subheading">
                Enter your email and we&apos;ll send a reset link. Check your inbox — it expires in 1 hour.
              </p>

              <form onSubmit={handleForgot}>
                <div className="field">
                  <label className="label">Email address</label>
                  <input
                    className="input"
                    type="email"
                    placeholder="you@yourfirm.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>

                <button
                  className="btn-primary"
                  type="submit"
                  disabled={status === 'loading' || status === 'success'}
                >
                  {status === 'loading'
                    ? <><span className="spinner" />Sending…</>
                    : status === 'success'
                    ? 'Email sent'
                    : 'Send reset link'}
                </button>
              </form>

              {message && (
                <div className={`msg ${status === 'error' ? 'msg-error' : 'msg-success'}`}>
                  {message}
                </div>
              )}

              <div className="divider" />

              <div className="footer-row">
                <button className="link" onClick={() => switchMode('login')}>
                  ← Back to sign in
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </>
  )
}
