import React, { useState, useEffect, useRef } from 'react';
import { CloneJob } from './types';
import { connectTelemetryWebSocket, getAuthToken, getJob, listJobs, logoutUser } from './api/client';
import { Header } from './components/Common/Header';
import { LoginPage } from './components/Common/LoginPage';
import { ProductionDashboard } from './components/Dashboard/ProductionDashboard';
import { CloneHistory } from './components/History/CloneHistory';

export const App: React.FC = () => {
  // Auth gate — check localStorage for existing token
  const [authToken, setAuthToken] = useState<string>(() => getAuthToken());

  const [activeTab, setActiveTab] = useState<'dashboard' | 'history'>('dashboard');
  const [activeJob, setActiveJob] = useState<CloneJob | null>(null);
  const [resetDashboardKey, setResetDashboardKey] = useState<number>(0);
  // WebSocket health tracking for smart polling fallback
  const [wsConnected, setWsConnected] = useState(false);
  const wsDisconnectedSince = useRef<number | null>(null);

  // Show login page if not authenticated
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

  function handleNavigateHome() {
    setActiveTab('dashboard');
    setResetDashboardKey((prev) => prev + 1);
  }

  // UI Scale / Density state (defaults to 0.65 / 60% compact view as requested)
  const [uiScale, setUiScale] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('mongoclone_uiscale');
      if (saved) return parseFloat(saved);
    } catch (e) {}
    return 0.65;
  });

  function handleSetUiScale(scale: number) {
    setUiScale(scale);
    try {
      localStorage.setItem('mongoclone_uiscale', scale.toString());
    } catch (e) {}
  }

  // Restore active or paused job on initial page load/refresh
  useEffect(() => {
    async function restoreActiveJob() {
      try {
        const savedJobId = localStorage.getItem('mongoclone_active_job_id');
        let dismissedIds: string[] = [];
        try {
          const raw = localStorage.getItem('mongoclone_dismissed_job_ids');
          if (raw) dismissedIds = JSON.parse(raw);
          const legacy = localStorage.getItem('mongoclone_dismissed_job_id');
          if (legacy && !dismissedIds.includes(legacy)) dismissedIds.push(legacy);
        } catch (e) {}

        if (savedJobId && !dismissedIds.includes(savedJobId)) {
          try {
            const savedJob = await getJob(savedJobId);
            if (savedJob && (savedJob.status === 'RUNNING' || savedJob.status === 'PAUSED')) {
              setActiveJob(savedJob);
              return;
            }
          } catch (e) {
            // fallback to listJobs
          }
        }

        // Only auto-restore an actively RUNNING job if one is in progress across the cluster.
        // Never auto-promote old PAUSED or interrupted jobs to hijack the top dashboard banner.
        const jobs = await listJobs();
        if (jobs && jobs.length > 0) {
          const runningJob = jobs.find(
            (j) => j.status === 'RUNNING' && !dismissedIds.includes(j.id)
          );
          if (runningJob) {
            setActiveJob(runningJob);
            localStorage.setItem('mongoclone_active_job_id', runningJob.id);
          }
        }
      } catch (e) {
        // ignore
      }
    }
    restoreActiveJob();
  }, []);

  // Save active job ID to localStorage when changed
  useEffect(() => {
    if (activeJob && (activeJob.status === 'RUNNING' || activeJob.status === 'PAUSED')) {
      localStorage.setItem('mongoclone_active_job_id', activeJob.id);
    } else {
      localStorage.removeItem('mongoclone_active_job_id');
    }
  }, [activeJob?.id, activeJob?.status]);

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
  // Uses 2s interval instead of 800ms to reduce API call volume during normal operation.
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
      } catch (e) {
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
            setActiveTab(tab);
          }
        }}
        activeJobsCount={activeJob?.status === 'RUNNING' ? 1 : 0}
        uiScale={uiScale}
        setUiScale={handleSetUiScale}
        onLogout={async () => {
          await logoutUser();
          setAuthToken('');
        }}
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
        ) : (
          <CloneHistory
            onSelectJob={(job) => {
              setActiveJob(job);
              setActiveTab('dashboard');
            }}
            onBack={() => setActiveTab('dashboard')}
          />
        )}
      </main>
    </div>
  );
};
export default App;
