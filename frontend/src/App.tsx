import React, { useState, useEffect } from 'react';
import { CloneJob } from './types';
import { connectTelemetryWebSocket, getJob, listJobs } from './api/client';
import { Header } from './components/Common/Header';
import { ProductionDashboard } from './components/Dashboard/ProductionDashboard';
import { CloneHistory } from './components/History/CloneHistory';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history'>('dashboard');
  const [activeJob, setActiveJob] = useState<CloneJob | null>(null);
  const [resetDashboardKey, setResetDashboardKey] = useState<number>(0);

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
        const dismissedJobId = localStorage.getItem('mongoclone_dismissed_job_id');

        if (savedJobId && savedJobId !== dismissedJobId) {
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

        const jobs = await listJobs();
        if (jobs && jobs.length > 0) {
          const activeOrPaused = jobs.find(
            (j) => (j.status === 'RUNNING' || j.status === 'PAUSED') && j.id !== dismissedJobId
          );
          if (activeOrPaused) {
            setActiveJob(activeOrPaused);
            localStorage.setItem('mongoclone_active_job_id', activeOrPaused.id);
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
    } else if (activeJob && (activeJob.status === 'COMPLETED' || activeJob.status === 'CANCELLED')) {
      localStorage.removeItem('mongoclone_active_job_id');
    }
  }, [activeJob?.id, activeJob?.status]);

  // Connect to live WebSocket progress stream
  useEffect(() => {
    const disconnect = connectTelemetryWebSocket((msg) => {
      if (msg.type === 'PROGRESS' && msg.payload) {
        setActiveJob((prev) => {
          if (!prev || prev.id === msg.payload.id) {
            return msg.payload;
          }
          return prev;
        });
      }
    });

    return () => disconnect();
  }, []);

  // Fast HTTP Polling Fallback (ensures real-time telemetry if WebSocket proxy disconnects)
  useEffect(() => {
    if (!activeJob || (activeJob.status !== 'PENDING' && activeJob.status !== 'RUNNING')) {
      return;
    }
    const interval = setInterval(async () => {
      try {
        const fresh = await getJob(activeJob.id);
        if (fresh) {
          setActiveJob(fresh);
        }
      } catch (e) {
        // ignore
      }
    }, 800);

    return () => clearInterval(interval);
  }, [activeJob?.id, activeJob?.status]);

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
