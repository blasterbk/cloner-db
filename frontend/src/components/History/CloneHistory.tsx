import React, { useState, useEffect } from 'react';
import { CloneJob } from '../../types';
import { listJobs, deleteJob, deleteJobsBulk, clearAllJobs, resumeJob } from '../../api/client';
import { StatusBadge } from '../Common/StatusBadge';
import {
  Trash2,
  RefreshCw,
  Database,
  Search,
  Terminal,
  X,
  ArrowLeft,
  Play,
  CheckSquare,
  Square,
  MinusSquare,
  Eraser,
  AlertTriangle,
  Download,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const PAGE_SIZE = 10;

interface CloneHistoryProps {
  onSelectJob: (job: CloneJob) => void;
  onBack?: () => void;
  /** ID of the currently running job, if any. When set, auto-refreshes the list every 5s. */
  activeJobId?: string;
  /** Whether the WebSocket is connected. Used to decide polling interval. */
  wsConnected?: boolean;
}

export const CloneHistory: React.FC<CloneHistoryProps> = ({ onSelectJob, onBack, activeJobId, wsConnected }) => {
  const [jobs, setJobs] = useState<CloneJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedAuditJob, setSelectedAuditJob] = useState<CloneJob | null>(null);

  // Single delete modal
  const [jobToDelete, setJobToDelete] = useState<CloneJob | null>(null);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  // Bulk delete modal
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);

  // Clear all modal
  const [showClearAllModal, setShowClearAllModal] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    loadJobs();
  }, []);

  // Auto-refresh every 5s while a RUNNING job exists and this tab is visible.
  // Falls back to 3s when WebSocket is also disconnected (double fallback for reliability).
  useEffect(() => {
    if (!activeJobId) return; // no running job — no need to poll
    const interval = !wsConnected ? 3000 : 5000;
    const id = setInterval(() => {
      loadJobs();
    }, interval);
    return () => clearInterval(id);
  }, [activeJobId, wsConnected]);

  // Reset to page 1 whenever search or filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterStatus]);

  async function loadJobs() {
    setLoading(true);
    try {
      const data = await listJobs();
      setJobs(data && data.length > 0 ? data : []);
    } catch (e) {
      console.error('Failed to load jobs list:', e);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }

  // ─── Filter & search ─────────────────────────────────────────────────────────
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

  // ─── Single delete ────────────────────────────────────────────────────────────
  async function confirmDeleteJob() {
    if (!jobToDelete) return;
    const id = jobToDelete.id;
    try { await deleteJob(id); } catch (_) {}
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setJobToDelete(null);
  }

  // ─── Multi-select helpers ─────────────────────────────────────────────────────
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  // Pagination derived values
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((safeCurrentPage - 1) * PAGE_SIZE, safeCurrentPage * PAGE_SIZE);

  const allFilteredIds = filtered.map((j) => j.id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id));
  const someSelected = allFilteredIds.some((id) => selectedIds.has(id));

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        allFilteredIds.forEach((id) => n.delete(id));
        return n;
      });
    } else {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        allFilteredIds.forEach((id) => n.add(id));
        return n;
      });
    }
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  // ─── Bulk delete ──────────────────────────────────────────────────────────────
  async function confirmBulkDelete() {
    const ids = Array.from(selectedIds);
    try { await deleteJobsBulk(ids); } catch (_) {}
    setJobs((prev) => prev.filter((j) => !selectedIds.has(j.id)));
    setSelectedIds(new Set());
    setSelectMode(false);
    setShowBulkDeleteModal(false);
  }

  // ─── Clear all ────────────────────────────────────────────────────────────────
  async function confirmClearAll() {
    try { await clearAllJobs(); } catch (_) {}
    // Remove all non-running jobs from local state
    setJobs((prev) => prev.filter((j) => j.status === 'RUNNING'));
    setSelectedIds(new Set());
    setSelectMode(false);
    setShowClearAllModal(false);
  }

  const selectedCount = Array.from(selectedIds).filter((id) =>
    filtered.some((j) => j.id === id)
  ).length;

  // ─── Audit Log Export ─────────────────────────────────────────────────────
  function downloadAuditLogs(job: CloneJob) {
    const lines: string[] = [
      `MongoClone — Audit Log Export`,
      `Job: ${job.name}`,
      `Status: ${job.status}`,
      `Mode: ${job.mode}`,
      `Source: ${job.source_masked}`,
      `Target: ${job.target_masked}`,
      `Duration: ${formatTime(job.duration_seconds)}`,
      `Documents: ${(job.progress?.transferred_docs || 0).toLocaleString()}`,
      `Volume: ${formatBytes(job.progress?.transferred_bytes)}`,
      `Exported: ${new Date().toISOString()}`,
      `─`.repeat(60),
      '',
      ...job.logs.map(
        (l) =>
          `[${new Date(l.timestamp).toISOString()}] [${l.level.padEnd(7)}] ${l.message}`
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mongoclone-audit-${job.id.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-200">
      {/* Back Navigation */}
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

      {/* Top Banner & Stats */}
      <div className="glass-panel p-6 rounded-3xl border border-slate-800/80 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-2.5 py-0.5 text-[11px] font-bold tracking-wider uppercase rounded-full bg-cyber-cyan/15 text-cyber-cyan border border-cyber-cyan/30">
              AUDIT TRAIL
            </span>
            <span className="text-xs text-slate-500">&bull;</span>
            <span className="text-xs font-mono text-slate-400">
              Real-time Migration &amp; PITR Performance Logs
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Clone &amp; Restore Job History
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

      {/* Filter / Search / Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: Search + Filters */}
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

        {/* Right: Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Select / Exit select mode */}
          {!selectMode ? (
            <button
              onClick={() => setSelectMode(true)}
              disabled={filtered.length === 0}
              className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors flex items-center gap-1.5 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              title="Select multiple records"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>Select</span>
            </button>
          ) : (
            <button
              onClick={exitSelectMode}
              className="p-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white border border-slate-600 transition-colors flex items-center gap-1.5 text-xs font-medium"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancel</span>
            </button>
          )}

          {/* Clear All History */}
          {!selectMode && (
            <button
              onClick={() => setShowClearAllModal(true)}
              disabled={jobs.filter((j) => j.status !== 'RUNNING').length === 0}
              className="p-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:border-rose-500/50 transition-colors flex items-center gap-1.5 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              title="Clear all history"
            >
              <Eraser className="w-3.5 h-3.5" />
              <span>Clear History</span>
            </button>
          )}

          {/* Bulk Delete (shown when in select mode and something is selected) */}
          {selectMode && selectedIds.size > 0 && (
            <button
              onClick={() => setShowBulkDeleteModal(true)}
              className="p-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-950 border border-rose-400 transition-colors flex items-center gap-1.5 text-xs font-bold shadow-lg shadow-rose-500/25"
            >
              <Trash2 className="w-3.5 h-3.5 fill-slate-950" />
              <span>Delete {selectedIds.size} Selected</span>
            </button>
          )}

          {/* Refresh */}
          <button
            onClick={loadJobs}
            disabled={loading}
            className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors flex items-center gap-1.5 text-xs font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Select All / Deselect bar (when in select mode) */}
      {selectMode && filtered.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-slate-900/80 border border-slate-700/60 text-xs">
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors font-medium"
          >
            {allSelected ? (
              <CheckSquare className="w-4 h-4 text-brand-400" />
            ) : someSelected ? (
              <MinusSquare className="w-4 h-4 text-brand-400" />
            ) : (
              <Square className="w-4 h-4" />
            )}
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">
            {selectedIds.size} of {filtered.length} selected
          </span>
          {selectedIds.size > 0 && (
            <>
              <span className="text-slate-600">|</span>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-slate-500 hover:text-slate-300 transition-colors"
              >
                Clear selection
              </button>
            </>
          )}
        </div>
      )}

      {/* History Cards */}
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
          {paginated.map((job) => {
            const isPITR = job.mode === 'POINT_IN_TIME_PITR';
            const isSelected = selectedIds.has(job.id);

            return (
              <div
                key={job.id}
                className={`glass-panel p-5 sm:p-6 rounded-3xl border transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-5 bg-slate-900/60 hover:bg-slate-900/90 shadow-lg ${
                  isSelected
                    ? 'border-brand-500/60 bg-brand-500/5 shadow-brand-500/10'
                    : 'border-slate-800/80 hover:border-slate-700'
                }`}
              >
                {/* Checkbox (shown in select mode) */}
                {selectMode && (
                  <button
                    onClick={() => toggleSelect(job.id)}
                    className="shrink-0 self-start lg:self-center -ml-1"
                    aria-label={isSelected ? 'Deselect' : 'Select'}
                  >
                    {isSelected ? (
                      <CheckSquare className="w-5 h-5 text-brand-400" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-600 hover:text-slate-400 transition-colors" />
                    )}
                  </button>
                )}

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
                  {(job.status === 'PAUSED' || job.status === 'CANCELLED' || job.status === 'FAILED') && (
                    <button
                      onClick={async () => {
                        try {
                          await resumeJob(job.id);
                          onSelectJob(job);
                        } catch (e: any) {
                          alert(`Failed to resume job: ${e.message}`);
                        }
                      }}
                      className="px-3.5 py-2.5 rounded-xl text-xs font-bold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition-all flex items-center gap-1.5 shadow-sm"
                      title="Resume migration from checkpoint"
                    >
                      <Play className="w-3.5 h-3.5 fill-emerald-300" />
                      <span>Resume</span>
                    </button>
                  )}

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

      {/* ─── Pagination Controls ──────────────────────────────────────────────── */}
      {!loading && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between px-1 text-xs">
          <span className="text-slate-500 font-mono">
            Showing {(safeCurrentPage - 1) * PAGE_SIZE + 1}–{Math.min(safeCurrentPage * PAGE_SIZE, filtered.length)} of {filtered.length} records
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safeCurrentPage === 1}
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              // Windowed page numbers: always show first, last, and 2 around current
              let page: number;
              if (totalPages <= 7) {
                page = i + 1;
              } else if (safeCurrentPage <= 4) {
                page = i + 1 <= 5 ? i + 1 : i === 5 ? -1 : totalPages;
              } else if (safeCurrentPage >= totalPages - 3) {
                page = i === 0 ? 1 : i === 1 ? -1 : totalPages - (6 - i);
              } else {
                const map = [1, -1, safeCurrentPage - 1, safeCurrentPage, safeCurrentPage + 1, -1, totalPages];
                page = map[i];
              }
              if (page === -1) {
                return (
                  <span key={`ellipsis-${i}`} className="px-1.5 text-slate-600">…</span>
                );
              }
              return (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-7 h-7 rounded-lg text-xs font-semibold transition-all ${
                    page === safeCurrentPage
                      ? 'bg-brand-500 text-slate-950 shadow font-bold'
                      : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  }`}
                >
                  {page}
                </button>
              );
            })}

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safeCurrentPage === totalPages}
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ─── Audit Logs Modal ───────────────────────────────────────────────────── */}
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
                    Execution Telemetry &amp; Audit Logs ({selectedAuditJob.logs.length} entries)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadAuditLogs(selectedAuditJob)}
                  title="Download logs as .txt"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .txt</span>
                </button>
                <button
                  onClick={() => setSelectedAuditJob(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
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

      {/* ─── Single Delete Confirmation Modal ──────────────────────────────────── */}
      {jobToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md rounded-3xl border border-rose-500/30 p-6 space-y-5 shadow-2xl bg-slate-900/95 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-2xl bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Delete Migration Record?</h3>
                <p className="text-xs text-slate-400 mt-0.5">Remove job history and telemetry logs</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800">
              Are you sure you want to delete{' '}
              <span className="text-white font-mono font-bold bg-slate-800 px-1.5 py-0.5 rounded">
                {jobToDelete.name}
              </span>
              ? This will permanently delete its audit logs.
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

      {/* ─── Bulk Delete Confirmation Modal ────────────────────────────────────── */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md rounded-3xl border border-rose-500/30 p-6 space-y-5 shadow-2xl bg-slate-900/95 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-2xl bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  Delete {selectedIds.size} Record{selectedIds.size !== 1 ? 's' : ''}?
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Bulk delete selected migration records</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800">
              This will permanently delete{' '}
              <span className="text-rose-300 font-bold">{selectedIds.size} selected record{selectedIds.size !== 1 ? 's' : ''}</span>{' '}
              and all their associated audit logs. This action cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowBulkDeleteModal(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmBulkDelete}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-500 hover:bg-rose-400 text-slate-950 transition-all shadow-lg shadow-rose-500/25 flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5 fill-slate-950" />
                <span>Delete {selectedIds.size} Record{selectedIds.size !== 1 ? 's' : ''}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Clear All History Confirmation Modal ──────────────────────────────── */}
      {showClearAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md rounded-3xl border border-amber-500/30 p-6 space-y-5 shadow-2xl bg-slate-900/95 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Clear All History?</h3>
                <p className="text-xs text-slate-400 mt-0.5">Wipe all completed, failed and paused records</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800">
              This will permanently delete{' '}
              <span className="text-amber-300 font-bold">all non-running job records</span>{' '}
              ({jobs.filter((j) => j.status !== 'RUNNING').length} records) and their audit logs.
              Currently <span className="text-emerald-300 font-bold">running</span> jobs will be preserved.
              This action cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowClearAllModal(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmClearAll}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition-all shadow-lg shadow-amber-500/25 flex items-center gap-1.5"
              >
                <Eraser className="w-3.5 h-3.5" />
                <span>Clear All History</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
