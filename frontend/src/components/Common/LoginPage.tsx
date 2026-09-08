import React, { useState } from 'react';

interface LoginPageProps {
  onLoginSuccess: (token: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) {
        setError(data.error || 'Invalid username or password');
        return;
      }
      localStorage.setItem('mongoclone_auth_token', data.token);
      onLoginSuccess(data.token);
    } catch {
      setError('Unable to connect to the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #020817 0%, #0f1729 50%, #020817 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif",
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Ambient glow orbs */}
      <div style={{
        position: 'absolute', top: '15%', left: '10%',
        width: '400px', height: '400px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(20,184,166,0.06) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '10%', right: '8%',
        width: '500px', height: '500px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99,102,241,0.05) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Grid overlay */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.03,
        backgroundImage: `linear-gradient(rgba(148,163,184,1) 1px, transparent 1px),
                          linear-gradient(90deg, rgba(148,163,184,1) 1px, transparent 1px)`,
        backgroundSize: '40px 40px',
        pointerEvents: 'none',
      }} />

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: '420px',
        margin: '0 1.5rem',
        background: 'rgba(15, 23, 42, 0.85)',
        border: '1px solid rgba(51, 65, 85, 0.6)',
        borderRadius: '1.25rem',
        padding: '2.5rem',
        backdropFilter: 'blur(24px)',
        boxShadow: '0 25px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset',
      }}>
        {/* Logo + Title */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '3.5rem', height: '3.5rem', borderRadius: '1rem', marginBottom: '1rem',
            background: 'linear-gradient(135deg, #14b8a6, #6366f1)',
            boxShadow: '0 0 24px rgba(20,184,166,0.3)',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3"/>
              <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
              <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
            </svg>
          </div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
            MongoClone
          </h1>
          <p style={{ margin: '0.375rem 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
            Production MongoDB Migration Engine
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Username */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', marginBottom: '0.5rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Username
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              placeholder="Enter username"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '0.625rem 0.875rem',
                background: 'rgba(30, 41, 59, 0.8)',
                border: `1px solid ${error ? 'rgba(239,68,68,0.4)' : 'rgba(51,65,85,0.8)'}`,
                borderRadius: '0.625rem',
                color: '#f1f5f9', fontSize: '0.875rem',
                outline: 'none', transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.target.style.borderColor = 'rgba(20,184,166,0.6)')}
              onBlur={e => (e.target.style.borderColor = error ? 'rgba(239,68,68,0.4)' : 'rgba(51,65,85,0.8)')}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', marginBottom: '0.5rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="Enter password"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '0.625rem 2.5rem 0.625rem 0.875rem',
                  background: 'rgba(30, 41, 59, 0.8)',
                  border: `1px solid ${error ? 'rgba(239,68,68,0.4)' : 'rgba(51,65,85,0.8)'}`,
                  borderRadius: '0.625rem',
                  color: '#f1f5f9', fontSize: '0.875rem',
                  outline: 'none', transition: 'border-color 0.15s',
                }}
                onFocus={e => (e.target.style.borderColor = 'rgba(20,184,166,0.6)')}
                onBlur={e => (e.target.style.borderColor = error ? 'rgba(239,68,68,0.4)' : 'rgba(51,65,85,0.8)')}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                style={{
                  position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#64748b', padding: '0.125rem', lineHeight: 1,
                }}
              >
                {showPassword ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              marginBottom: '1rem', padding: '0.625rem 0.875rem',
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: '0.5rem',
              color: '#f87171', fontSize: '0.8125rem',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            id="login-submit"
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '0.6875rem',
              background: loading
                ? 'rgba(99,102,241,0.4)'
                : 'linear-gradient(135deg, #14b8a6, #6366f1)',
              border: 'none', borderRadius: '0.625rem',
              color: '#fff', fontSize: '0.875rem', fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              transition: 'opacity 0.15s, transform 0.1s',
              boxShadow: loading ? 'none' : '0 4px 12px rgba(99,102,241,0.3)',
              letterSpacing: '0.01em',
            }}
            onMouseEnter={e => { if (!loading) (e.currentTarget.style.opacity = '0.9'); }}
            onMouseLeave={e => { (e.currentTarget.style.opacity = '1'); }}
          >
            {loading ? (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
                Signing in…
              </>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                  <polyline points="10 17 15 12 10 7"/>
                  <line x1="15" y1="12" x2="3" y2="12"/>
                </svg>
                Sign In
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <p style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.6875rem', color: '#334155' }}>
          VPC-internal access only • Session expires after 24 hours
        </p>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder { color: #475569; }
      `}</style>
    </div>
  );
};
