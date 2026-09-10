import React, { useState, useEffect, useRef } from 'react';
import { CloneJob } from './types';
import { connectTelemetryWebSocket, getAuthToken, getJob, listJobs, logoutUser } from './api/client';
import { Header } from './components/Common/Header';
import { LoginPage } from './components/Common/LoginPage';
import { ProductionDashboard } from './components/Dashboard/ProductionDashboard';
import { TestDashboard } from './components/Dashboard/TestDashboard';
import { CloneHistory } from './components/History/CloneHistory';

// ─── AuthGate ─────────────────────────────────────────────────────────────────
// A thin wrapper that owns the auth token state. When unauthenticated it renders
// only the LoginPage; once logged in it renders the main App shell.
// This pattern avoids conditional hook calls inside the main component.

const AuthGate: React.FC = () => {
  const [authToken, setAuthToken] = useState<string>(() => getAuthToken());

  if (!authToken) {
    return (
      <LoginPage
        onLoginSuccess={(token) => {
          localStorage.setItem('mongoclone_auth_token', token);
          setAuthToken(token);
        }}
      />
    );
  }

  return (
    <App
      onLogout={async () => {
        await logoutUser();
        setAuthToken('');
      }}
    />
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────

interface AppProps {
  onLogout: () => void;
}

export const App: React.FC<AppProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'test-databases' | 'history'>('dashboard');
  const [activeJob, setActiveJob] = useState<CloneJob | null>(null);
  const [resetDashboardKey, setResetDashboardKey] = useState<number>(0);

  // WebSocket health tracking for smart polling fallback
  const [wsConnected, setWsConnected] = useState(false);
  const wsDisconnectedSince = useRef<number | null>(null);

  // UI Scale / Density state — in-memory only, resets to default on refresh
  const [uiScale, setUiScale] = useState<number>(0.65);

  function handleNavigateHome() {
    setActiveTab('dashboard');
    setResetDashboardKey((prev) => prev + 1);
  }

  // Restore the active RUNNING job on page load by querying the server directly
  useEffect(() => {
    async function restoreActiveJob() {
      try {
        const jobs = await listJobs();
        if (jobs && jobs.length > 0) {
          const runningJob = jobs.find((j) => j.status === 'RUNNING');
          if (runningJob) {
            setActiveJob(runningJob);
          }
        }
      } catch (_) {
        // ignore — server may not be ready yet
      }
    }
    restoreActiveJob();
  }, []);

  // Connect to live WebSocket progress stream — tracks connection health for smart polling
  useEffect(() => {
    const disconnect = connectTelemetryWebSocket(
      (msg) => {
        if (msg.type === 'PROGRESS' && msg.payload) {
          const p = msg.payload;
          setActiveJob((prev) => {
            // If the job was cancelled or completed, clear it from activeJob if it matches
            if (p.status === 'CANCELLED' || p.status === 'COMPLETED') {
              if (prev && prev.id === p.id) {
                return null;
              }
              return prev;
            }

            // If no active job is tracked, only accept actively RUNNING jobs
            if (!prev) {
              if (p.status === 'RUNNING') {
                return p;
              }
              return null;
            }

            // If active job matches, update telemetry
            if (prev.id === p.id) {
              return p;
            }

            return prev;
          });
        }
      },
      // onOpen: WebSocket connected
      () => {
        setWsConnected(true);
        wsDisconnectedSince.current = null;
      },
      // onClose: WebSocket disconnected
      () => {
        setWsConnected(false);
        if (wsDisconnectedSince.current === null) {
          wsDisconnectedSince.current = Date.now();
        }
      }
    );

    return () => disconnect();
  }, []);

  // Smart HTTP Polling Fallback — activates only when WebSocket has been disconnected for >3s.
  useEffect(() => {
    if (!activeJob || (activeJob.status !== 'PENDING' && activeJob.status !== 'RUNNING')) {
      return;
    }
    const interval = setInterval(async () => {
      // Only poll if WebSocket has been down for more than 3 seconds
      if (wsConnected) return;
      const sinceDisconnect = Date.now() - (wsDisconnectedSince.current ?? Date.now());
      if (sinceDisconnect < 3000) return;

      try {
        const fresh = await getJob(activeJob.id);
        if (fresh) {
          setActiveJob(fresh);
        }
      } catch (_) {
        // ignore
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activeJob?.id, activeJob?.status, wsConnected]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col bg-grid-pattern selection:bg-brand-500 selection:text-white">
      {/* Global Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={(tab) => {
          if (tab === 'dashboard') {
            handleNavigateHome();
          } else {
            setActiveTab(tab as any);
          }
        }}
        activeJobsCount={activeJob?.status === 'RUNNING' ? 1 : 0}
        uiScale={uiScale}
        setUiScale={setUiScale}
        onLogout={onLogout}
        wsConnected={wsConnected}
      />

      {/* Main Scaled Container (Supports 60% / 80% / 100% density) */}
      <main
        className="flex-1 max-w-[1700px] w-full mx-auto p-3 sm:p-5 transition-all duration-150 origin-top"
        style={{ zoom: uiScale }}
      >
        {activeTab === 'dashboard' ? (
          <ProductionDashboard
            activeJob={activeJob}
            setActiveJob={setActiveJob}
            resetKey={resetDashboardKey}
          />
        ) : activeTab === 'test-databases' ? (
          <TestDashboard
            resetKey={resetDashboardKey}
          />
        ) : (
          <CloneHistory
            onSelectJob={(job) => {
              setActiveJob(job);
              setActiveTab('dashboard');
            }}
            onBack={() => setActiveTab('dashboard')}
            activeJobId={activeJob?.status === 'RUNNING' ? activeJob.id : undefined}
            wsConnected={wsConnected}
          />
        )}
      </main>
    </div>
  );
};

export default AuthGate;
