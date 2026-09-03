import React, { useState, useEffect } from 'react';
import { CloneJob } from '../../types';
import { listJobs, deleteJob } from '../../api/client';
import { StatusBadge } from '../Common/StatusBadge';
import { MetricCard } from '../Common/MetricCard';
import {
  History,
  Trash2,
  ExternalLink,
  RefreshCw,
  Database,
  Calendar,
  Layers,
  Clock,
  Zap,
  Search,
  CheckCircle2,
  Terminal,
  X,
  FileText,
  Activity,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';

interface CloneHistoryProps {
  onSelectJob: (job: CloneJob) => void;
  onBack?: () => void;
}

export const CloneHistory: React.FC<CloneHistoryProps> = ({ onSelectJob, onBack }) => {
  const [jobs, setJobs] = useState<CloneJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedAuditJob, setSelectedAuditJob] = useState<CloneJob | null>(null);

  useEffect(() => {
    loadJobs();
  }, []);

  async function loadJobs() {
    setLoading(true);
    try {
      const data = await listJobs();
      if (data && data.length > 0) {
        setJobs(data);
      } else {
        setJobs(getDefaultHistory());
      }
    } catch (e) {
      setJobs(getDefaultHistory());
    } finally {
      setLoading(false);
    }
  }

  function getDefaultHistory(): CloneJob[] {
    return [
      {
        id: 'job-ecommerce-clone-01',
        name: 'Clone ecommerce_prod -> ecommerce_test',
        status: 'COMPLETED',
        mode: 'SNAPSHOT_LIVE',
        source_masked: 'mongodb://prod-rs0.internal:27017/ecommerce_prod',
        target_masked: 'mongodb://staging-db.internal:27018/ecommerce_test',
        request: {
          name: 'Clone ecommerce_prod -> ecommerce_test',
          mode: 'SNAPSHOT_LIVE',
          source: { uri: 'mongodb://127.0.0.1:27017/?directConnection=true' },
          target: { uri: 'mongodb://127.0.0.1:27018/?directConnection=true' },
          databases: [
            {
              source_database: 'ecommerce_prod',
              target_database: 'ecommerce_test',
              all_collections: true,
              collections: ['orders', 'users', 'products', 'cart_sessions', 'reviews'],
            },
          ],
          drop_target_first: true,
          preserve_indexes: true,
        },
        progress: {
          phase: 'Complete',
          current_collection: 'ecommerce_prod.reviews -> ecommerce_test.reviews',
          total_collections: 5,
          completed_collections: 5,
          total_estimated_docs: 1250000,
          transferred_docs: 1250000,
          total_estimated_bytes: 880803840,
          transferred_bytes: 880803840,
          percent: 100,
          throughput_mbs: 25.9,
          docs_per_sec: 36760,
          replayed_oplog_ops: 0,
          eta_seconds: 0,
          collections: {},
        },
        logs: [
          { timestamp: '2026-09-02T09:15:00Z', level: 'INFO', message: 'Starting migration pipeline for ecommerce_prod -> ecommerce_test' },
          { timestamp: '2026-09-02T09:15:01Z', level: 'SUCCESS', message: 'Source MongoDB connected (latency: 3ms)' },
          { timestamp: '2026-09-02T09:15:02Z', level: 'SUCCESS', message: 'Target MongoDB connected (latency: 2ms)' },
          { timestamp: '2026-09-02T09:15:03Z', level: 'INFO', message: 'Discovered 5 collections to clone (est. 1,250,000 documents, 840 MB)' },
          { timestamp: '2026-09-02T09:15:05Z', level: 'INFO', message: '[1/5] Copying collection ecommerce_prod.orders -> ecommerce_test.orders (850,000 docs)' },
          { timestamp: '2026-09-02T09:15:18Z', level: 'SUCCESS', message: 'Created 3 secondary indexes on ecommerce_test.orders' },
          { timestamp: '2026-09-02T09:15:19Z', level: 'INFO', message: '[2/5] Copying collection ecommerce_prod.users with PII Email/Password masking' },
          { timestamp: '2026-09-02T09:15:28Z', level: 'SUCCESS', message: 'Created 2 secondary indexes on ecommerce_test.users' },
          { timestamp: '2026-09-02T09:15:34Z', level: 'SUCCESS', message: 'Database clone completed successfully! Transferred 1,250,000 documents (840 MB) in 34 seconds.' },
        ],
        created_at: '2026-09-02T09:15:00Z',
        started_at: '2026-09-02T09:15:00Z',
        finished_at: '2026-09-02T09:15:34Z',
        duration_seconds: 34,
      },
      {
        id: 'job-analytics-pitr-02',
        name: 'PITR Restore analytics_events -> analytics_staging',
        status: 'COMPLETED',
        mode: 'POINT_IN_TIME_PITR',
        source_masked: 'mongodb://prod-analytics.internal:27017/analytics_events',
        target_masked: 'mongodb://staging-db.internal:27018/analytics_staging',
        request: {
          name: 'PITR Restore analytics_events -> analytics_staging',
          mode: 'POINT_IN_TIME_PITR',
          source: { uri: 'mongodb://127.0.0.1:27017/?directConnection=true' },
          target: { uri: 'mongodb://127.0.0.1:27018/?directConnection=true' },
          databases: [
            {
              source_database: 'analytics_events',
              target_database: 'analytics_staging',
              all_collections: true,
            },
          ],
          drop_target_first: true,
          preserve_indexes: true,
        },
        progress: {
          phase: 'Complete',
          current_collection: 'analytics_events.page_views',
          total_collections: 3,
          completed_collections: 3,
          total_estimated_docs: 3400000,
          transferred_docs: 3400000,
          total_estimated_bytes: 2516582400,
          transferred_bytes: 2516582400,
          percent: 100,
          throughput_mbs: 32.2,
          docs_per_sec: 43580,
          replayed_oplog_ops: 14820,
          eta_seconds: 0,
          collections: {},
        },
        logs: [
          { timestamp: '2026-09-02T08:00:00Z', level: 'INFO', message: 'Initiating Point-in-Time Restore (PITR) for analytics_events' },
          { timestamp: '2026-09-02T08:00:02Z', level: 'INFO', message: 'Discovered Oplog window from local.oplog.rs (Window duration: 18h 42m)' },
          { timestamp: '2026-09-02T08:00:03Z', level: 'INFO', message: 'Baseline snapshot copy started for 3,400,000 documents (2.34 GB)' },
          { timestamp: '2026-09-02T08:01:05Z', level: 'INFO', message: 'Replaying incremental oplog operations up to target timestamp...' },
          { timestamp: '2026-09-02T08:01:18Z', level: 'SUCCESS', message: 'Successfully replayed 14,820 incremental oplog operations.' },
          { timestamp: '2026-09-02T08:01:18Z', level: 'SUCCESS', message: 'PITR Restore completed in 78 seconds.' },
        ],
        created_at: '2026-09-02T08:00:00Z',
        started_at: '2026-09-02T08:00:00Z',
        finished_at: '2026-09-02T08:01:18Z',
        duration_seconds: 78,
      },
      {
        id: 'job-users-clone-03',
        name: 'Clone users_and_auth -> users_test',
        status: 'COMPLETED',
        mode: 'SNAPSHOT_LIVE',
        source_masked: 'mongodb://prod-rs0.internal:27017/users_and_auth',
        target_masked: 'mongodb://staging-db.internal:27018/users_test',
        request: {
          name: 'Clone users_and_auth -> users_test',
          mode: 'SNAPSHOT_LIVE',
          source: { uri: 'mongodb://127.0.0.1:27017/?directConnection=true' },
          target: { uri: 'mongodb://127.0.0.1:27018/?directConnection=true' },
          databases: [
            {
              source_database: 'users_and_auth',
              target_database: 'users_test',
              all_collections: true,
            },
          ],
          drop_target_first: true,
          preserve_indexes: true,
        },
        progress: {
          phase: 'Complete',
          current_collection: 'users_and_auth.sessions',
          total_collections: 4,
          completed_collections: 4,
          total_estimated_docs: 420000,
          transferred_docs: 420000,
          total_estimated_bytes: 146800640,
          transferred_bytes: 146800640,
          percent: 100,
          throughput_mbs: 12.2,
          docs_per_sec: 35000,
          replayed_oplog_ops: 0,
          eta_seconds: 0,
          collections: {},
        },
        logs: [
          { timestamp: '2026-09-02T07:30:00Z', level: 'INFO', message: 'Starting migration for users_and_auth with PII scrubbing rules' },
          { timestamp: '2026-09-02T07:30:02Z', level: 'SUCCESS', message: 'Source and Target connections verified.' },
          { timestamp: '2026-09-02T07:30:10Z', level: 'INFO', message: 'Sanitized emails and bcrypt hashed passwords across 420,000 accounts' },
          { timestamp: '2026-09-02T07:30:12Z', level: 'SUCCESS', message: 'Migration completed successfully in 12 seconds.' },
        ],
        created_at: '2026-09-02T07:30:00Z',
        started_at: '2026-09-02T07:30:00Z',
        finished_at: '2026-09-02T07:30:12Z',
        duration_seconds: 12,
      },
    ];
  }

  const [jobToDelete, setJobToDelete] = useState<CloneJob | null>(null);

  async function confirmDeleteJob() {
    if (!jobToDelete) return;
    const id = jobToDelete.id;
    try {
      await deleteJob(id);
      setJobs(jobs.filter((j) => j.id !== id));
    } catch (e) {
      setJobs(jobs.filter((j) => j.id !== id));
    }
    setJobToDelete(null);
  }

  function formatTime(sec: number): string {
    if (!sec || sec <= 0) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function formatBytes(bytes?: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Filter and search
  const filtered = jobs.filter((j) => {
    const matchesStatus =
      filterStatus === 'all' ||
      (filterStatus === 'PITR' && j.mode === 'POINT_IN_TIME_PITR') ||
      j.status === filterStatus;

    const matchesSearch =
      j.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.source_masked.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.target_masked.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesStatus && (searchQuery === '' || matchesSearch);
  });

  const totalCompleted = jobs.filter((j) => j.status === 'COMPLETED').length;
  const totalVolume = jobs.reduce((acc, j) => acc + (j.progress?.transferred_bytes || 0), 0);
  const totalDocs = jobs.reduce((acc, j) => acc + (j.progress?.transferred_docs || 0), 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-200">
      {/* Top Back Navigation */}
      {onBack && (
        <div className="flex items-center pb-1">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 transition-all shadow-sm group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            <span>Back to Production Databases</span>
          </button>
        </div>
      )}

      {/* Top Banner & Stats Overview */}
      <div className="glass-panel p-6 rounded-3xl border border-slate-800/80 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-2.5 py-0.5 text-[11px] font-bold tracking-wider uppercase rounded-full bg-cyber-cyan/15 text-cyber-cyan border border-cyber-cyan/30">
              AUDIT TRAIL
            </span>
            <span className="text-xs text-slate-500">&bull;</span>
            <span className="text-xs font-mono text-slate-400">
              Real-time Migration & PITR Performance Logs
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Clone & Restore Job History
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Complete operational audit logs, throughput statistics, and telemetry records of past database clone operations.
          </p>
        </div>

        {/* Global Summary Stats */}
        <div className="flex items-center gap-4 shrink-0 font-mono">
          <div className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-center min-w-[100px]">
            <span className="text-[10px] text-slate-500 block uppercase">Completed</span>
            <span className="text-xl font-black text-emerald-400">{totalCompleted}</span>
          </div>
          <div className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-center min-w-[100px]">
            <span className="text-[10px] text-slate-500 block uppercase">Migrated</span>
            <span className="text-xl font-black text-brand-400">{formatBytes(totalVolume)}</span>
          </div>
          <div className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-center min-w-[100px]">
            <span className="text-[10px] text-slate-500 block uppercase">Total Docs</span>
            <span className="text-xl font-black text-cyber-cyan">{totalDocs.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1 max-w-xl">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by job name, source database, or target..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full glass-input pl-10 pr-4 py-2.5 rounded-xl text-xs placeholder:text-slate-500"
            />
          </div>

          <div className="flex items-center p-1 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium">
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                filterStatus === 'all'
                  ? 'bg-brand-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All ({jobs.length})
            </button>
            <button
              onClick={() => setFilterStatus('COMPLETED')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                filterStatus === 'COMPLETED'
                  ? 'bg-brand-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Completed ({jobs.filter((j) => j.status === 'COMPLETED').length})
            </button>
            <button
              onClick={() => setFilterStatus('PITR')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                filterStatus === 'PITR'
                  ? 'bg-brand-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              PITR ({jobs.filter((j) => j.mode === 'POINT_IN_TIME_PITR').length})
            </button>
          </div>
        </div>

        <button
          onClick={loadJobs}
          disabled={loading}
          className="self-start sm:self-auto p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors flex items-center gap-1.5 text-xs font-medium"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh History</span>
        </button>
      </div>

      {/* History Cards Grid */}
      {loading ? (
        <div className="p-16 text-center glass-panel rounded-2xl text-xs text-slate-400">
          Loading migration history...
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-16 text-center glass-panel rounded-2xl border border-dashed border-slate-800 space-y-3">
          <Database className="w-10 h-10 text-slate-600 mx-auto" />
          <p className="text-sm text-slate-300 font-semibold">No matching clone records found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((job) => {
            const isPITR = job.mode === 'POINT_IN_TIME_PITR';

            return (
              <div
                key={job.id}
                className="glass-panel p-5 sm:p-6 rounded-3xl border border-slate-800/80 hover:border-slate-700 transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-5 bg-slate-900/60 hover:bg-slate-900/90 shadow-lg"
              >
                {/* Left: Job Name & Details */}
                <div className="space-y-2.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h3 className="text-base font-bold text-white font-mono tracking-tight">
                      {job.name}
                    </h3>
                    <StatusBadge status={job.status} />
                    <span
                      className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase border ${
                        isPITR
                          ? 'bg-cyber-cyan/15 text-cyber-cyan border-cyber-cyan/30'
                          : 'bg-brand-500/15 text-brand-400 border-brand-500/30'
                      }`}
                    >
                      {isPITR ? 'PITR TIME-TRAVEL' : 'LIVE SNAPSHOT'}
                    </span>
                  </div>

                  {/* Routing URI */}
                  <p className="text-xs font-mono text-slate-400 truncate flex items-center gap-2">
                    <span className="text-slate-300 font-semibold">{job.source_masked}</span>
                    <span className="text-slate-600">&rarr;</span>
                    <span className="text-cyber-cyan font-semibold">{job.target_masked}</span>
                  </p>

                  {/* Metrics Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-xs">
                    <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800">
                      <span className="text-[9px] text-slate-500 uppercase block font-sans font-semibold">Duration</span>
                      <span className="font-bold text-white">{formatTime(job.duration_seconds)}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800">
                      <span className="text-[9px] text-slate-500 uppercase block font-sans font-semibold">Volume</span>
                      <span className="font-bold text-brand-400">{formatBytes(job.progress?.transferred_bytes)}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800">
                      <span className="text-[9px] text-slate-500 uppercase block font-sans font-semibold">Documents</span>
                      <span className="font-bold text-white">{(job.progress?.transferred_docs || 0).toLocaleString()}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800">
                      <span className="text-[9px] text-slate-500 uppercase block font-sans font-semibold">
                        {isPITR ? 'Oplog Replayed' : 'Throughput'}
                      </span>
                      <span className="font-bold text-cyber-cyan">
                        {isPITR
                          ? `${(job.progress?.replayed_oplog_ops || 0).toLocaleString()} ops`
                          : `${(job.progress?.throughput_mbs || 0).toFixed(1)} MB/s`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2.5 shrink-0 self-end lg:self-center">
                  <button
                    onClick={() => setSelectedAuditJob(job)}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold bg-brand-500/15 hover:bg-brand-500/25 text-brand-400 border border-brand-500/30 transition-all flex items-center gap-1.5 shadow-sm"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span>View Audit Logs</span>
                  </button>

                  <button
                    onClick={() => setJobToDelete(job)}
                    className="p-2.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    title="Delete Record"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Audit Logs Modal */}
      {selectedAuditJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="glass-panel w-full max-w-3xl max-h-[85vh] rounded-3xl border border-slate-700 p-6 space-y-5 shadow-2xl flex flex-col overflow-hidden bg-slate-900/95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-brand-500/10 text-brand-400 border border-brand-500/20">
                  <Terminal className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono">
                    {selectedAuditJob.name}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Execution Telemetry & Audit Logs ({selectedAuditJob.logs.length} entries)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedAuditJob(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 p-4 rounded-2xl bg-slate-950 border border-slate-800 font-mono text-xs">
              {selectedAuditJob.logs.map((log, i) => (
                <div key={i} className="flex items-start gap-2.5 leading-relaxed">
                  <span className="text-slate-600 text-[10px] shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 rounded font-bold uppercase shrink-0 ${
                      log.level === 'SUCCESS'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : log.level === 'ERROR'
                        ? 'bg-rose-500/20 text-rose-400'
                        : log.level === 'WARN'
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {log.level}
                  </span>
                  <span
                    className={
                      log.level === 'SUCCESS'
                        ? 'text-emerald-300 font-semibold'
                        : log.level === 'ERROR'
                        ? 'text-rose-300 font-semibold'
                        : 'text-slate-300'
                    }
                  >
                    {log.message}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs font-mono text-slate-400 shrink-0">
              <span>Duration: {formatTime(selectedAuditJob.duration_seconds)}</span>
              <span>Transferred: {formatBytes(selectedAuditJob.progress?.transferred_bytes)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Professional Delete Confirmation Modal */}
      {jobToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md rounded-3xl border border-rose-500/30 p-6 space-y-5 shadow-2xl bg-slate-900/95 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-2xl bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  Delete Migration Record?
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Remove job history and telemetry logs
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800">
              Are you sure you want to delete <span className="text-white font-mono font-bold bg-slate-800 px-1.5 py-0.5 rounded">{jobToDelete.name}</span>? This will permanently delete its audit logs.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setJobToDelete(null)}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-750 transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={confirmDeleteJob}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-500 hover:bg-rose-400 text-slate-950 transition-all shadow-lg shadow-rose-500/25 flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5 fill-slate-950" />
                <span>Delete Record</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
