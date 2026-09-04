import React, { useEffect, useRef, useState } from 'react';
import { CloneJob } from '../../types';
import { cancelJob } from '../../api/client';
import { StatusBadge } from '../Common/StatusBadge';
import { MetricCard } from '../Common/MetricCard';
import confetti from 'canvas-confetti';
import {
  Activity,
  Layers,
  FileText,
  Clock,
  Zap,
  StopCircle,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Terminal,
  ArrowRight,
  Database,
} from 'lucide-react';

interface Step5ExecutionProps {
  activeJob: CloneJob | null;
  onReset: () => void;
}

export const Step5Execution: React.FC<Step5ExecutionProps> = ({
  activeJob,
  onReset,
}) => {
  const [cancelling, setCancelling] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);
  const confettiTriggered = useRef(false);

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeJob?.logs, autoScroll]);

  // Trigger celebration confetti on success
  useEffect(() => {
    if (activeJob?.status === 'COMPLETED' && !confettiTriggered.current) {
      confettiTriggered.current = true;
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#10b981', '#06b6d4', '#8b5cf6', '#34d399'],
      });
    }
  }, [activeJob?.status]);

  async function handleCancel() {
    if (!activeJob) return;
    if (!confirm('Are you sure you want to stop this clone pipeline?')) return;

    setCancelling(true);
    try {
      await cancelJob(activeJob.id);
    } catch (e: any) {
      alert(`Failed to cancel clone: ${e.message || e}`);
    } finally {
      setCancelling(false);
    }
  }

  if (!activeJob) {
    return (
      <div className="p-16 text-center glass-panel rounded-2xl space-y-4 max-w-xl mx-auto">
        <Activity className="w-10 h-10 text-slate-600 mx-auto" />
        <p className="text-sm text-slate-400">No active clone job is running.</p>
        <button
          onClick={onReset}
          className="px-5 py-2 rounded-xl text-xs font-semibold bg-brand-500 text-slate-950 hover:bg-brand-400"
        >
          Start New Clone
        </button>
      </div>
    );
  }

  const p = activeJob.progress;
  const isFinished =
    activeJob.status === 'COMPLETED' ||
    activeJob.status === 'FAILED' ||
    activeJob.status === 'CANCELLED';

  function formatTime(sec: number): string {
    if (sec <= 0) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Top Status Header */}
      <div className="glass-panel p-6 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white tracking-tight">
              {activeJob.name}
            </h2>
            <StatusBadge status={activeJob.status} />
          </div>
          <p className="text-xs text-slate-400 font-mono mt-1">
            {activeJob.source_masked} &rarr; {activeJob.target_masked} ({activeJob.mode})
          </p>
        </div>

        <div className="flex items-center gap-3">
          {!isFinished ? (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-colors"
            >
              <StopCircle className="w-4 h-4" />
              <span>{cancelling ? 'Stopping...' : 'Cancel Operation'}</span>
            </button>
          ) : (
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-semibold bg-brand-500 text-slate-950 hover:bg-brand-400 shadow-md shadow-brand-500/20 transition-all"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Start Another Clone</span>
            </button>
          )}
        </div>
      </div>

      {/* Primary Progress Bar */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white uppercase tracking-wider">Phase:</span>
            <span className="px-2.5 py-0.5 rounded-full bg-cyber-cyan/10 text-cyber-cyan font-mono font-bold border border-cyber-cyan/30">
              {p.phase || 'Processing'}
            </span>
          </div>
          <span className="font-mono text-2xl font-black text-brand-400">
            {(p.percent || 0).toFixed(1)}%
          </span>
        </div>

        {/* Outer bar */}
        <div className="w-full h-4 bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-800">
          <div
            className="h-full bg-gradient-to-r from-brand-600 via-brand-500 to-cyber-cyan rounded-full transition-all duration-300 shadow-lg shadow-brand-500/30"
            style={{ width: `${Math.min(100, Math.max(0, p.percent || 0))}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 font-mono">
          <span>Current: {p.current_collection || 'Preparing...'}</span>
          <span>
            {p.transferred_docs?.toLocaleString()} / {p.total_estimated_docs?.toLocaleString()} Documents
          </span>
        </div>
      </div>

      {/* Live Telemetry Gauges */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Transfer Speed"
          value={`${(p.throughput_mbs || 0).toFixed(2)} MB/s`}
          subValue={`${p.docs_per_sec || 0} docs/sec`}
          icon={<Zap className="w-5 h-5" />}
          accentColor="brand"
        />
        <MetricCard
          label="Transferred Data"
          value={`${((p.transferred_bytes || 0) / (1024 * 1024)).toFixed(1)} MB`}
          subValue={`Est. ${((p.total_estimated_bytes || 0) / (1024 * 1024)).toFixed(1)} MB`}
          icon={<Layers className="w-5 h-5" />}
          accentColor="cyan"
        />
        <MetricCard
          label="Collections"
          value={`${p.completed_collections || 0} / ${p.total_collections || 0}`}
          subValue="Completed"
          icon={<Database className="w-5 h-5" />}
          accentColor="violet"
        />
        <MetricCard
          label="Time Remaining"
          value={formatTime(p.eta_seconds || 0)}
          subValue={`Elapsed: ${formatTime(activeJob.duration_seconds || 0)}`}
          icon={<Clock className="w-5 h-5" />}
          accentColor="amber"
        />
      </div>

      {/* PITR Oplog Replay Stats (if applicable) */}
      {activeJob.mode === 'POINT_IN_TIME_PITR' && (
        <div className="p-4 rounded-xl glass-panel bg-slate-900/80 border border-cyber-cyan/30 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-cyber-cyan">
            <Activity className="w-4 h-4" />
            <span className="font-semibold">Point-in-Time Oplog Operations Replayed:</span>
          </div>
          <span className="font-bold text-white text-sm">
            {p.replayed_oplog_ops || 0} ops
          </span>
        </div>
      )}

      {/* Live Log Console */}
      <div className="glass-panel rounded-2xl overflow-hidden border border-slate-800">
        <div className="p-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-brand-400" />
            <span className="text-xs font-semibold text-slate-200">
              Live Execution Telemetry & Console Logs ({activeJob.logs.length})
            </span>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-slate-700 text-brand-500 focus:ring-0"
            />
            <span>Auto-scroll</span>
          </label>
        </div>

        <div className="p-4 bg-slate-950 font-mono text-xs max-h-64 overflow-y-auto space-y-1.5">
          {activeJob.logs.map((log, i) => {
            const levelColors = {
              INFO: 'text-slate-400',
              WARN: 'text-amber-400',
              ERROR: 'text-rose-400 font-bold',
              SUCCESS: 'text-brand-400 font-bold',
            };
            return (
              <div key={i} className="flex items-start gap-2.5 leading-relaxed">
                <span className="text-slate-600 text-[10px] shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span
                  className={`text-[10px] px-1.5 rounded uppercase font-bold shrink-0 ${
                    log.level === 'SUCCESS'
                      ? 'bg-brand-500/20 text-brand-400'
                      : log.level === 'ERROR'
                      ? 'bg-rose-500/20 text-rose-400'
                      : log.level === 'WARN'
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {log.level}
                </span>
                <span className={levelColors[log.level] || 'text-slate-300'}>
                  {log.message}
                </span>
              </div>
            );
          })}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
};
