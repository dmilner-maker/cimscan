'use client'

// web/src/app/account/page.tsx

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

type Panel = 'main' | 'confirm-data' | 'confirm-account'
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

interface AccountData {
  email: string
  display_name: string
  firm_name: string
  firm_website: string
  ingest_address: string
  role: string
}

export default function AccountPage() {
  const [account, setAccount]   = useState<AccountData | null>(null)
  const [panel, setPanel]       = useState<Panel>('main')
  const [status, setStatus]     = useState<Status>('idle')
  const [message, setMessage]   = useState('')
  const [loading, setLoading]   = useState(true)
  const [authError, setAuthError] = useState(false)

  useEffect(() => {
    loadAccount()
  }, [])

  async function loadAccount() {
    setLoading(true)

    // Check auth session
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      window.location.href = '/login'
      return
    }

    const token = session.access_token

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/user/account-info`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.status === 401) {
        window.location.href = '/login'
        return
      }

      if (!res.ok) throw new Error('Failed to load account')

      const data = await res.json()
      setAccount(data)
    } catch {
      setAuthError(true)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteData() {
    setStatus('loading')
    setMessage('')

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { window.location.href = '/login'; return }

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/user/data`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (!res.ok) throw new Error('Failed to delete data')

      setStatus('success')
      setMessage('All your deals and files have been deleted. Your account remains active.')
      setPanel('main')
    } catch {
      setStatus('error')
      setMessage('Something went wrong. Please try again.')
      setPanel('main')
    }
  }

  async function handleDeleteAccount() {
    setStatus('loading')
    setMessage('')

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { window.location.href = '/login'; return }

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/user/account`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (!res.ok) throw new Error('Failed to delete account')

      await supabase.auth.signOut()
      window.location.href = '/?deleted=true'
    } catch {
      setStatus('error')
      setMessage('Something went wrong. Please try again.')
      setPanel('main')
    }
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
          margin-bottom: 40px; text-decoration: none; align-self: flex-start;
          margin-left: auto; margin-right: auto;
          width: 100%; max-width: 480px;
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
          width: 100%; max-width: 480px;
          background: ${T.CARD_BG};
          border: 1px solid ${T.CARD_BORDER};
          border-radius: 12px; padding: 36px;
        }

        .pill {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 10px;
          border: 1px solid rgba(201,169,110,0.3); border-radius: 999px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px; font-weight: 500;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: ${T.GOLD}; margin-bottom: 20px;
        }
        .pill-dot { width: 5px; height: 5px; border-radius: 50%; background: ${T.GOLD}; }

        .heading {
          font-family: 'DM Serif Display', serif;
          font-size: 26px; font-weight: 400; color: ${T.CREAM};
          line-height: 1.2; margin-bottom: 28px;
        }

        /* Info rows */
        .info-section { margin-bottom: 28px; }
        .section-label {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px; font-weight: 500;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: ${T.DIM}; margin-bottom: 12px;
        }
        .info-row {
          display: flex; flex-direction: column; gap: 3px;
          padding: 12px 0;
          border-bottom: 1px solid ${T.CARD_BORDER};
        }
        .info-row:last-child { border-bottom: none; }
        .info-key {
          font-size: 11px; color: ${T.DIM};
          font-family: 'IBM Plex Mono', monospace;
          letter-spacing: 0.04em; text-transform: uppercase;
        }
        .info-val {
          font-size: 14px; color: ${T.CREAM};
        }
        .info-val-mono {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px; color: ${T.MUTED};
        }
        .role-badge {
          display: inline-flex; align-items: center;
          padding: 2px 8px; border-radius: 999px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px; font-weight: 500;
          letter-spacing: 0.06em; text-transform: uppercase;
          background: rgba(201,169,110,0.1);
          border: 1px solid rgba(201,169,110,0.2);
          color: ${T.GOLD};
        }

        .divider { height: 1px; background: ${T.CARD_BORDER}; margin: 24px 0; }

        /* Danger zone */
        .danger-section { margin-top: 4px; }
        .danger-label {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px; font-weight: 500;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: ${T.DIM}; margin-bottom: 12px;
        }
        .danger-row {
          display: flex; align-items: center;
          justify-content: space-between; gap: 16px;
          padding: 14px 0;
          border-bottom: 1px solid ${T.CARD_BORDER};
        }
        .danger-row:last-child { border-bottom: none; }
        .danger-info { flex: 1; }
        .danger-title { font-size: 14px; color: ${T.CREAM}; margin-bottom: 3px; }
        .danger-desc { font-size: 12px; color: ${T.DIM}; line-height: 1.4; }

        .btn-danger {
          flex-shrink: 0;
          padding: 8px 16px; border-radius: 8px;
          background: rgba(224,112,112,0.08);
          border: 1px solid rgba(224,112,112,0.25);
          font-family: 'IBM Plex Sans', sans-serif;
          font-size: 13px; font-weight: 600;
          color: ${T.ERROR}; cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
          white-space: nowrap;
        }
        .btn-danger:hover { background: rgba(224,112,112,0.14); border-color: rgba(224,112,112,0.4); }
        .btn-danger:disabled { opacity: 0.4; cursor: not-allowed; }

        /* Confirm panel */
        .confirm-heading {
          font-family: 'DM Serif Display', serif;
          font-size: 22px; color: ${T.CREAM};
          margin-bottom: 12px;
        }
        .confirm-desc {
          font-size: 14px; color: ${T.MUTED};
          line-height: 1.6; margin-bottom: 28px;
        }
        .confirm-actions { display: flex; gap: 12px; }
        .btn-cancel {
          flex: 1; padding: 12px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px;
          font-family: 'IBM Plex Sans', sans-serif;
          font-size: 14px; font-weight: 500;
          color: ${T.MUTED}; cursor: pointer;
          transition: border-color 0.15s;
        }
        .btn-cancel:hover { border-color: rgba(255,255,255,0.15); }
        .btn-confirm-danger {
          flex: 1; padding: 12px;
          background: rgba(224,112,112,0.1);
          border: 1px solid rgba(224,112,112,0.3);
          border-radius: 8px;
          font-family: 'IBM Plex Sans', sans-serif;
          font-size: 14px; font-weight: 600;
          color: ${T.ERROR}; cursor: pointer;
          transition: background 0.15s;
        }
        .btn-confirm-danger:hover { background: rgba(224,112,112,0.18); }
        .btn-confirm-danger:disabled { opacity: 0.4; cursor: not-allowed; }

        .msg {
          margin-top: 20px; padding: 10px 14px;
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

        .back-link {
          display: inline-flex; align-items: center; gap: 6px;
          color: ${T.MUTED}; font-size: 13px; text-decoration: none;
          margin-bottom: 24px; transition: color 0.15s; cursor: pointer;
          background: none; border: none; padding: 0;
          font-family: 'IBM Plex Sans', sans-serif;
        }
        .back-link:hover { color: ${T.CREAM}; }

        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        .skeleton {
          height: 14px; border-radius: 4px;
          background: rgba(255,255,255,0.06);
          animation: pulse 1.4s ease-in-out infinite;
          margin-bottom: 8px;
        }

        @keyframes spin { to { transform: rotate(360deg); } }
        .spinner {
          display: inline-block; width: 14px; height: 14px;
          border: 2px solid rgba(224,112,112,0.2);
          border-top-color: ${T.ERROR}; border-radius: 50%;
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

          {loading ? (
            <>
              <div className="skeleton" style={{width: '40%'}} />
              <div className="skeleton" style={{width: '70%'}} />
              <div className="skeleton" style={{width: '55%'}} />
            </>

          ) : authError ? (
            <>
              <p style={{fontSize: 14, color: T.MUTED, marginBottom: 20}}>
                Could not load account details. Please try signing in again.
              </p>
              <a href="/login" style={{color: T.GOLD, fontSize: 13}}>← Back to sign in</a>
            </>

          ) : panel === 'main' ? (
            <>
              <div className="pill"><span className="pill-dot" />Account</div>
              <h1 className="heading">Account settings</h1>

              {/* Account info */}
              <div className="info-section">
                <div className="section-label">Your details</div>
                <div className="info-row">
                  <span className="info-key">Name</span>
                  <span className="info-val">{account?.display_name || '—'}</span>
                </div>
                <div className="info-row">
                  <span className="info-key">Email</span>
                  <span className="info-val">{account?.email}</span>
                </div>
                <div className="info-row">
                  <span className="info-key">Role</span>
                  <span className="role-badge">{account?.role}</span>
                </div>
              </div>

              {/* Firm info */}
              <div className="info-section">
                <div className="section-label">Your firm</div>
                <div className="info-row">
                  <span className="info-key">Firm</span>
                  <span className="info-val">{account?.firm_name}</span>
                </div>
                <div className="info-row">
                  <span className="info-key">Website</span>
                  <span className="info-val">{account?.firm_website}</span>
                </div>
                <div className="info-row">
                  <span className="info-key">Ingest address</span>
                  <span className="info-val-mono">{account?.ingest_address}</span>
                </div>
              </div>

              <div className="divider" />

              {/* Danger zone */}
              <div className="danger-section">
                <div className="danger-label">Data & account</div>

                <div className="danger-row">
                  <div className="danger-info">
                    <div className="danger-title">Delete all data</div>
                    <div className="danger-desc">Removes all deals, CIMs, and output files. Your account stays active.</div>
                  </div>
                  <button className="btn-danger" onClick={() => { setPanel('confirm-data'); setStatus('idle'); setMessage('') }}>
                    Delete data
                  </button>
                </div>

                <div className="danger-row">
                  <div className="danger-info">
                    <div className="danger-title">Delete account</div>
                    <div className="danger-desc">Permanently removes your account and all associated data. Cannot be undone.</div>
                  </div>
                  <button className="btn-danger" onClick={() => { setPanel('confirm-account'); setStatus('idle'); setMessage('') }}>
                    Delete account
                  </button>
                </div>
              </div>

              {message && (
                <div className={`msg ${status === 'error' ? 'msg-error' : 'msg-success'}`}>
                  {message}
                </div>
              )}
            </>

          ) : panel === 'confirm-data' ? (
            <>
              <button className="back-link" onClick={() => setPanel('main')}>← Back</button>
              <h2 className="confirm-heading">Delete all data?</h2>
              <p className="confirm-desc">
                This will permanently delete all your deals, uploaded CIMs, and output files.
                Your account will remain active and you can continue submitting CIMs.
                This cannot be undone.
              </p>
              <div className="confirm-actions">
                <button className="btn-cancel" onClick={() => setPanel('main')}>Cancel</button>
                <button
                  className="btn-confirm-danger"
                  onClick={handleDeleteData}
                  disabled={status === 'loading'}
                >
                  {status === 'loading' ? <><span className="spinner" />Deleting…</> : 'Yes, delete all data'}
                </button>
              </div>
            </>

          ) : (
            <>
              <button className="back-link" onClick={() => setPanel('main')}>← Back</button>
              <h2 className="confirm-heading">Delete your account?</h2>
              <p className="confirm-desc">
                This will permanently delete your account, all deals, all files, and remove you
                from CIMScan entirely. This cannot be undone and there is no recovery option.
              </p>
              <div className="confirm-actions">
                <button className="btn-cancel" onClick={() => setPanel('main')}>Cancel</button>
                <button
                  className="btn-confirm-danger"
                  onClick={handleDeleteAccount}
                  disabled={status === 'loading'}
                >
                  {status === 'loading' ? <><span className="spinner" />Deleting…</> : 'Yes, delete my account'}
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </>
  )
}
