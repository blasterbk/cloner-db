import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * ErrorBoundary prevents a full app crash when a component throws.
 * Wrap the root <App /> in this to show a recovery UI instead of a blank screen.
 */
export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-6">
          <div
            style={{
              background: 'rgba(15,23,42,0.95)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '1rem',
              padding: '2.5rem',
              maxWidth: '480px',
              width: '100%',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: '3rem',
                height: '3rem',
                borderRadius: '50%',
                background: 'rgba(239,68,68,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.25rem',
              }}
            >
              <AlertTriangle style={{ width: '1.5rem', height: '1.5rem', color: '#ef4444' }} />
            </div>

            <h2
              style={{
                fontSize: '1.125rem',
                fontWeight: 700,
                color: '#f87171',
                marginBottom: '0.5rem',
              }}
            >
              Something went wrong
            </h2>

            <p
              style={{
                fontSize: '0.8125rem',
                color: '#94a3b8',
                marginBottom: '0.375rem',
                lineHeight: 1.5,
              }}
            >
              An unexpected error occurred in the UI. Your active clone jobs are unaffected — only
              this browser session crashed.
            </p>

            {this.state.error?.message && (
              <p
                style={{
                  fontSize: '0.75rem',
                  color: '#64748b',
                  background: 'rgba(239,68,68,0.06)',
                  border: '1px solid rgba(239,68,68,0.15)',
                  borderRadius: '0.5rem',
                  padding: '0.5rem 0.75rem',
                  marginBottom: '1.25rem',
                  fontFamily: 'monospace',
                  textAlign: 'left',
                  wordBreak: 'break-word',
                }}
              >
                {this.state.error.message}
              </p>
            )}

            <button
              onClick={this.handleReload}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 1.25rem',
                background: 'rgba(99,102,241,0.8)',
                color: '#fff',
                border: 'none',
                borderRadius: '0.625rem',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
            >
              <RefreshCw style={{ width: '0.875rem', height: '0.875rem' }} />
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
