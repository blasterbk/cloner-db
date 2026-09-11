import React, { useState, useEffect } from 'react';
import {
  streamConnectionsOverview,
  listProfiles,
  saveProfile,
  updateProfile,
  deleteProfile,
  testConnection,
} from '../../api/client';
import {
  FlaskConical,
  Zap,
  Search,
  RefreshCw,
  Plus,
  X,
  Check,
  AlertTriangle,
  Trash2,
  Edit2,
  Loader2,
  Database,
  Server,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TestDatabaseItem {
  id: string;
  profileId?: string;
  name: string;
  actualDbName?: string;
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

interface TestDashboardProps {
  resetKey?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function extractDbFromProfile(name: string): string {
  const match = name.match(/\(([^)]+)\)$/);
  if (match && match[1]) return match[1].trim();
  return name.trim();
}

function extractClusterFromProfile(name: string, dbName: string): string {
  const match = name.match(/^(.*?)\s*\(([^)]+)\)$/);
  if (match) {
    const c = match[1].trim();
    const inner = match[2].trim();
    if (c && c.toLowerCase() !== inner.toLowerCase() && c.toLowerCase() !== dbName.toLowerCase()) {
      return c;
    }
  }
  if (name && name.toLowerCase() !== dbName.toLowerCase() && !name.includes('(')) {
    return name;
  }
  return '';
}

// ─── Component ────────────────────────────────────────────────────────────────

export const TestDashboard: React.FC<TestDashboardProps> = ({ resetKey }) => {
  const [testDatabases, setTestDatabases] = useState<TestDatabaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Reset on navigation
  useEffect(() => {
    setSearchQuery('');
  }, [resetKey]);

  // Add modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newDbName, setNewDbName] = useState('');
  const [newClusterName, setNewClusterName] = useState('');
  const [newUri, setNewUri] = useState('');
  const [testingNew, setTestingNew] = useState(false);
  const [savingNew, setSavingNew] = useState(false);
  const [testResult, setTestResult] = useState<{ success?: boolean; latency?: number; error?: string } | null>(null);

  // Edit modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingDb, setEditingDb] = useState<TestDatabaseItem | null>(null);
  const [editDbName, setEditDbName] = useState('');
  const [editClusterName, setEditClusterName] = useState('');
  const [editUri, setEditUri] = useState('');
  const [testingEdit, setTestingEdit] = useState(false);
  const [editTestResult, setEditTestResult] = useState<{ success?: boolean; latency?: number; error?: string } | null>(null);

  // Delete confirmation state
  const [dbToDelete, setDbToDelete] = useState<TestDatabaseItem | null>(null);
  const [deletingDb, setDeletingDb] = useState(false);

  useEffect(() => {
    loadTestDatabases(false);
  }, []);

  async function loadTestDatabases(forceRefresh = false) {
    setLoading(true);
    setRefreshing(forceRefresh);

    // Clear list so cards stream in fresh on explicit refresh
    if (forceRefresh) setTestDatabases([]);

    try {
      // Track seen profile IDs to deduplicate
      const seenProfileIds = new Set<string>();
      let firstCardRendered = false;

      // Primary: stream live connection overview filtered to 'target' type
      try {
        for await (const item of streamConnectionsOverview(forceRefresh)) {
          if (item.profile.type !== 'target') continue;

          const clusterUri = item.profile.config.uri || '';
          const profileRawName = item.profile.name || '';
          const userDbName = extractDbFromProfile(profileRawName);
          const cleanCluster = extractClusterFromProfile(profileRawName, userDbName);
          const fallbackDbName = userDbName || profileRawName || 'database';
          const profileKey = item.profile.id || `${fallbackDbName}-${clusterUri}`;

          // Skip duplicates (shouldn't happen but be safe)
          if (seenProfileIds.has(profileKey)) continue;
          seenProfileIds.add(profileKey);

          let dbItem: TestDatabaseItem;
          if (item.catalog?.databases && item.catalog.databases.length > 0) {
            const realDbs = item.catalog.databases.filter(
              (d) => (d.collections && d.collections.length > 0) || d.size_bytes > 0 || (d.total_collections || 0) > 0
            );
            const dbsToShow = realDbs.length > 0 ? realDbs : item.catalog.databases;
            const matchingDb =
              dbsToShow.find((d) => d.name.toLowerCase() === userDbName.toLowerCase()) || dbsToShow[0];
            const d = matchingDb;
            const displayName = userDbName || d.name;
            dbItem = {
              id: `${item.profile.id}-${displayName}`,
              profileId: item.profile.id,
              name: displayName,
              actualDbName: d.name,
              clusterName: cleanCluster || displayName,
              clusterUri,
              sizeBytes: d.size_bytes,
              totalCollections: d.total_collections || d.collections?.length || 0,
              totalDocuments: d.total_documents || 0,
              collections: (d.collections || []).map((c) => ({
                name: c.name,
                docCount: c.doc_count || (c as any).docCount || 0,
                sizeBytes: c.storage_size_bytes || 0,
                indexesCount: c.indexes?.length || 0,
              })),
            };
          } else {
            dbItem = {
              id: `${item.profile.id}-${fallbackDbName}`,
              profileId: item.profile.id,
              name: fallbackDbName,
              actualDbName: fallbackDbName,
              clusterName: cleanCluster || fallbackDbName,
              clusterUri,
              sizeBytes: 0,
              totalCollections: 0,
              totalDocuments: 0,
              collections: [],
            };
          }

          // Progressively add each card as it arrives
          setTestDatabases((prev) => {
            const exists = prev.some((p) => (p.profileId || p.id) === (dbItem.profileId || dbItem.id));
            return exists ? prev : [...prev, dbItem];
          });

          // Clear initial loading spinner once first card is ready
          if (!firstCardRendered) {
            firstCardRendered = true;
            setLoading(false);
          }
        }
      } catch (streamErr) {
        console.warn('Stream unavailable, falling back to profile list:', streamErr);
      }

      // Fallback: raw profile list when stream yields nothing
      setTestDatabases((current) => {
        if (current.length > 0) return current; // stream already gave us data
        // (async fallback below will update state)
        return current;
      });

      // Async safety-net fallback (runs after await so state check is stale — use functional update)
      const afterStream = (snapshot: TestDatabaseItem[]) => snapshot;
      setTestDatabases((snapshot) => {
        if (snapshot.length === 0 && seenProfileIds.size === 0) {
          // kick off fallback asynchronously; we can't await inside setState
          (async () => {
            try {
              const rawProfiles = await listProfiles();
              const targets = rawProfiles.filter((p) => p.type === 'target');
              const fallbackItems: TestDatabaseItem[] = targets.map((p) => {
                const uri = p.config?.uri || '';
                const match = p.name.match(/\(([^)]+)\)$/);
                const dbName = match ? match[1].trim() : p.name.trim();
                return {
                  id: `${p.id}-${dbName}`,
                  profileId: p.id,
                  name: dbName,
                  actualDbName: dbName,
                  clusterName: p.name,
                  clusterUri: uri,
                  sizeBytes: 0,
                  totalCollections: 0,
                  totalDocuments: 0,
                  collections: [],
                };
              });
              if (fallbackItems.length > 0) setTestDatabases(fallbackItems);
            } catch (e) {
              console.error('Failed to load fallback profiles:', e);
            }
          })();
        }
        return afterStream(snapshot);
      });
    } catch (e) {
      console.error('Failed to load test databases:', e);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  // ─── Add DB ─────────────────────────────────────────────────────────────────

  async function handleTestNewConn() {
    setTestingNew(true);
    setTestResult(null);
    try {
      const res = await testConnection({ uri: newUri.trim() });
      setTestResult({ success: res.success, latency: res.server_info?.latency_ms, error: res.error });
    } catch (e: any) {
      setTestResult({ success: false, error: e.message || 'Connection test failed' });
    } finally {
      setTestingNew(false);
    }
  }

  async function handleSaveNewTestDb() {
    if (!newDbName.trim() || !newUri.trim()) {
      alert('Please fill in Database Name and Connection URI');
      return;
    }
    setSavingNew(true);

    try {
      const db = newDbName.trim();
      let cluster = newClusterName.trim();
      if (cluster.toLowerCase() === db.toLowerCase() || cluster === `${db} (${db})`) {
        cluster = '';
      }

      const uriToSave = newUri.trim();
      const profileName = cluster ? `${cluster} (${db})` : db;
      const saved = await saveProfile(profileName, 'target', { uri: uriToSave });
      if (!saved || (saved as any).error) {
        throw new Error((saved as any)?.error || 'Server failed to save test database profile');
      }

      const newCard: TestDatabaseItem = {
        id: `${saved.id || Date.now()}-${db}`,
        profileId: saved.id,
        name: db,
        actualDbName: db,
        clusterName: cluster || db,
        clusterUri: uriToSave,
        sizeBytes: 0,
        totalCollections: 0,
        totalDocuments: 0,
        collections: [],
      };
      setTestDatabases((prev) => [newCard, ...prev.filter((d) => d.name.toLowerCase() !== db.toLowerCase())]);

      setIsAddModalOpen(false);
      setNewDbName('');
      setNewClusterName('');
      setNewUri('');
      setTestResult(null);

      loadTestDatabases(false);
    } catch (e: any) {
      alert(`Failed to save test database: ${e.message}`);
    } finally {
      setSavingNew(false);
    }
  }

  // ─── Edit DB ─────────────────────────────────────────────────────────────────

  function handleOpenEditDb(item: TestDatabaseItem) {
    setEditingDb(item);
    setEditDbName(item.name);
    let displayCluster = item.clusterName || '';
    if (
      displayCluster.toLowerCase() === item.name.toLowerCase() ||
      displayCluster === `${item.name} (${item.name})`
    ) {
      displayCluster = '';
    } else {
      const match = displayCluster.match(/^(.*?)\s*\(([^)]+)\)$/);
      if (match) {
        const prefix = match[1].trim();
        const inner = match[2].trim();
        if (
          prefix.toLowerCase() === item.name.toLowerCase() ||
          inner.toLowerCase() === item.name.toLowerCase() ||
          prefix.toLowerCase() === inner.toLowerCase()
        ) {
          displayCluster = prefix.toLowerCase() === item.name.toLowerCase() ? '' : prefix;
        } else {
          displayCluster = prefix;
        }
      }
    }
    setEditClusterName(displayCluster);
    setEditUri(item.clusterUri);
    setEditTestResult(null);
    setIsEditModalOpen(true);
  }

  async function handleTestEditConn() {
    setTestingEdit(true);
    setEditTestResult(null);
    try {
      const res = await testConnection({ uri: editUri.trim() });
      setEditTestResult({ success: res.success, latency: res.server_info?.latency_ms, error: res.error });
    } catch (e: any) {
      setEditTestResult({ success: false, error: e.message || 'Connection test failed' });
    } finally {
      setTestingEdit(false);
    }
  }

  async function handleSaveEditDb() {
    if (!editingDb || !editDbName.trim() || !editUri.trim()) {
      alert('Please fill in Database Name and Connection URI');
      return;
    }

    try {
      const db = editDbName.trim();
      let cluster = editClusterName.trim();
      if (cluster.toLowerCase() === db.toLowerCase() || cluster === `${db} (${db})`) {
        cluster = '';
      }

      const name = cluster ? `${cluster} (${db})` : db;
      const profileId = (editingDb as any).profileId || editingDb.id.split('-')[0];
      if (profileId) {
        try {
          await updateProfile(profileId, name, { uri: editUri.trim() }, 'target');
        } catch (e) {
          await saveProfile(name, 'target', { uri: editUri.trim() });
        }
      }

      setIsEditModalOpen(false);
      setEditingDb(null);
      setEditTestResult(null);

      // Optimistic UI update
      setTestDatabases((prev) =>
        prev.map((item) =>
          item.id === editingDb.id || item.profileId === profileId
            ? { ...item, name: db, clusterName: cluster || db, clusterUri: editUri.trim() }
            : item
        )
      );

      await loadTestDatabases(false);
    } catch (e: any) {
      alert(`Failed to save changes: ${e.message}`);
    }
  }

  // ─── Delete DB ────────────────────────────────────────────────────────────────

  async function confirmDeleteDb() {
    if (!dbToDelete || deletingDb) return;
    const item = dbToDelete;
    const itemDbName = item.name;

    setDeletingDb(true);

    // Optimistic UI — dismiss immediately
    setTestDatabases((prev) => prev.filter((d) => d.id !== item.id && d.name !== item.name));
    setDbToDelete(null);

    let profileId = (item as any).profileId;
    if (!profileId && item.id) {
      const parts = item.id.split('-');
      if (parts.length >= 5) {
        profileId = parts.slice(0, 5).join('-');
      } else {
        const lastHyphen = item.id.lastIndexOf(`-${item.name}`);
        profileId = lastHyphen !== -1 ? item.id.substring(0, lastHyphen) : item.id;
      }
    }

    try {
      if (profileId) await deleteProfile(profileId);
      if (itemDbName && itemDbName !== profileId) await deleteProfile(itemDbName);
    } catch (err) {
      console.error('Failed to delete test profile from backend:', err);
    } finally {
      setDeletingDb(false);
    }
  }

  // ─── Filtering ────────────────────────────────────────────────────────────────

  const filtered = testDatabases.filter(
    (item) =>
      !searchQuery ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.clusterName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.collections.some((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const totalTestDbs = testDatabases.length;
  const totalVolume = testDatabases.reduce((acc, d) => acc + d.sizeBytes, 0);
  const totalCollections = testDatabases.reduce((acc, d) => acc + d.totalCollections, 0);

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (loading && testDatabases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
        <p className="text-sm font-mono">Loading test databases...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-full mx-auto animate-in fade-in duration-200">
      {/* Top Banner */}
      <div className="glass-panel p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 bg-gradient-to-r from-slate-950 via-violet-950/20 to-slate-950 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="px-2 py-0.2 text-[9px] font-bold tracking-wider uppercase rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/30">
              TEST DATABASES
            </span>
            <span className="text-[9px] text-slate-500 font-mono">·</span>
            <span className="px-2 py-0.2 text-[9px] font-bold tracking-wider uppercase rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              Clone Targets
            </span>
          </div>
          <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
            Test MongoDB Databases
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Register and manage your test / staging MongoDB databases used as clone targets.
          </p>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-2.5 shrink-0 font-mono">
          <div className="p-2 px-3 rounded-xl bg-slate-900/90 border border-slate-800 text-center min-w-[75px]">
            <span className="text-[9px] text-slate-500 block uppercase font-sans font-semibold">Test DBs</span>
            <span className="text-base font-black text-white">{totalTestDbs}</span>
          </div>
          <div className="p-2 px-3 rounded-xl bg-slate-900/90 border border-slate-800 text-center min-w-[80px]">
            <span className="text-[9px] text-slate-500 block uppercase font-sans font-semibold">Volume</span>
            <span className="text-base font-black text-violet-400">{formatBytes(totalVolume)}</span>
          </div>
          <div className="p-2 px-3 rounded-xl bg-slate-900/90 border border-slate-800 text-center min-w-[80px]">
            <span className="text-[9px] text-slate-500 block uppercase font-sans font-semibold">Colls</span>
            <span className="text-base font-black text-fuchsia-400">{totalCollections.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Search & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search Test DB name or collection..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full glass-input pl-9 pr-3 py-1.5 rounded-lg text-xs placeholder:text-slate-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadTestDatabases(true)}
            disabled={refreshing}
            className="p-1.5 px-3 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors flex items-center gap-1.5 text-xs font-semibold"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Syncing...' : 'Refresh'}</span>
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-500 text-white hover:bg-violet-400 shadow-sm shadow-violet-500/30 transition-all"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>+ Add Test DB</span>
          </button>
        </div>
      </div>

      {/* Database Grid */}
      {filtered.length === 0 && !loading ? (
        <div className="p-10 text-center glass-panel rounded-xl border border-dashed border-violet-800/40 text-xs text-slate-500">
          {searchQuery
            ? `No matching test databases found for "${searchQuery}".`
            : 'No test databases registered yet. Click "+ Add Test DB" to register one.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="glass-panel p-3.5 rounded-2xl border border-violet-900/40 hover:border-violet-500/50 bg-slate-900/60 hover:bg-slate-900/90 hover:shadow-lg hover:shadow-violet-500/10 transition-all group flex flex-col justify-between gap-3 relative"
            >
              {/* Top: DB Name & Actions */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform bg-violet-500/10 text-violet-400 border border-violet-500/20">
                      <FlaskConical className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-white font-mono tracking-tight group-hover:text-violet-300 transition-colors">
                        {item.name}
                      </h3>
                      <p className="text-[10px] text-slate-400 truncate max-w-[140px]">
                        {item.clusterName}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Test DB badge */}
                    <span className="flex items-center gap-1 text-[9px] font-semibold text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full border border-violet-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                      Test DB
                    </span>

                    {/* Edit */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEditDb(item);
                      }}
                      className="p-1 rounded-lg text-slate-500 hover:text-violet-400 hover:bg-violet-500/10 transition-colors opacity-60 group-hover:opacity-100"
                      title="Edit Test Database Settings"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDbToDelete(item);
                      }}
                      className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-60 group-hover:opacity-100"
                      title="Remove from Catalog"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Key Metrics Strip */}
                <div className="grid grid-cols-3 gap-1.5 pt-1 text-center font-mono">
                  <div className="p-1.5 rounded-xl bg-slate-950/80 border border-slate-800/80 group-hover:border-slate-700/80 transition-colors">
                    <span className="text-[8px] text-slate-500 uppercase tracking-wider block font-sans font-semibold">Storage</span>
                    <span className="text-xs font-bold text-white mt-0.5 block">{formatBytes(item.sizeBytes)}</span>
                  </div>
                  <div className="p-1.5 rounded-xl bg-slate-950/80 border border-slate-800/80 group-hover:border-slate-700/80 transition-colors">
                    <span className="text-[8px] text-slate-500 uppercase tracking-wider block font-sans font-semibold">Colls</span>
                    <span className="text-xs font-bold text-fuchsia-400 mt-0.5 block">{item.totalCollections}</span>
                  </div>
                  <div className="p-1.5 rounded-xl bg-slate-950/80 border border-slate-800/80 group-hover:border-slate-700/80 transition-colors">
                    <span className="text-[8px] text-slate-500 uppercase tracking-wider block font-sans font-semibold">Docs</span>
                    <span className="text-xs font-bold text-violet-400 mt-0.5 block">{item.totalDocuments.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Connection URI preview */}
              <div className="pt-2 border-t border-slate-800/60">
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono truncate">
                  <Server className="w-3 h-3 shrink-0 text-slate-600" />
                  <span className="truncate" title={item.clusterUri}>
                    {item.clusterUri.replace(/\/\/[^@]+@/, '//<credentials>@')}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {/* Quick Register Card */}
          <div
            onClick={() => setIsAddModalOpen(true)}
            className="glass-panel p-4 rounded-2xl border border-dashed border-violet-900/40 hover:border-violet-500/50 bg-slate-950/40 hover:bg-slate-900/60 transition-all cursor-pointer group flex flex-col items-center justify-center text-center gap-2 min-h-[150px]"
          >
            <div className="w-9 h-9 rounded-xl bg-slate-900 group-hover:bg-violet-500/10 text-slate-500 group-hover:text-violet-400 border border-slate-800 group-hover:border-violet-500/30 flex items-center justify-center transition-all">
              <Plus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-300 group-hover:text-white transition-colors">
                + Register Test DB
              </h3>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Add a test or staging MongoDB URI
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─── Add Test DB Modal ─────────────────────────────────────────────────── */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="glass-panel w-full max-w-lg rounded-3xl border border-violet-700/40 p-6 space-y-5 shadow-2xl bg-slate-900/95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20">
                  <FlaskConical className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono">Register Test Database</h3>
                  <p className="text-xs text-slate-400">Add a test / staging MongoDB endpoint</p>
                </div>
              </div>
              <button
                onClick={() => { setIsAddModalOpen(false); setTestResult(null); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
                  Test Database Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. my-test-db or staging-v2"
                  value={newDbName}
                  onChange={(e) => setNewDbName(e.target.value)}
                  className="w-full glass-input px-3.5 py-2.5 rounded-xl font-mono"
                />
                <p className="text-[10px] text-slate-500">This label will appear on the dashboard card exactly as typed.</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
                  Cluster / Host Label <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Linode Staging Cluster"
                  value={newClusterName}
                  onChange={(e) => setNewClusterName(e.target.value)}
                  className="w-full glass-input px-3.5 py-2.5 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
                  MongoDB Connection URI *
                </label>
                <input
                  type="text"
                  placeholder="mongodb://user:password@host:27017/admin"
                  value={newUri}
                  onChange={(e) => setNewUri(e.target.value)}
                  className="w-full glass-input px-3.5 py-2.5 rounded-xl font-mono text-xs"
                />
              </div>

              {/* Test Connection */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleTestNewConn}
                  disabled={testingNew || !newUri.trim()}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center gap-2 font-semibold transition-colors disabled:opacity-50"
                >
                  {testingNew ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                      <span>Testing Endpoint Connectivity...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 text-violet-400" />
                      <span>Test MongoDB Connection</span>
                    </>
                  )}
                </button>
              </div>

              {/* Test Result */}
              {testResult && (
                <div className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs ${
                  testResult.success
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}>
                  {testResult.success ? (
                    <Check className="w-4 h-4 mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  )}
                  <span>
                    {testResult.success
                      ? `Connected successfully${testResult.latency !== undefined ? ` — ${testResult.latency.toFixed(1)}ms latency` : ''}`
                      : testResult.error || 'Connection failed'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                onClick={() => { setIsAddModalOpen(false); setTestResult(null); setNewDbName(''); setNewClusterName(''); setNewUri(''); }}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNewTestDb}
                disabled={savingNew || !newDbName.trim() || !newUri.trim()}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-violet-500 hover:bg-violet-400 text-white disabled:opacity-50 transition-all shadow-md shadow-violet-500/20 flex items-center gap-2"
              >
                {savingNew ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save Test Database</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Edit Test DB Modal ────────────────────────────────────────────────── */}
      {isEditModalOpen && editingDb && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="glass-panel w-full max-w-lg rounded-3xl border border-violet-700/40 p-6 space-y-5 shadow-2xl bg-slate-900/95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20">
                  <Edit2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono">Edit Test Database</h3>
                  <p className="text-xs text-slate-400">Update connection credentials and properties</p>
                </div>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
                  Test Database Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. my-test-db"
                  value={editDbName}
                  onChange={(e) => setEditDbName(e.target.value)}
                  className="w-full glass-input px-3.5 py-2.5 rounded-xl font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
                  Cluster / Host Label <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Linode Staging Cluster"
                  value={editClusterName}
                  onChange={(e) => setEditClusterName(e.target.value)}
                  className="w-full glass-input px-3.5 py-2.5 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
                  MongoDB Connection URI *
                </label>
                <input
                  type="text"
                  placeholder="mongodb://user:password@host:27017/admin"
                  value={editUri}
                  onChange={(e) => setEditUri(e.target.value)}
                  className="w-full glass-input px-3.5 py-2.5 rounded-xl font-mono text-xs"
                />
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleTestEditConn}
                  disabled={testingEdit || !editUri.trim()}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center gap-2 font-semibold transition-colors disabled:opacity-50"
                >
                  {testingEdit ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                      <span>Testing Endpoint Connectivity...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 text-violet-400" />
                      <span>Test Connection</span>
                    </>
                  )}
                </button>
              </div>

              {editTestResult && (
                <div className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs ${
                  editTestResult.success
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}>
                  {editTestResult.success ? (
                    <Check className="w-4 h-4 mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  )}
                  <span>
                    {editTestResult.success
                      ? `Connected successfully${editTestResult.latency !== undefined ? ` — ${editTestResult.latency.toFixed(1)}ms latency` : ''}`
                      : editTestResult.error || 'Connection failed'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEditDb}
                disabled={!editDbName.trim() || !editUri.trim()}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-violet-500 hover:bg-violet-400 text-white disabled:opacity-50 transition-all shadow-md shadow-violet-500/20"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Delete Confirmation Modal ─────────────────────────────────────────── */}
      {dbToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md rounded-3xl border border-rose-500/30 p-6 space-y-5 shadow-2xl bg-slate-900/95 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-2xl bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Remove Test Database?</h3>
                <p className="text-xs text-slate-400 mt-0.5">Unregister database connection from catalog</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800">
              Are you sure you want to remove{' '}
              <span className="text-white font-mono font-bold bg-slate-800 px-1.5 py-0.5 rounded">
                {dbToDelete.name}
              </span>{' '}
              from your Test Databases? This will unregister it from the dashboard. No actual data is deleted.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDbToDelete(null)}
                disabled={deletingDb}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-750 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteDb}
                disabled={deletingDb}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-500 hover:bg-rose-400 text-slate-950 transition-all shadow-lg shadow-rose-500/25 flex items-center gap-1.5 disabled:opacity-50"
              >
                {deletingDb ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-950" />
                    <span>Removing...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5 fill-slate-950" />
                    <span>Remove Test DB</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
