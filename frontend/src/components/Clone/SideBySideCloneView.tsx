import React, { useState, useEffect } from 'react';
import {
  CloneJob,
  CloneJobRequest,
  CloneMode,
  MaskRule,
  OplogWindow,
  SavedProfile,
} from '../../types';
import { resumeJob, fetchOplogWindow, listProfiles, saveProfile, updateProfile, deleteProfile, testConnection, startCloneJob, cancelJob, fetchCatalog } from '../../api/client';
import { MetricCard } from '../Common/MetricCard';
import { StatusBadge } from '../Common/StatusBadge';
import confetti from 'canvas-confetti';
import {
  Database,
  ArrowRight,
  ArrowLeft,
  Zap,
  Clock,
  ShieldCheck,
  CheckCircle2,
  Layers,
  StopCircle,
  RotateCcw,
  Check,
  Terminal,
  Plus,
  X,
  Sparkles,
  Loader2,
  FolderTree,
  Edit2,
  Trash2,
  ArrowRightLeft,
  RefreshCw,
} from 'lucide-react';

export interface ProdDatabaseItem {
  id: string;
  profileId?: string;
  name: string;
  clusterName: string;
  clusterUri: string;
  sizeBytes: number;
  totalCollections: number;
  totalDocuments: number;
  collections: Array<{
    name: string;
    docCount: number;
    sizeBytes: number;
    indexesCount: number;
  }>;
}

interface SideBySideCloneViewProps {
  db: ProdDatabaseItem;
  onBack: () => void;
  activeJob: CloneJob | null;
  setActiveJob: React.Dispatch<React.SetStateAction<CloneJob | null>>;
}

function extractDbFromUri(uri: string): string | null {
  if (!uri) return null;
  try {
    const clean = uri.split('?')[0];
    const match = clean.match(/\/([^/?]+)$/);
    if (match && match[1] && !match[1].includes(':') && !match[1].includes('@')) {
      const candidate = match[1].trim();
      if (candidate && !['admin', 'config', 'local'].includes(candidate.toLowerCase())) {
        return candidate;
      }
    }
  } catch (e) {}
  return null;
}

function formatSeconds(sec: number): string {
  if (!sec || sec <= 0) return '0s';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 MB';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export const SideBySideCloneView: React.FC<SideBySideCloneViewProps> = ({
  db,
  onBack,
  activeJob,
  setActiveJob,
}) => {
  // Source selection state
  const [collectionSearch, setCollectionSearch] = useState('');
  const [collectionsList, setCollectionsList] = useState(db.collections);
  const [selectedCollections, setSelectedCollections] = useState<string[]>(
    db.collections.map((c) => c.name)
  );
  const [mode, setMode] = useState<CloneMode>('SNAPSHOT_LIVE');
  const [pitrTargetTime, setPitrTargetTime] = useState<string>(
    new Date().toISOString().slice(0, 16)
  );
  const [pitrTimestamp, setPitrTimestamp] = useState<{ T: number; I: number } | undefined>();
  const [oplogWindow, setOplogWindow] = useState<OplogWindow | null>(null);
  const [sliderVal, setSliderVal] = useState<number>(100);

  // Target selection state
  const [targetProfiles, setTargetProfiles] = useState<SavedProfile[]>([]);
  const [selectedTargetProfileId, setSelectedTargetProfileId] = useState<string>('prof-test-staging');
  const [targetUri, setTargetUri] = useState<string>('mongodb://127.0.0.1:27018/?directConnection=true');
  const [targetDbName, setTargetDbName] = useState<string>(`${db.name}_test`);
  const [targetAvailableDbs, setTargetAvailableDbs] = useState<string[]>([]);

  // Add Target DB / Cluster Modal state
  const [isAddTargetModalOpen, setIsAddTargetModalOpen] = useState(false);
  const [newTargetName, setNewTargetName] = useState('');
  const [newTargetUri, setNewTargetUri] = useState('mongodb://127.0.0.1:27018/?directConnection=true');
  const [testingTarget, setTestingTarget] = useState(false);
  const [targetTestResult, setTargetTestResult] = useState<{ success?: boolean; latency?: number; error?: string } | null>(null);

  // Edit Target DB / Cluster Modal state
  const [isEditTargetModalOpen, setIsEditTargetModalOpen] = useState(false);
  const [editTargetName, setEditTargetName] = useState('');
  const [editTargetUri, setEditTargetUri] = useState('');
  const [testingEditTarget, setTestingEditTarget] = useState(false);
  const [editTargetTestResult, setEditTargetTestResult] = useState<{ success?: boolean; latency?: number; error?: string } | null>(null);

  // Target Collection Remapping state (SourceColl -> TargetColl)
  const [collectionMap, setCollectionMap] = useState<Record<string, string>>({});
  const [targetExistingCollections, setTargetExistingCollections] = useState<string[]>([]);
  const [targetExistingCollsList, setTargetExistingCollsList] = useState<Array<{ name: string; docCount: number; sizeBytes: number }>>([]);
  const [targetTabMode, setTargetTabMode] = useState<'mirror' | 'existing'>('mirror');
  const [editingCollTarget, setEditingCollTarget] = useState<string | null>(null);
  const [customInputColl, setCustomInputColl] = useState<string | null>(null);
  const [customInputVal, setCustomInputVal] = useState<string>('');

  // Options
  const [dropTargetFirst, setDropTargetFirst] = useState(true);
  const [preserveIndexes, setPreserveIndexes] = useState(true);

  const [launching, setLaunching] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refreshingTargetDb, setRefreshingTargetDb] = useState(false);

  useEffect(() => {
    loadTargetProfiles();
    checkOplog();
    loadLiveCollections();
  }, [db]);

  useEffect(() => {
    loadTargetExistingCollections();
  }, [targetUri, targetDbName]);

  async function loadTargetExistingCollections(overrideUri?: string, overrideDbName?: string) {
    const activeUri = overrideUri || targetUri;
    const activeDbName = (overrideDbName !== undefined ? overrideDbName : targetDbName).trim();
    if (!activeUri) return;
    try {
      const cat = await fetchCatalog({ uri: activeUri });
      if (cat && cat.databases && cat.databases.length > 0) {
        const nonSystem = cat.databases
          .filter((d: any) => !['admin', 'config', 'local'].includes(d.name))
          .map((d: any) => d.name);
        setTargetAvailableDbs(nonSystem);

        const matched = cat.databases.find(
          (d: any) => d.name.toLowerCase() === activeDbName.toLowerCase()
        ) || (nonSystem.length > 0
          ? cat.databases.find((d: any) => d.name.toLowerCase() === nonSystem[0].toLowerCase())
          : undefined);

        if (matched && matched.collections) {
          const list = matched.collections.map((c: any) => ({
            name: c.name,
            docCount: c.doc_count || 0,
            sizeBytes: c.storage_size_bytes || 0,
          }));
          setTargetExistingCollsList(list);
          setTargetExistingCollections(list.map((c: any) => c.name));
        } else {
          setTargetExistingCollsList([]);
          setTargetExistingCollections([]);
        }
      }
    } catch (e) {
      // ignore
    }
  }

  async function handleRefreshTargetDb() {
    if (!targetUri) return;
    setRefreshingTargetDb(true);
    try {
      await loadTargetExistingCollections();
    } finally {
      setRefreshingTargetDb(false);
    }
  }

  const allAvailableTargetOptions = Array.from(
    new Set([
      ...collectionsList.map((c) => c.name),
      ...targetExistingCollections,
    ])
  );

  async function loadLiveCollections() {
    try {
      const cat = await fetchCatalog({ uri: db.clusterUri });
      if (cat && cat.databases) {
        const matchedDb = cat.databases.find(
          (d: any) => d.name.toLowerCase() === db.name.toLowerCase()
        ) || cat.databases.find((d: any) => !['admin', 'config', 'local'].includes(d.name));

        if (matchedDb && matchedDb.collections && matchedDb.collections.length > 0) {
          const fresh = matchedDb.collections.map((c: any) => ({
            name: c.name,
            docCount: c.doc_count || 0,
            sizeBytes: c.storage_size_bytes || 0,
            indexesCount: c.indexes?.length || 0,
          }));
          setCollectionsList(fresh);
          setSelectedCollections(fresh.map((c: any) => c.name));
        }
      }
    } catch (e) {
      // ignore
    }
  }

  async function loadTargetProfiles() {
    try {
      let targets: SavedProfile[] = [];

      // Always fetch from backend API — single source of truth
      const list = await listProfiles();
      const apiTargets = list.filter((p) => p.type === 'target');
      if (apiTargets.length > 0) {
        targets = apiTargets;
      }

      // Deduplicate by name — keep the most recent
      const deduped = new Map<string, SavedProfile>();
      targets.forEach((t) => {
        const existing = deduped.get(t.name);
        if (!existing || new Date(t.created_at) > new Date(existing.created_at)) {
          deduped.set(t.name, t);
        }
      });
      targets = Array.from(deduped.values());

      if (targets.length === 0) {
        targets = [
          {
            id: 'prof-test-staging',
            name: 'Staging / QA Test Target (Port 27018)',
            type: 'target',
            config: { uri: 'mongodb://127.0.0.1:27018/?directConnection=true', timeout_ms: 10000 },
            created_at: new Date().toISOString(),
          },
        ];
      }

      setTargetProfiles(targets);

      // Select active target — first in list (backend returns them sorted by created_at)
      const first = targets[0];
      setSelectedTargetProfileId(first.id);
      const uri = first.config.uri || 'mongodb://127.0.0.1:27018/?directConnection=true';
      setTargetUri(uri);
      const uriDb = extractDbFromUri(uri);
      const finalDb = uriDb || `${db.name}_test`;
      setTargetDbName(finalDb);

      // Immediately fetch live collections for this target cluster & database
      loadTargetExistingCollections(uri, finalDb);
    } catch (e) {
      // ignore
    }
  }

  async function checkOplog() {
    try {
      const window = await fetchOplogWindow({ uri: db.clusterUri });
      setOplogWindow(window);
      if (window.available && window.last_timestamp_sec) {
        const date = new Date(window.last_timestamp_sec * 1000);
        setPitrTargetTime(date.toISOString().slice(0, 16));
        setPitrTimestamp({ T: window.last_timestamp_sec, I: window.last_increment });
      }
    } catch (e) {
      // ignore
    }
  }

  function handleSliderChange(val: number) {
    setSliderVal(val);
    if (!oplogWindow || !oplogWindow.available) return;

    const start = oplogWindow.first_timestamp_sec;
    const end = oplogWindow.last_timestamp_sec;
    const targetSec = Math.round(start + (val / 100) * (end - start));

    const date = new Date(targetSec * 1000);
    setPitrTargetTime(date.toISOString().slice(0, 16));
    setPitrTimestamp({ T: targetSec, I: 1 });
  }

  function toggleCollection(collName: string) {
    if (selectedCollections.includes(collName)) {
      setSelectedCollections(selectedCollections.filter((c) => c !== collName));
    } else {
      setSelectedCollections([...selectedCollections, collName]);
    }
  }

  function toggleSelectAllColls() {
    if (selectedCollections.length === collectionsList.length) {
      setSelectedCollections([]);
    } else {
      setSelectedCollections(collectionsList.map((c) => c.name));
    }
  }

  function handleTargetProfileChange(profId: string) {
    setSelectedTargetProfileId(profId);
    const found = targetProfiles.find((p) => p.id === profId);
    if (found) {
      const uri = found.config.uri || 'mongodb://127.0.0.1:27018/?directConnection=true';
      setTargetUri(uri);
      const uriDb = extractDbFromUri(uri);
      let nextDb = `${db.name}_test`;
      if (uriDb) {
        nextDb = uriDb;
      } else if (found.name && !found.name.toLowerCase().includes('staging') && !found.name.toLowerCase().includes('target') && !found.name.toLowerCase().includes('sandbox')) {
        nextDb = found.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      }
      setTargetDbName(nextDb);
      loadTargetExistingCollections(uri, nextDb);
    }
  }

  async function handleTestTargetConn() {
    setTestingTarget(true);
    setTargetTestResult(null);
    try {
      const res = await testConnection({ uri: newTargetUri.trim() });
      setTargetTestResult({
        success: res.success,
        latency: res.server_info?.latency_ms,
        error: res.error,
      });
    } catch (e: any) {
      setTargetTestResult({ success: false, error: e.message || 'Connection failed' });
    } finally {
      setTestingTarget(false);
    }
  }

  async function handleSaveNewTarget() {
    if (!newTargetName.trim() || !newTargetUri.trim()) {
      alert('Please fill in target name and URI');
      return;
    }

    try {
      const saved = await saveProfile(newTargetName.trim(), 'target', { uri: newTargetUri.trim() });
      const updated = [saved, ...targetProfiles.filter((p) => p.id !== saved.id && p.name !== saved.name)];
      setTargetProfiles(updated);
      setSelectedTargetProfileId(saved.id);
      const uri = saved.config.uri || newTargetUri.trim();
      setTargetUri(uri);
      const uriDb = extractDbFromUri(uri);
      if (uriDb) {
        setTargetDbName(uriDb);
      } else {
        const clean = newTargetName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
        setTargetDbName(clean);
      }
      setIsAddTargetModalOpen(false);
      setNewTargetName('');
      setTargetTestResult(null);
    } catch (e: any) {
      alert(`Failed to save target profile: ${e.message}`);
    }
  }

  function handleOpenEditTarget() {
    const current = targetProfiles.find((p) => p.id === selectedTargetProfileId) || targetProfiles[0];
    if (current) {
      setEditTargetName(current.name);
      setEditTargetUri(current.config.uri || targetUri);
      setEditTargetTestResult(null);
      setIsEditTargetModalOpen(true);
    }
  }

  async function handleTestEditTargetConn() {
    setTestingEditTarget(true);
    setEditTargetTestResult(null);
    try {
      const res = await testConnection({ uri: editTargetUri.trim() });
      setEditTargetTestResult({
        success: res.success,
        latency: res.server_info?.latency_ms,
        error: res.error,
      });
    } catch (e: any) {
      setEditTargetTestResult({ success: false, error: e.message || 'Connection failed' });
    } finally {
      setTestingEditTarget(false);
    }
  }

  async function handleSaveEditTarget() {
    if (!editTargetName.trim() || !editTargetUri.trim()) {
      alert('Please fill in target name and URI');
      return;
    }

    try {
      const current = targetProfiles.find((p) => p.id === selectedTargetProfileId);
      if (current) {
        // Persist to backend — upsert by name
        await saveProfile(editTargetName.trim(), 'target', { uri: editTargetUri.trim() });
        // Remove old entry if it was a different name
        if (current.name !== editTargetName.trim()) {
          try { await deleteProfile(current.id); } catch (e) {}
        }
      }

      // Reload from backend to get clean, deduplicated list
      await loadTargetProfiles();

      const uri = editTargetUri.trim();
      setTargetUri(uri);
      const uriDb = extractDbFromUri(uri);
      if (uriDb) {
        setTargetDbName(uriDb);
      }
      setIsEditTargetModalOpen(false);
      setEditTargetTestResult(null);
    } catch (e: any) {
      alert(`Failed to update target profile: ${e.message}`);
    }
  }

  async function handleDeleteTarget() {
    const current = targetProfiles.find((p) => p.id === selectedTargetProfileId);
    if (!current) return;

    try {
      await deleteProfile(current.id);
      // Reload from backend to get fresh list
      await loadTargetProfiles();
    } catch (e: any) {
      alert(`Failed to delete profile: ${e.message}`);
    }
  }

  async function handleLaunch() {
    if (!targetDbName.trim()) {
      alert('Please specify a target database name');
      return;
    }
    if (selectedCollections.length === 0) {
      alert('Please select at least one collection to clone');
      return;
    }

    setLaunching(true);
    try {
      const req: CloneJobRequest = {
        name: `Clone ${db.name} -> ${targetDbName}`,
        mode,
        source: { uri: db.clusterUri, timeout_ms: 10000 },
        target: { uri: targetUri, timeout_ms: 10000 },
        databases: [
          {
            source_database: db.name,
            target_database: targetDbName.trim(),
            all_collections: selectedCollections.length === collectionsList.length,
            collections: selectedCollections,
            collection_map: Object.keys(collectionMap).length > 0 ? collectionMap : undefined,
          },
        ],
        pitr_timestamp: mode === 'POINT_IN_TIME_PITR' ? pitrTimestamp : undefined,
        pitr_target_time: mode === 'POINT_IN_TIME_PITR' ? pitrTargetTime : undefined,
        masking_rules: undefined,
        drop_target_first: dropTargetFirst,
        preserve_indexes: preserveIndexes,
        batch_size: 2500,
        parallel_collections: 4,
        defer_indexes: true,
      };

      const job = await startCloneJob(req);
      setActiveJob(job);
    } catch (e: any) {
      alert(`Failed to launch clone: ${e.message}`);
    } finally {
      setLaunching(false);
    }
  }

  const [resuming, setResuming] = useState(false);

  async function handleResume() {
    if (!activeJob) return;
    setResuming(true);
    try {
      await resumeJob(activeJob.id);
    } catch (e: any) {
      alert(`Failed to resume clone: ${e.message}`);
    } finally {
      setResuming(false);
    }
  }

  async function handleCancel() {
    if (!activeJob) return;
    setCancelling(true);
    try {
      await cancelJob(activeJob.id);
    } catch (e) {
      // ignore
    } finally {
      setCancelling(false);
    }
  }

  function formatBytes(bytes?: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  const isRunning = activeJob && activeJob.status === 'RUNNING';

  return (
    <div className="space-y-3.5 max-w-7xl mx-auto animate-in fade-in duration-200">
      {/* Top Compact Breadcrumb & Navigation Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 transition-all shadow-sm group"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono font-bold text-white text-sm">
              {db.name}
            </span>
            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              PROD
            </span>
            <span className="text-slate-500 font-bold">&rarr;</span>
            <span className="font-mono font-bold text-cyber-cyan text-sm">
              {targetDbName || 'target_db'}
            </span>
            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded uppercase bg-cyber-violet/15 text-cyber-violet border border-cyber-violet/30">
              TEST
            </span>
          </div>
        </div>

        <div className="text-[11px] font-mono text-slate-400">
          Source Volume: <span className="text-white font-bold">{formatBytes(db.sizeBytes)}</span> &bull;{' '}
          <span className="text-brand-400 font-bold">{collectionsList.reduce((acc, c) => acc + c.docCount, 0).toLocaleString()}</span> docs
        </div>
      </div>

      {/* LIVE PROGRESS VIEW (When Job is Active or Running) */}
      {activeJob && (
        <div className="glass-panel-glow p-4 rounded-2xl space-y-3 border border-brand-500/40 bg-slate-900/90 animate-in slide-in-from-top-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="font-bold text-xs text-white font-mono">
                {activeJob.name}
              </span>
              <StatusBadge status={activeJob.status} />
            </div>
            <div className="flex items-center gap-2">
              {isRunning ? (
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="px-3 py-1 rounded-lg text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  <span>{cancelling ? 'Stopping...' : 'Cancel'}</span>
                </button>
              ) : (
                <button
                  onClick={() => setActiveJob(null)}
                  className="px-3 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 flex items-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Configure New Run</span>
                </button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-slate-300 text-[11px]">Phase: {activeJob.progress?.phase || 'Processing'}</span>
              <span className="font-bold text-brand-400 text-sm">
                {(activeJob.progress?.percent || 0).toFixed(1)}%
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-brand-600 via-brand-500 to-cyber-cyan rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, Math.max(0, activeJob.progress?.percent || 0))}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-slate-400">
              <span>Current: {activeJob.progress?.current_collection || 'Transferring collections...'}</span>
              <span>
                {(activeJob.progress?.transferred_docs || 0).toLocaleString()} /{' '}
                {(activeJob.progress?.total_estimated_docs || 0).toLocaleString()} docs
              </span>
            </div>
          </div>

          {/* Telemetry Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MetricCard
              label="Throughput"
              value={`${(activeJob.progress?.throughput_mbs || 0).toFixed(2)} MB/s`}
              subValue={`${activeJob.progress?.docs_per_sec || 0} docs/s`}
              icon={<Zap className="w-3.5 h-3.5" />}
              accentColor="brand"
            />
            <MetricCard
              label="Transferred"
              value={`${(((activeJob.progress?.transferred_bytes || 0) / (1024 * 1024))).toFixed(1)} MB`}
              subValue={`Est. ${(((activeJob.progress?.total_estimated_bytes || 0) / (1024 * 1024))).toFixed(1)} MB`}
              icon={<Layers className="w-3.5 h-3.5" />}
              accentColor="cyan"
            />
            <MetricCard
              label="Collections"
              value={`${activeJob.progress?.completed_collections || 0} / ${activeJob.progress?.total_collections || 0}`}
              icon={<Database className="w-3.5 h-3.5" />}
              accentColor="violet"
            />
            <MetricCard
              label="Elapsed"
              value={formatSeconds(activeJob.duration_seconds || (activeJob.started_at ? Math.max(0, Math.floor((Date.now() - new Date(activeJob.started_at).getTime()) / 1000)) : 0))}
              subValue={`ETA: ${formatSeconds(activeJob.progress?.eta_seconds || 0)}`}
              icon={<Clock className="w-3.5 h-3.5" />}
              accentColor="amber"
            />
          </div>
        </div>
      )}

      {/* COMPACT SIDE BY SIDE FULL-PAGE WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
        {/* LEFT COLUMN: PROD SOURCE */}
        <div className="lg:col-span-5 glass-panel p-4 rounded-2xl border-l-4 border-l-brand-500 space-y-3 bg-slate-900/60 shadow-lg">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-xl bg-brand-500/10 text-brand-400 border border-brand-500/20">
                <Database className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">
                  Source: {db.name}
                </h3>
                <p className="text-[11px] text-slate-400 truncate max-w-[190px]">{db.clusterName}</p>
              </div>
            </div>
            <span className="text-[11px] font-mono text-brand-400 bg-brand-500/10 px-2 py-0.5 rounded-lg border border-brand-500/20 font-bold">
              {formatBytes(db.sizeBytes)}
            </span>
          </div>

          {/* Mode Switcher: Live Snapshot vs PITR */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Restore Mode & Time Selection
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('SNAPSHOT_LIVE')}
                className={`p-2 rounded-xl border text-left text-xs transition-all ${
                  mode === 'SNAPSHOT_LIVE'
                    ? 'bg-brand-500/15 border-brand-500 text-white font-bold ring-1 ring-brand-500/30 shadow-sm'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5 text-brand-400 font-semibold text-xs">
                  <Zap className="w-3.5 h-3.5" />
                  <span>Live Snapshot</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">Instant live state</p>
              </button>

              <button
                type="button"
                onClick={() => setMode('POINT_IN_TIME_PITR')}
                className={`p-2 rounded-xl border text-left text-xs transition-all ${
                  mode === 'POINT_IN_TIME_PITR'
                    ? 'bg-cyber-cyan/15 border-cyber-cyan text-white font-bold ring-1 ring-cyber-cyan/30 shadow-sm'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5 text-cyber-cyan font-semibold text-xs">
                  <Clock className="w-3.5 h-3.5" />
                  <span>PITR Time-Travel</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">Historical timestamp</p>
              </button>
            </div>
          </div>

          {/* PITR Timeline Slider (if selected) */}
          {mode === 'POINT_IN_TIME_PITR' && (
            <div className="p-2.5 rounded-xl bg-slate-950 border border-cyber-cyan/30 space-y-2 text-xs">
              <div className="flex justify-between font-mono text-[11px] text-slate-300">
                <span className="text-slate-500">Oplog Range:</span>
                <span className="text-cyber-cyan font-bold">
                  {oplogWindow?.window_duration_human || 'Active Window'}
                </span>
              </div>

              <input
                type="range"
                min="0"
                max="100"
                value={sliderVal}
                onChange={(e) => handleSliderChange(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyber-cyan"
              />

              <div className="space-y-0.5">
                <span className="text-[9px] text-slate-400 block font-semibold uppercase">
                  Restore Timestamp
                </span>
                <input
                  type="datetime-local"
                  value={pitrTargetTime}
                  onChange={(e) => setPitrTargetTime(e.target.value)}
                  className="w-full glass-input px-2.5 py-1 rounded-lg font-mono text-xs"
                />
              </div>
            </div>
          )}

          {/* Collections Checklist (PROD SOURCE) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                Prod Collections ({selectedCollections.length}/{collectionsList.length})
              </label>
              <button
                type="button"
                onClick={toggleSelectAllColls}
                className="text-[10px] text-brand-400 hover:underline font-medium"
              >
                {selectedCollections.length === collectionsList.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            {/* Quick Filter for large DBs */}
            {collectionsList.length > 6 && (
              <input
                type="text"
                placeholder={`Search ${collectionsList.length} collections...`}
                value={collectionSearch}
                onChange={(e) => setCollectionSearch(e.target.value)}
                className="w-full glass-input px-2.5 py-1 rounded-lg text-[10px] font-mono placeholder:text-slate-500"
              />
            )}

            <div className="min-h-[420px] max-h-[560px] overflow-y-auto space-y-1 p-1.5 rounded-xl bg-slate-950/70 border border-slate-800">
              {collectionsList
                .filter((c) => c.name.toLowerCase().includes(collectionSearch.toLowerCase()))
                .map((c) => {
                  const isSelected = selectedCollections.includes(c.name);
                  return (
                    <div
                      key={c.name}
                      onClick={() => toggleCollection(c.name)}
                      className={`p-1.5 px-2 rounded-lg text-xs font-mono flex items-center justify-between cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-slate-900 border border-brand-500/30 text-white shadow-sm'
                          : 'bg-slate-950/40 border border-slate-850 text-slate-500'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <div
                          className={`w-3.5 h-3.5 rounded flex items-center justify-center border ${
                            isSelected
                              ? 'bg-brand-500 border-brand-500 text-slate-950'
                              : 'border-slate-700'
                          }`}
                        >
                          {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </div>
                        <span className="truncate font-medium text-[11px]">{c.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {c.docCount.toLocaleString()} docs
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {/* MIDDLE COLUMN: STREAM PIPELINE INDICATOR */}
        <div className="lg:col-span-2 flex flex-col items-center justify-center p-2 text-center space-y-2 py-16">
          <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-brand-400 shadow-md shadow-brand-500/10">
            <ArrowRight className="w-5 h-5" />
          </div>
          <div className="text-[10px] font-mono text-slate-400 leading-tight">
            <span className="text-brand-400 font-bold block">In-Memory</span>
            Zero Disk
          </div>
          <div className="px-2 py-0.5 rounded-full bg-cyber-amber/10 border border-cyber-amber/20 text-cyber-amber text-[9px] font-bold">
            PII Anonymized
          </div>
        </div>

        {/* RIGHT COLUMN: TEST TARGET */}
        <div className="lg:col-span-5 glass-panel p-4 rounded-2xl border-l-4 border-l-cyber-violet space-y-3 bg-slate-900/60 shadow-lg">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-xl bg-violet-500/10 text-cyber-violet border border-violet-500/20">
                <Database className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">
                  Target: {targetDbName || 'New Test DB'}
                </h3>
                <p className="text-[11px] text-slate-400">Destination Test Cluster</p>
              </div>
            </div>
            <span className="text-[11px] font-mono text-cyber-violet bg-violet-500/10 px-2 py-0.5 rounded-lg border border-violet-500/20 font-bold">
              TEST DESTINATION
            </span>
          </div>

          {/* Target Cluster Preset Selector + Add & Edit Test DB Buttons */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Target MongoDB Cluster
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleRefreshTargetDb}
                  disabled={refreshingTargetDb}
                  className="text-[10px] text-slate-400 hover:text-cyber-cyan font-semibold flex items-center gap-1 transition-colors"
                  title="Fetch latest databases & collections from target cluster"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshingTargetDb ? 'animate-spin text-cyber-cyan' : ''}`} />
                  <span>{refreshingTargetDb ? 'Refreshing...' : 'Refresh'}</span>
                </button>
                <span className="text-slate-600 text-[10px]">&bull;</span>
                <button
                  type="button"
                  onClick={handleOpenEditTarget}
                  className="text-[10px] text-cyber-violet hover:text-violet-300 font-semibold flex items-center gap-1 transition-colors"
                  title="Edit current Test Cluster endpoint"
                >
                  <Edit2 className="w-3 h-3" />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  onClick={handleDeleteTarget}
                  className="text-[10px] text-slate-500 hover:text-rose-400 font-semibold flex items-center gap-1 transition-colors"
                  title="Remove this Test Cluster endpoint"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Delete</span>
                </button>
                <span className="text-slate-600 text-[10px]">&bull;</span>
                <button
                  type="button"
                  onClick={() => setIsAddTargetModalOpen(true)}
                  className="text-[10px] text-cyber-cyan hover:text-cyan-300 font-semibold flex items-center gap-1 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ Add Test DB</span>
                </button>
              </div>
            </div>

            <select
              value={selectedTargetProfileId}
              onChange={(e) => handleTargetProfileChange(e.target.value)}
              className="w-full glass-input px-2.5 py-1.5 rounded-lg text-xs font-mono"
            >
              {targetProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Target DB Name Input + Refresh Button */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Target Database Name (Test DB)
                </label>
                <button
                  type="button"
                  onClick={handleRefreshTargetDb}
                  disabled={refreshingTargetDb}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1 transition-colors px-2 py-0.5 rounded-md bg-cyan-950/50 hover:bg-cyan-900/60 border border-cyan-500/40 shadow-sm"
                  title="Fetch latest databases & collections from target cluster"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshingTargetDb ? 'animate-spin text-cyan-400' : ''}`} />
                  <span>{refreshingTargetDb ? 'Refreshing...' : 'Refresh DB'}</span>
                </button>
              </div>

              {targetExistingCollections.length > 0 && (
                <span className="text-[10px] text-emerald-400 font-mono font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>{targetExistingCollections.length} existing collections in target</span>
                </span>
              )}
            </div>

            <div className="relative">
              <input
                type="text"
                value={targetDbName}
                onChange={(e) => setTargetDbName(e.target.value)}
                className="w-full glass-input px-3 py-1.5 rounded-lg font-mono text-xs text-cyber-cyan font-bold"
                placeholder="e.g. birats_db, ecommerce_prod_test"
                list="target-dbs-datalist"
              />
              <datalist id="target-dbs-datalist">
                {targetAvailableDbs.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>

            {/* Quick Suggestions for Discovered Databases on Target Cluster */}
            {targetAvailableDbs.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-[9px] text-slate-500 font-sans">Discovered on Target:</span>
                {targetAvailableDbs.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setTargetDbName(d);
                      loadTargetExistingCollections(targetUri, d);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-all ${
                      targetDbName === d
                        ? 'bg-cyan-500/20 text-cyber-cyan border border-cyan-500/40 font-bold'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {d}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const fallbackName = `${db.name}_test`;
                    setTargetDbName(fallbackName);
                    loadTargetExistingCollections(targetUri, fallbackName);
                  }}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-all ${
                    targetDbName === `${db.name}_test`
                      ? 'bg-violet-500/20 text-cyber-violet border border-violet-500/40 font-bold'
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  +{db.name}_test
                </button>
              </div>
            )}
          </div>

          {/* Target Collections Header + Dual Tabs (Planned Clones vs Live Existing Collections) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setTargetTabMode('mirror')}
                  className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-all flex items-center gap-1.5 ${
                    targetTabMode === 'mirror'
                      ? 'bg-cyber-violet/20 text-cyber-violet border border-cyber-violet/40 shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <FolderTree className="w-3 h-3" />
                  <span>Clone Plan ({selectedCollections.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTargetTabMode('existing')}
                  className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-all flex items-center gap-1.5 ${
                    targetTabMode === 'existing'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Database className="w-3 h-3" />
                  <span>Existing in {targetDbName || 'DB'} ({targetExistingCollsList.length})</span>
                </button>
              </div>

              <span className="text-[9px] font-mono text-slate-500 truncate max-w-[140px]">
                &rarr; {targetDbName || 'test_db'}
              </span>
            </div>

            <div className="min-h-[380px] max-h-[500px] overflow-y-auto space-y-1.5 p-1.5 rounded-xl bg-slate-950/70 border border-slate-800">
              {targetTabMode === 'existing' ? (
                /* TAB 2: LIVE EXISTING COLLECTIONS ON TARGET DB */
                targetExistingCollsList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center space-y-2.5 text-slate-500">
                    <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-slate-600">
                      <Database className="w-7 h-7" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-300">No existing collections in {targetDbName || 'target DB'}</p>
                      <p className="text-[11px] text-slate-500 max-w-xs">
                        This database is currently empty on the test cluster. Collections will be created automatically upon cloning.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="px-2 py-1 text-[10px] text-slate-400 font-sans flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                      <span>Live collections currently present in <strong>{targetDbName}</strong>:</span>
                      <span className="text-emerald-400 font-mono font-bold">{targetExistingCollsList.length} total</span>
                    </div>

                    {targetExistingCollsList.map((ec) => (
                      <div
                        key={`existing-${ec.name}`}
                        className="p-2 px-2.5 rounded-lg text-xs font-mono flex items-center justify-between gap-2 bg-slate-900/90 border border-emerald-500/30 text-slate-200 shadow-sm group hover:border-emerald-500/60 transition-all"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                          <div className="flex items-center gap-1.5 min-w-0 truncate">
                            <span className="text-slate-500 text-[10px]">{targetDbName}.</span>
                            <span className="font-bold text-emerald-300 text-[12px] truncate">{ec.name}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-sans font-bold">
                            Live on Target
                          </span>
                          <span className="text-[11px] font-mono text-slate-400 font-semibold">
                            {ec.docCount.toLocaleString()} docs
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                /* TAB 1: PLANNED CLONE OUTPUT MIRROR */
                selectedCollections.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center space-y-2.5 text-slate-500">
                    <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-slate-600">
                      <FolderTree className="w-7 h-7" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-300">No collections selected</p>
                      <p className="text-[11px] text-slate-500 max-w-xs">
                        Check any collection on the left (PROD Source) to add it to the destination clone list.
                      </p>
                    </div>
                  </div>
                ) : (
                  collectionsList
                    .filter((c) => selectedCollections.includes(c.name))
                    .filter((c) => c.name.toLowerCase().includes(collectionSearch.toLowerCase()))
                    .map((c) => {
                      const mappedTarget = collectionMap[c.name] || c.name;
                      const isMappedOther = mappedTarget !== c.name;
                      const isEditing = editingCollTarget === c.name;
                      const isEnteringCustom = customInputColl === c.name;
                      const isOverwritingExisting = targetExistingCollections.includes(mappedTarget);

                      return (
                        <div
                          key={`target-${c.name}`}
                          className={`p-1.5 px-2.5 rounded-lg text-xs font-mono flex items-center justify-between gap-2 transition-all group ${
                            isMappedOther
                              ? 'bg-cyan-950/40 border border-cyber-cyan/50 text-slate-100 shadow-sm'
                              : isOverwritingExisting
                              ? 'bg-slate-900/90 border border-amber-500/40 text-slate-200'
                              : 'bg-slate-900/90 border border-cyber-violet/40 text-slate-200'
                          }`}
                        >
                        {isEditing ? (
                          <div className="flex items-center gap-1.5 flex-1 min-w-0 py-0.5">
                            <span className="text-slate-400 font-mono text-[10px] shrink-0">
                              {targetDbName || 'test_db'}.
                            </span>

                            {isEnteringCustom ? (
                              <div className="flex items-center gap-1 flex-1">
                                <input
                                  type="text"
                                  value={customInputVal}
                                  onChange={(e) => setCustomInputVal(e.target.value)}
                                  placeholder="enter collection name..."
                                  className="glass-input px-2 py-0.5 rounded text-[11px] font-mono text-cyan-300 font-bold bg-slate-950 border border-cyan-500/50 flex-1"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      const val = customInputVal.trim();
                                      if (val && val !== c.name) {
                                        setCollectionMap((prev) => ({ ...prev, [c.name]: val }));
                                      } else {
                                        const next = { ...collectionMap };
                                        delete next[c.name];
                                        setCollectionMap(next);
                                      }
                                      setCustomInputColl(null);
                                      setEditingCollTarget(null);
                                    }
                                    if (e.key === 'Escape') {
                                      setCustomInputColl(null);
                                      setEditingCollTarget(null);
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const val = customInputVal.trim();
                                    if (val && val !== c.name) {
                                      setCollectionMap((prev) => ({ ...prev, [c.name]: val }));
                                    } else {
                                      const next = { ...collectionMap };
                                      delete next[c.name];
                                      setCollectionMap(next);
                                    }
                                    setCustomInputColl(null);
                                    setEditingCollTarget(null);
                                  }}
                                  className="px-1.5 py-0.5 rounded bg-cyan-500 text-slate-950 font-bold text-[9px] hover:bg-cyan-400"
                                >
                                  ✓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCustomInputColl(null);
                                    setEditingCollTarget(null);
                                  }}
                                  className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[9px] hover:text-white"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 flex-1">
                                <select
                                  value={mappedTarget}
                                  autoFocus
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '__custom__') {
                                      setCustomInputColl(c.name);
                                      setCustomInputVal(mappedTarget);
                                    } else {
                                      if (val === c.name) {
                                        const next = { ...collectionMap };
                                        delete next[c.name];
                                        setCollectionMap(next);
                                      } else {
                                        setCollectionMap((prev) => ({ ...prev, [c.name]: val }));
                                      }
                                      setEditingCollTarget(null);
                                    }
                                  }}
                                  className="glass-input px-2 py-0.5 rounded text-[11px] font-mono text-cyan-300 font-bold bg-slate-950 border border-cyan-500/50 flex-1 max-w-[220px]"
                                >
                                  <option value={c.name} className="bg-slate-900 text-white font-normal">
                                    {c.name} (Match Source)
                                  </option>
                                  <optgroup label="Map to Existing Target Collection" className="bg-slate-900 text-emerald-300">
                                    {targetExistingCollections
                                      .filter((name) => name !== c.name)
                                      .map((name) => (
                                        <option key={name} value={name} className="bg-slate-900 text-emerald-300">
                                          &rarr; {name} (Existing on Target)
                                        </option>
                                      ))}
                                  </optgroup>
                                  <optgroup label="Map to Other Name" className="bg-slate-900 text-slate-300">
                                    {allAvailableTargetOptions
                                      .filter((name) => name !== c.name && !targetExistingCollections.includes(name))
                                      .map((name) => (
                                        <option key={name} value={name} className="bg-slate-900 text-cyan-300">
                                          &rarr; {name}
                                        </option>
                                      ))}
                                  </optgroup>
                                  <option value="__custom__" className="bg-slate-900 text-amber-300 font-semibold">
                                    ✎ + Type Custom Name...
                                  </option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() => setEditingCollTarget(null)}
                                  className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[9px] hover:text-white"
                                >
                                  ✕
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <div
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  isMappedOther
                                    ? 'bg-cyber-cyan animate-pulse'
                                    : isOverwritingExisting
                                    ? 'bg-amber-400 animate-pulse'
                                    : 'bg-cyber-violet animate-pulse'
                                }`}
                              />
                              <div className="flex items-center gap-1 min-w-0 flex-1" title={`${targetDbName || 'test_db'}.${mappedTarget}`}>
                                <span className="text-slate-400 font-mono text-[10px] shrink-0">
                                  {targetDbName || 'test_db'}.
                                </span>
                                <span
                                  className={`font-semibold truncate text-[11px] ${
                                    isMappedOther ? 'text-cyber-cyan font-bold' : isOverwritingExisting ? 'text-amber-200' : 'text-white'
                                  }`}
                                >
                                  {mappedTarget}
                                </span>
                                {isMappedOther && (
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-sans font-semibold shrink-0" title={`Mapped from PROD collection: ${c.name}`}>
                                    &larr; {c.name}
                                  </span>
                                )}
                                {isOverwritingExisting && (
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-sans font-semibold shrink-0" title="This collection already exists on the target cluster">
                                    Existing
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCollTarget(c.name);
                                  setCustomInputColl(null);
                                }}
                                className="px-1.5 py-0.5 rounded text-[9px] font-sans font-semibold text-slate-400 hover:text-cyber-cyan hover:bg-cyan-500/10 border border-transparent hover:border-cyan-500/30 transition-all opacity-0 group-hover:opacity-100 flex items-center gap-0.5"
                                title="Map to a different collection name"
                              >
                                <ArrowRightLeft className="w-2.5 h-2.5" />
                                <span>Map</span>
                              </button>

                              {isMappedOther && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = { ...collectionMap };
                                    delete next[c.name];
                                    setCollectionMap(next);
                                  }}
                                  className="text-[9px] text-slate-500 hover:text-slate-300 px-1 font-sans"
                                  title="Reset to matching name"
                                >
                                  Reset
                                </button>
                              )}

                              <span className="px-1.5 py-0.2 rounded text-[9px] bg-cyber-violet/15 text-cyber-violet border border-cyber-violet/30 font-sans font-semibold">
                                Replicating
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {c.docCount.toLocaleString()}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )
              )}
            </div>
          </div>

          {/* Execution Options */}
          <div className="space-y-1 pt-1 border-t border-slate-800/60 text-[10px]">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dropTargetFirst}
                  onChange={(e) => setDropTargetFirst(e.target.checked)}
                  className="rounded border-slate-700 text-rose-500 focus:ring-0"
                />
                <span>Drop Target First</span>
              </label>

              <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preserveIndexes}
                  onChange={(e) => setPreserveIndexes(e.target.checked)}
                  className="rounded border-slate-700 text-brand-500 focus:ring-0"
                />
                <span>Replicate Indexes</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Enterprise-Grade Sticky Action Dock */}
      <div className="sticky bottom-4 z-30 glass-panel-glow p-3 px-5 rounded-2xl border border-brand-500/30 bg-slate-900/95 shadow-2xl backdrop-blur-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-brand-500/15 text-brand-400 border border-brand-500/30 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 fill-brand-400" />
          </div>
          <div className="space-y-0.5">
            <div className="text-xs font-bold text-white flex items-center gap-2">
              <span>Ready to Clone</span>
              <span className="text-slate-600">&bull;</span>
              <span className="text-brand-400 font-mono">{selectedCollections.length} Collections</span>
              <span className="text-slate-600">&bull;</span>
              <span className="text-slate-300 font-mono text-[11px]">{formatBytes(db.sizeBytes)}</span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
              <span className="text-emerald-400 font-bold">{db.name}</span>
              <span className="text-[9px] px-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase font-sans">PROD</span>
              <span className="text-slate-500 font-bold">&rarr;</span>
              <span className="text-cyber-cyan font-bold">{targetDbName || 'test_db'}</span>
              <span className="text-[9px] px-1 rounded bg-cyber-violet/10 text-cyber-violet border border-cyber-violet/20 uppercase font-sans">TEST</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">

          <button
            onClick={onBack}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-950/80 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={handleLaunch}
            disabled={launching || isRunning || selectedCollections.length === 0 || !targetDbName.trim()}
            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black bg-gradient-to-r from-brand-500 via-brand-400 to-emerald-400 text-slate-950 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-500/25 transition-all"
          >
            <Zap className="w-3.5 h-3.5 fill-slate-950" />
            <span>
              {launching ? 'Starting Migration...' : isRunning ? 'Migration Running...' : 'Start Cloning Now'}
            </span>
          </button>
        </div>
      </div>

      {/* Add Target Test Database Modal */}
      {isAddTargetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="glass-panel w-full max-w-lg rounded-3xl border border-slate-700 p-6 space-y-5 shadow-2xl bg-slate-900/95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-violet-500/10 text-cyber-violet border border-violet-500/20">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono">
                    Register Test MongoDB Destination
                  </h3>
                  <p className="text-xs text-slate-400">
                    Add a QA, Staging, or Local Test cluster endpoint
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAddTargetModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
                  Test Cluster / Destination Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. QA Staging Cluster, Local Docker Test Port 27018"
                  value={newTargetName}
                  onChange={(e) => setNewTargetName(e.target.value)}
                  className="w-full glass-input px-3.5 py-2.5 rounded-xl font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
                  Test MongoDB Connection URI *
                </label>
                <input
                  type="text"
                  placeholder="mongodb://127.0.0.1:27018/?directConnection=true"
                  value={newTargetUri}
                  onChange={(e) => setNewTargetUri(e.target.value)}
                  className="w-full glass-input px-3.5 py-2.5 rounded-xl font-mono text-xs"
                />
              </div>

              {/* Test Target Connection Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleTestTargetConn}
                  disabled={testingTarget || !newTargetUri.trim()}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center gap-2 font-semibold transition-colors"
                >
                  {testingTarget ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-cyber-cyan" />
                      <span>Testing Endpoint Connectivity...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 text-cyber-cyan" />
                      <span>Test Target Connection</span>
                    </>
                  )}
                </button>

                {targetTestResult && (
                  <div
                    className={`mt-2.5 p-3 rounded-xl border text-xs font-mono ${
                      targetTestResult.success
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {targetTestResult.success ? (
                      <span className="flex items-center gap-1.5 font-semibold">
                        <CheckCircle2 className="w-4 h-4" />
                        Target Connected Successfully ({targetTestResult.latency}ms ping)
                      </span>
                    ) : (
                      <span>{targetTestResult.error || 'Connection failed'}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setIsAddTargetModalOpen(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNewTarget}
                disabled={!newTargetName.trim() || !newTargetUri.trim()}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-cyber-violet text-white hover:bg-violet-600 disabled:opacity-50 transition-all shadow-md shadow-violet-500/20"
              >
                Save & Select Target
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Target Test Database Modal */}
      {isEditTargetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="glass-panel w-full max-w-lg rounded-3xl border border-slate-700 p-6 space-y-5 shadow-2xl bg-slate-900/95 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-violet-500/10 text-cyber-violet border border-violet-500/20">
                  <Edit2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono">
                    Edit Test Destination Cluster
                  </h3>
                  <p className="text-xs text-slate-400">
                    Update Test/Staging connection endpoint and label
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsEditTargetModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
                  Test Cluster / Destination Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. QA Staging Cluster"
                  value={editTargetName}
                  onChange={(e) => setEditTargetName(e.target.value)}
                  className="w-full glass-input px-3.5 py-2.5 rounded-xl font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
                  Test MongoDB Connection URI *
                </label>
                <input
                  type="text"
                  placeholder="mongodb://127.0.0.1:27018/?directConnection=true"
                  value={editTargetUri}
                  onChange={(e) => setEditTargetUri(e.target.value)}
                  className="w-full glass-input px-3.5 py-2.5 rounded-xl font-mono text-xs"
                />
              </div>

              {/* Test Target Connection Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleTestEditTargetConn}
                  disabled={testingEditTarget || !editTargetUri.trim()}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center gap-2 font-semibold transition-colors"
                >
                  {testingEditTarget ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-cyber-cyan" />
                      <span>Testing Endpoint Connectivity...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 text-cyber-cyan" />
                      <span>Test Target Connection</span>
                    </>
                  )}
                </button>

                {editTargetTestResult && (
                  <div
                    className={`mt-2.5 p-3 rounded-xl border text-xs font-mono ${
                      editTargetTestResult.success
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {editTargetTestResult.success ? (
                      <span className="flex items-center gap-1.5 font-semibold">
                        <CheckCircle2 className="w-4 h-4" />
                        Target Connected Successfully ({editTargetTestResult.latency}ms ping)
                      </span>
                    ) : (
                      <span>{editTargetTestResult.error || 'Connection failed'}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setIsEditTargetModalOpen(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEditTarget}
                disabled={!editTargetName.trim() || !editTargetUri.trim()}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-cyber-violet text-white hover:bg-violet-600 disabled:opacity-50 transition-all shadow-md shadow-violet-500/20"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
