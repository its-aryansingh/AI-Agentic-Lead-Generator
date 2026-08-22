'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [emailFocused, setEmailFocused] = useState(false)
  const [passFocused, setPassFocused] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  async function signInWithGoogle() {
    setGoogleLoading(true)
    setError('')
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.file',
        ].join(' '),
      },
    })
    setGoogleLoading(false)
  }

  async function signInWithEmail() {
    setLoading(true)
    setError('')
    const supabase = createClient()

    try {
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters long.')
      }

      let activeSession = null

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password })

      if (signInError) {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password })
        if (signUpError) {
          throw new Error(signUpError.message || signInError.message)
        }

        if (signUpData.session) {
          activeSession = signUpData.session
        } else {
          const { data: retryData, error: retryError } = await supabase.auth.signInWithPassword({ email, password })
          if (retryError) throw retryError
          activeSession = retryData.session
        }
      } else {
        activeSession = signInData.session
      }

      if (activeSession?.user) {
        const { error: upsertError } = await supabase.from('users').upsert({
          id: activeSession.user.id,
          email: activeSession.user.email,
        }, { onConflict: 'id' })

        if (upsertError) {
          console.error('Failed to create public user record:', upsertError)
        }
      }

      router.push('/app/chat')
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  const isEmailValid = email.includes('@') && email.includes('.')
  const isFormReady = isEmailValid && password.length >= 6

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

        .login-root {
          font-family: 'Inter', sans-serif;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
          background:
            radial-gradient(ellipse at 15% 50%, oklch(0.25 0.12 290 / 55%) 0%, transparent 50%),
            radial-gradient(ellipse at 85% 20%, oklch(0.2 0.1 180 / 45%) 0%, transparent 50%),
            radial-gradient(ellipse at 55% 85%, oklch(0.18 0.08 230 / 35%) 0%, transparent 50%),
            oklch(0.1 0.02 280);
        }

        /* Animated ambient orbs */
        .orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          pointer-events: none;
          animation: orb-drift 12s ease-in-out infinite;
        }
        .orb-1 {
          width: 500px; height: 500px;
          background: oklch(0.55 0.25 290 / 18%);
          top: -100px; left: -150px;
          animation-duration: 14s;
        }
        .orb-2 {
          width: 400px; height: 400px;
          background: oklch(0.65 0.18 180 / 14%);
          bottom: -80px; right: -100px;
          animation-duration: 16s;
          animation-delay: -4s;
        }
        .orb-3 {
          width: 300px; height: 300px;
          background: oklch(0.45 0.22 270 / 10%);
          top: 40%; left: 60%;
          animation-duration: 18s;
          animation-delay: -8s;
        }

        @keyframes orb-drift {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%       { transform: translate(30px, -20px) scale(1.05); }
          66%       { transform: translate(-20px, 15px) scale(0.97); }
        }

        /* Grid noise overlay */
        .grid-overlay {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(oklch(1 0 0 / 2%) 1px, transparent 1px),
            linear-gradient(90deg, oklch(1 0 0 / 2%) 1px, transparent 1px);
          background-size: 40px 40px;
          pointer-events: none;
        }

        /* Card */
        .login-card {
          position: relative;
          z-index: 10;
          width: 100%;
          max-width: 420px;
          margin: 1rem;
          padding: 2.5rem 2rem;
          background: oklch(1 0 0 / 4%);
          backdrop-filter: blur(24px) saturate(180%);
          -webkit-backdrop-filter: blur(24px) saturate(180%);
          border: 1px solid oklch(1 0 0 / 10%);
          border-radius: 1.25rem;
          box-shadow:
            0 0 0 1px oklch(1 0 0 / 4%),
            0 32px 64px oklch(0 0 0 / 40%),
            inset 0 1px 0 oklch(1 0 0 / 10%);
          animation: card-enter 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }

        @keyframes card-enter {
          from { opacity: 0; transform: translateY(24px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* Logo badge */
        .logo-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.375rem 0.875rem;
          background: linear-gradient(135deg,
            oklch(0.55 0.25 290 / 25%),
            oklch(0.65 0.18 180 / 20%)
          );
          border: 1px solid oklch(1 0 0 / 12%);
          border-radius: 100px;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.04em;
          color: oklch(0.85 0.1 290);
          text-transform: uppercase;
          margin-bottom: 1.5rem;
          animation: card-enter 0.6s 0.1s both;
        }

        .logo-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: linear-gradient(135deg, oklch(0.65 0.2 290), oklch(0.75 0.18 180));
          box-shadow: 0 0 8px oklch(0.65 0.2 290 / 70%);
          animation: pulse-glow 2s ease-in-out infinite;
        }

        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 8px oklch(0.65 0.2 290 / 70%); }
          50%       { box-shadow: 0 0 16px oklch(0.65 0.2 290 / 90%); }
        }

        /* Heading */
        .login-title {
          font-size: 1.625rem;
          font-weight: 700;
          line-height: 1.2;
          color: oklch(0.97 0 0);
          letter-spacing: -0.02em;
          margin-bottom: 0.5rem;
          animation: card-enter 0.6s 0.15s both;
        }
        .login-subtitle {
          font-size: 0.875rem;
          color: oklch(0.65 0.02 280);
          line-height: 1.5;
          margin-bottom: 2rem;
          animation: card-enter 0.6s 0.2s both;
        }

        /* Google button */
        .btn-google {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.625rem;
          width: 100%;
          padding: 0.75rem 1.25rem;
          background: oklch(1 0 0 / 8%);
          border: 1px solid oklch(1 0 0 / 15%);
          border-radius: 0.75rem;
          color: oklch(0.92 0 0);
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: inherit;
          animation: card-enter 0.6s 0.25s both;
        }
        .btn-google:hover:not(:disabled) {
          background: oklch(1 0 0 / 12%);
          border-color: oklch(1 0 0 / 22%);
          transform: translateY(-1px);
          box-shadow: 0 8px 24px oklch(0 0 0 / 25%);
        }
        .btn-google:active:not(:disabled) { transform: translateY(0); }
        .btn-google:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Divider */
        .divider {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin: 1.5rem 0;
          animation: card-enter 0.6s 0.3s both;
        }
        .divider-line {
          flex: 1;
          height: 1px;
          background: oklch(1 0 0 / 8%);
        }
        .divider-text {
          font-size: 0.75rem;
          color: oklch(0.5 0.02 280);
          letter-spacing: 0.05em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        /* Input field */
        .input-group {
          position: relative;
          animation: card-enter 0.6s 0.35s both;
        }
        .input-group + .input-group { margin-top: 0.875rem; animation-delay: 0.4s; }

        .field-label {
          display: block;
          font-size: 0.75rem;
          font-weight: 500;
          color: oklch(0.65 0.04 290);
          letter-spacing: 0.04em;
          text-transform: uppercase;
          margin-bottom: 0.375rem;
          transition: color 0.2s;
        }
        .input-group:focus-within .field-label {
          color: oklch(0.75 0.12 290);
        }

        .field-input {
          width: 100%;
          padding: 0.75rem 1rem;
          background: oklch(1 0 0 / 5%);
          border: 1px solid oklch(1 0 0 / 10%);
          border-radius: 0.625rem;
          color: oklch(0.97 0 0);
          font-size: 0.875rem;
          font-family: inherit;
          outline: none;
          transition: all 0.2s ease;
          box-sizing: border-box;
        }
        .field-input::placeholder {
          color: oklch(0.45 0.02 280);
        }
        .field-input:focus {
          background: oklch(1 0 0 / 7%);
          border-color: oklch(0.65 0.2 290 / 60%);
          box-shadow:
            0 0 0 3px oklch(0.65 0.2 290 / 12%),
            inset 0 1px 2px oklch(0 0 0 / 10%);
        }

        /* CTA button */
        .btn-primary {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          width: 100%;
          padding: 0.8125rem 1.25rem;
          margin-top: 1.5rem;
          background: linear-gradient(135deg, oklch(0.55 0.25 290), oklch(0.65 0.18 180));
          border: none;
          border-radius: 0.75rem;
          color: oklch(0.97 0 0);
          font-size: 0.9375rem;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          overflow: hidden;
          transition: all 0.25s ease;
          box-shadow:
            0 0 0 1px oklch(1 0 0 / 10%),
            0 4px 20px oklch(0.55 0.25 290 / 30%);
          animation: card-enter 0.6s 0.45s both;
        }
        .btn-primary::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, oklch(1 0 0 / 12%), transparent);
          opacity: 0;
          transition: opacity 0.25s;
        }
        .btn-primary:hover:not(:disabled)::before { opacity: 1; }
        .btn-primary:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow:
            0 0 0 1px oklch(1 0 0 / 15%),
            0 8px 32px oklch(0.55 0.25 290 / 45%);
        }
        .btn-primary:active:not(:disabled) { transform: translateY(0); }
        .btn-primary:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          box-shadow: none;
        }

        /* Spinner */
        .spinner {
          width: 16px; height: 16px;
          border: 2px solid oklch(1 0 0 / 30%);
          border-top-color: oklch(1 0 0);
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Error */
        .error-box {
          display: flex;
          align-items: flex-start;
          gap: 0.625rem;
          padding: 0.75rem 1rem;
          margin-top: 1rem;
          background: oklch(0.6 0.2 20 / 12%);
          border: 1px solid oklch(0.6 0.2 20 / 25%);
          border-radius: 0.625rem;
          font-size: 0.8125rem;
          color: oklch(0.75 0.15 20);
          animation: card-enter 0.3s ease both;
        }

        /* Trust footer */
        .trust-footer {
          margin-top: 1.75rem;
          padding-top: 1.25rem;
          border-top: 1px solid oklch(1 0 0 / 6%);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1.25rem;
          animation: card-enter 0.6s 0.5s both;
        }
        .trust-item {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.7rem;
          color: oklch(0.5 0.02 280);
          letter-spacing: 0.02em;
        }
        .trust-icon {
          color: oklch(0.65 0.18 180);
          opacity: 0.8;
        }
      `}</style>

      <div className="login-root">
        {/* Ambient orbs */}
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />

        {/* Grid noise */}
        <div className="grid-overlay" />

        {/* Card */}
        <div className="login-card" style={{ opacity: mounted ? 1 : 0 }}>
          {/* Logo badge */}
          <div className="logo-badge">
            <span className="logo-dot" />
            LeadGenAI
          </div>

          {/* Heading */}
          <h1 className="login-title">Welcome back</h1>
          <p className="login-subtitle">
            Sign in to your prospecting copilot.<br />
            Find and email your ideal customers in minutes.
          </p>

          {/* Google Sign-In */}
          <button
            className="btn-google"
            onClick={signInWithGoogle}
            disabled={googleLoading || loading}
            id="btn-google-signin"
          >
            {googleLoading ? (
              <span className="spinner" />
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
            )}
            {googleLoading ? 'Connecting…' : 'Continue with Google'}
          </button>

          {/* Divider */}
          <div className="divider">
            <div className="divider-line" />
            <span className="divider-text">or use email</span>
            <div className="divider-line" />
          </div>

          {/* Email input */}
          <div className="input-group" style={{ animation: 'card-enter 0.6s 0.35s both' }}>
            <label className="field-label" htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              className="field-input"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setEmailFocused(true)}
              onBlur={() => setEmailFocused(false)}
              autoComplete="email"
              disabled={loading || googleLoading}
            />
          </div>

          {/* Password input */}
          <div className="input-group" style={{ animation: 'card-enter 0.6s 0.4s both', marginTop: '0.875rem' }}>
            <label className="field-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="field-input"
              placeholder="Min. 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setPassFocused(true)}
              onBlur={() => setPassFocused(false)}
              onKeyDown={(e) => e.key === 'Enter' && isFormReady && !loading && signInWithEmail()}
              autoComplete="current-password"
              disabled={loading || googleLoading}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="error-box" role="alert">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '1px' }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          {/* CTA */}
          <button
            className="btn-primary"
            onClick={signInWithEmail}
            disabled={!isFormReady || loading || googleLoading}
            id="btn-email-signin"
          >
            {loading ? (
              <>
                <span className="spinner" />
                Authenticating…
              </>
            ) : (
              <>
                Continue with Email
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>

          {/* Trust footer */}
          <div className="trust-footer">
            <span className="trust-item">
              <svg className="trust-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              SOC 2 ready
            </span>
            <span style={{ color: 'oklch(0.3 0 0)', fontSize: '0.625rem' }}>·</span>
            <span className="trust-item">
              <svg className="trust-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              RLS encrypted
            </span>
            <span style={{ color: 'oklch(0.3 0 0)', fontSize: '0.625rem' }}>·</span>
            <span className="trust-item">
              <svg className="trust-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              GDPR compliant
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
