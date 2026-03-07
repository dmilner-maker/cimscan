'use client'

// web/src/app/reset-password/page.tsx

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

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
}

export default function ResetPasswordPage() {
  const [password, setPassword]         = useState('')
  const [confirm, setConfirm]           = useState('')
  const [status, setStatus]             = useState<Status>('idle')
  const [message, setMessage]           = useState('')
  const [sessionReady, setSessionReady] = useState(false)
  const [checking, setChecking]         = useState(true)

  useEffect(() => {
    // Only activate if URL hash contains a recovery token.
    // This prevents a lingering PASSWORD_RECOVERY session from
    // hijacking unrelated pages after a reset is complete.
    const hasToken = window.location.hash.includes('access_token')

    if (!hasToken) {
      // No token in URL — sign out any stale recovery session and show invalid state
      supabase.auth.signOut().then(() => {
        setChecking(false)
        setSessionReady(false)
      })
      return
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
        setSessionReady(true)
        setChecking(false)
      }
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true)
        setChecking(false)
      } else {
        setTimeout(() => {
          supabase.auth.getSession().then(({ data: { session: s } }) => {
            if (s) setSessionReady(true)
            setChecking(false)
          })
        }, 1000)
      }
    })

    return () => { subscription.unsubscribe() }
  }, [])

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setMessage('')

    if (password.length < 8) {
      setStatus('error')
      setMessage('Password must be at least 8 characters.')
      return
    }

    if (password !== confirm) {
      setStatus('error')
      setMessage('Passwords do not match.')
      return
    }

    setStatus('loading')

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setStatus('error')
      setMessage(error.message)
      return
    }

    // Sign out immediately to clear the recovery session —
    // prevents it from bleeding into other pages
    await supabase.auth.signOut()

    setStatus('success')
    setMessage('Password updated. Redirecting to sign in…')
    setTimeout(() => { window.location.href = '/login' }, 2000)
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

        .root {
          min-height: 100vh;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 24px;
          background-image: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(201,169,110,0.07) 0%, transparent 70%);
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
        .wordmark-text {
          font-family: 'DM Serif Display', serif;
          font-size: 20px; color: ${T.CREAM}; letter-spacing: 0.01em;
        }

        .card {
          width: 100%; max-width: 400px;
          background: ${T.CARD_BG};
          border: 1px solid ${T.CARD_BORDER};
          border-radius: 12px; padding: 40px 36px 36px;
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
        .input:disabled { opacity: 0.4; cursor: not-allowed; }

        .strength-bar {
          height: 3px; border-radius: 2px;
          background: rgba(255,255,255,0.06);
          margin-top: 6px; overflow: hidden;
        }
        .strength-fill {
          height: 100%; border-radius: 2px;
          transition: width 0.25s, background 0.25s;
        }

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

        .back-link {
          color: ${T.GOLD}; font-size: 13px; text-decoration: none;
          transition: opacity 0.15s;
        }
        .back-link:hover { opacity: 0.7; }

        .checking {
          text-align: center; padding: 16px 0;
          font-size: 13px; color: ${T.MUTED};
        }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        .dot {
          display: inline-block; width: 6px; height: 6px;
          border-radius: 50%; background: ${T.GOLD};
          animation: pulse 1.4s ease-in-out infinite;
          margin: 0 2px; vertical-align: middle;
        }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }

        @keyframes spin { to { transform: rotate(360deg); } }
        .spinner {
          display: inline-block; width: 14px; height: 14px;
          border: 2px solid rgba(15,14,12,0.3);
          border-top-color: #0f0e0c; border-radius: 50%;
          animation: spin 0.7s linear infinite;
          vertical-align: middle; margin-right: 6px;
        }
      `}</style>

      <div className="root">
        <a href="/" className="wordmark">
          <div className="wordmark-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 4h10M3 8h7M3 12h5" stroke={T.GOLD} strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="wordmark-text">CIMScan</span>
        </a>

        <div className="card">
          <div className="pill"><span className="pill-dot" />New Password</div>
          <h1 className="heading">Set a new password</h1>
          <p className="subheading">Choose something strong — at least 8 characters.</p>

          {checking ? (
            <div className="checking">
              Verifying link
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          ) : !sessionReady ? (
            <>
              <p style={{ fontSize: 14, color: T.MUTED, marginBottom: 24 }}>
                This reset link is invalid or has already been used. Request a new one from the login page.
              </p>
              <div className="divider" />
              <a href="/login" className="back-link">← Back to sign in</a>
            </>
          ) : (
            <>
              <form onSubmit={handleReset}>
                <div className="field">
                  <label className="label">New password</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    disabled={status === 'loading' || status === 'success'}
                    autoComplete="new-password"
                    autoFocus
                  />
                  {password.length > 0 && (
                    <div className="strength-bar">
                      <div className="strength-fill" style={{
                        width: `${Math.min(100, (password.length / 16) * 100)}%`,
                        background: password.length < 8 ? T.ERROR : password.length < 12 ? T.GOLD_DIM : T.GOLD,
                      }} />
                    </div>
                  )}
                </div>

                <div className="field">
                  <label className="label">Confirm password</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="••••••••"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                    disabled={status === 'loading' || status === 'success'}
                    autoComplete="new-password"
                    style={{
                      borderColor: confirm.length > 0 && confirm !== password
                        ? 'rgba(224,112,112,0.5)' : undefined
                    }}
                  />
                </div>

                <button
                  className="btn-primary"
                  type="submit"
                  disabled={status === 'loading' || status === 'success'}
                >
                  {status === 'loading'
                    ? <><span className="spinner" />Updating…</>
                    : status === 'success' ? 'Password updated'
                    : 'Set new password'}
                </button>
              </form>

              {message && (
                <div className={`msg ${status === 'error' ? 'msg-error' : 'msg-success'}`}>
                  {message}
                </div>
              )}

              <div className="divider" />
              <a href="/login" className="back-link">← Back to sign in</a>
            </>
          )}
        </div>
      </div>
    </>
  )
}
