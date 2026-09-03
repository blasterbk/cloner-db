import React, { useState, useEffect } from 'react';
import { fetchConnectionsOverview, saveProfile, updateProfile, deleteProfile, testConnection, fetchCatalog } from '../../api/client';
import { ProdDatabaseItem, SideBySideCloneView } from '../Clone/SideBySideCloneView';
import { CloneJob } from '../../types';
import {
  Database,
  Layers,
  Zap,
  Clock,
  Search,
  CheckCircle2,
  RefreshCw,
  ArrowRight,
  Server,
  FileText,
  Sliders,
  Sparkles,
  Loader2,
  Plus,
  X,
  Check,
  AlertTriangle,
  Trash2,
  Edit2,
} from 'lucide-react';

interface ProductionDashboardProps {
  activeJob: CloneJob | null;
  setActiveJob: React.Dispatch<React.SetStateAction<CloneJob | null>>;
}

export const ProductionDashboard: React.FC<ProductionDashboardProps> = ({
  activeJob,
  setActiveJob,
}) => {
  // Live database catalog state from backend database
  const [prodDatabases, setProdDatabases] = useState<ProdDatabaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDbForClone, setSelectedDbForClone] = useState<ProdDatabaseItem | null>(null);

  // Add Production DB Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newDbName, setNewDbName] = useState('');
  const [newClusterName, setNewClusterName] = useState('');
  const [newUri, setNewUri] = useState('');
  const [testingNew, setTestingNew] = useState(false);
  const [savingNew, setSavingNew] = useState(false);
  const [testResult, setTestResult] = useState<{ success?: boolean; latency?: number; error?: string } | null>(null);

  // Edit Production DB Modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingDb, setEditingDb] = useState<ProdDatabaseItem | null>(null);
  const [editDbName, setEditDbName] = useState('');
  const [editClusterName, setEditClusterName] = useState('');
  const [editUri, setEditUri] = useState('');
  const [testingEdit, setTestingEdit] = useState(false);
  const [editTestResult, setEditTestResult] = useState<{ success?: boolean; latency?: number; error?: string } | null>(null);

  // Delete confirmation modal state
  const [dbToDelete, setDbToDelete] = useState<ProdDatabaseItem | null>(null);

  useEffect(() => {
    // Non-blocking background sync
    loadProdDatabases(false);
  }, []);

  async function loadProdDatabases(showSpinner = true) {
    if (showSpinner) setRefreshing(true);
    setLoading(true);
    try {
      const data = await fetchConnectionsOverview();
      const dbList: ProdDatabaseItem[] = [];

      if (data && data.length > 0) {
        data
          .filter((item) => item.profile.type === 'source')
          .forEach((item) => {
            const clusterUri = item.profile.config.uri || '';
            const clusterName = item.profile.name;

            if (item.catalog?.databases && item.catalog.databases.length > 0) {
              item.catalog.databases.forEach((d) => {
                dbList.push({
                  id: `${item.profile.id}-${d.name}`,
                  profileId: item.profile.id,
                  name: d.name,
                  clusterName,
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
                });
              });
            }
          });
      }

      const uniqueDbs = Array.from(
        new Map(dbList.map((item) => [`${item.name}-${item.clusterUri}`, item])).values()
      );
      setProdDatabases(uniqueDbs);
    } catch (e) {
      console.error('Failed to load production databases:', e);
      setProdDatabases([]);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  async function handleTestNewConn() {
    setTestingNew(true);
    setTestResult(null);
    try {
      const res = await testConnection({ uri: newUri.trim() });
      setTestResult({
        success: res.success,
        latency: res.server_info?.latency_ms,
        error: res.error,
      });
    } catch (e: any) {
      setTestResult({ success: false, error: e.message || 'Connection test failed' });
    } finally {
      setTestingNew(false);
    }
  }

  async function handleSaveNewProdDb() {
    if (!newDbName.trim() || !newUri.trim()) {
      alert('Please fill in Database Name and Connection URI');
      return;
    }
    setSavingNew(true);

    try {
      const name = newClusterName.trim() ? `${newClusterName.trim()} (${newDbName.trim()})` : newDbName.trim();
      await saveProfile(name, 'source', { uri: newUri.trim() });
      
      await loadProdDatabases(false);

      setIsAddModalOpen(false);
      setNewDbName('');
      setNewClusterName('');
      setNewUri('');
      setTestResult(null);
    } catch (e: any) {
      alert(`Failed to save database: ${e.message}`);
    } finally {
      setSavingNew(false);
    }
  }

  function handleOpenEditDb(item: ProdDatabaseItem) {
    setEditingDb(item);
    setEditDbName(item.name);
    setEditClusterName(item.clusterName);
    setEditUri(item.clusterUri);
    setEditTestResult(null);
    setIsEditModalOpen(true);
  }

  async function handleTestEditConn() {
    setTestingEdit(true);
    setEditTestResult(null);
    try {
      const res = await testConnection({ uri: editUri.trim() });
      setEditTestResult({
        success: res.success,
        latency: res.server_info?.latency_ms,
        error: res.error,
      });
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
      const name = editClusterName.trim() ? `${editClusterName.trim()} (${editDbName.trim()})` : editDbName.trim();
      const profileId = (editingDb as any).profileId || editingDb.id.split('-')[0];
      if (profileId) {
        try {
          await updateProfile(profileId, name, { uri: editUri.trim() });
        } catch (e) {
          await saveProfile(name, 'source', { uri: editUri.trim() });
        }
      }

      await loadProdDatabases(false);

      setIsEditModalOpen(false);
      setEditingDb(null);
      setEditTestResult(null);
    } catch (e: any) {
      alert(`Failed to save changes: ${e.message}`);
    }
  }

  async function confirmDeleteDb() {
    if (!dbToDelete) return;
    const item = dbToDelete;

    const lastHyphen = item.id.lastIndexOf(`-${item.name}`);
    const profileId = (item as any).profileId || (lastHyphen !== -1 ? item.id.substring(0, lastHyphen) : item.id.split('-')[0]);
    if (profileId) {
      try {
        await deleteProfile(profileId);
      } catch (err) {
        console.error('Failed to delete profile from backend:', err);
      }
    }

    await loadProdDatabases(false);
    setDbToDelete(null);
  }

  function formatBytes(bytes?: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  const filtered = prodDatabases.filter(
    (d) =>
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.clusterName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.collections.some((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const totalProdDbs = prodDatabases.length;
  const totalVolume = prodDatabases.reduce((acc, d) => acc + d.sizeBytes, 0);
  const totalDocs = prodDatabases.reduce((acc, d) => acc + d.totalDocuments, 0);

  // If a DB is selected for cloning, render the full-page Side-by-Side view!
  if (selectedDbForClone) {
    return (
      <SideBySideCloneView
        db={selectedDbForClone}
        onBack={() => setSelectedDbForClone(null)}
        activeJob={activeJob}
        setActiveJob={setActiveJob}
      />
    );
  }

  return (
    <div className="space-y-4 max-w-full mx-auto animate-in fade-in duration-200">
      {/* Top Banner Overview */}
      <div className="glass-panel p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="px-2 py-0.2 text-[9px] font-bold tracking-wider uppercase rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              PROD DATABASES
            </span>
            <span className="text-xs text-slate-600">&bull;</span>
            <span className="text-[11px] font-mono text-slate-400">
              Ready for 1-Click Side-by-Side Clone
            </span>
          </div>
          <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
            Production MongoDB Databases
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Select any Production Database below to configure and execute a Side-by-Side Clone or Point-in-Time Restore.
          </p>
        </div>

        {/* Global Summary Stats */}
        <div className="flex items-center gap-2.5 shrink-0 font-mono">
          <div className="p-2 px-3 rounded-xl bg-slate-900/90 border border-slate-800 text-center min-w-[75px]">
            <span className="text-[9px] text-slate-500 block uppercase font-sans font-semibold">Prod DBs</span>
            <span className="text-base font-black text-white">{totalProdDbs}</span>
          </div>
          <div className="p-2 px-3 rounded-xl bg-slate-900/90 border border-slate-800 text-center min-w-[80px]">
            <span className="text-[9px] text-slate-500 block uppercase font-sans font-semibold">Volume</span>
            <span className="text-base font-black text-brand-400">{formatBytes(totalVolume)}</span>
          </div>
          <div className="p-2 px-3 rounded-xl bg-slate-900/90 border border-slate-800 text-center min-w-[80px]">
            <span className="text-[9px] text-slate-500 block uppercase font-sans font-semibold">Docs</span>
            <span className="text-base font-black text-cyber-cyan">{totalDocs.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Search and Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search Production DB name (e.g. nexus-meta-test)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full glass-input pl-9 pr-3 py-1.5 rounded-lg text-xs placeholder:text-slate-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadProdDatabases(true)}
            disabled={refreshing}
            className="p-1.5 px-3 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors flex items-center gap-1.5 text-xs font-semibold"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Syncing...' : 'Refresh'}</span>
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-500 text-slate-950 hover:bg-brand-400 shadow-sm shadow-brand-500/20 transition-all"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>+ Add Production DB</span>
          </button>
        </div>
      </div>

      {/* Production Databases Grid */}
      {filtered.length === 0 ? (
        <div className="p-10 text-center glass-panel rounded-xl border border-dashed border-slate-800 text-xs text-slate-500">
          No matching production databases found for "{searchQuery}".
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
          {filtered.map((item) => (
            <div
              key={item.id}
              onClick={() => setSelectedDbForClone(item)}
              className="glass-panel p-3.5 rounded-2xl border border-slate-800/90 hover:border-brand-500/50 bg-slate-900/60 hover:bg-slate-900/90 transition-all cursor-pointer group hover:shadow-lg hover:shadow-brand-500/10 flex flex-col justify-between gap-3 relative"
            >
              {/* Top: DB Name & Actions */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center group-hover:scale-105 transition-transform">
                      <Database className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-white font-mono tracking-tight group-hover:text-brand-300 transition-colors">
                        {item.name}
                      </h3>
                      <p className="text-[10px] text-slate-400 truncate max-w-[140px]">
                        {item.clusterName}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <span className="flex items-center gap-1 text-[9px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Ready
                    </span>

                    {/* Edit Option */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEditDb(item);
                      }}
                      className="p-1 rounded-lg text-slate-500 hover:text-cyber-cyan hover:bg-cyan-500/10 transition-colors opacity-60 group-hover:opacity-100"
                      title="Edit Database Settings"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    {/* Delete Option */}
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
                    <span className="text-xs font-bold text-cyber-cyan mt-0.5 block">{item.totalCollections}</span>
                  </div>
                  <div className="p-1.5 rounded-xl bg-slate-950/80 border border-slate-800/80 group-hover:border-slate-700/80 transition-colors">
                    <span className="text-[8px] text-slate-500 uppercase tracking-wider block font-sans font-semibold">Docs</span>
                    <span className="text-xs font-bold text-brand-400 mt-0.5 block">{item.totalDocuments.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2 border-t border-slate-800/60">
                <button
                  type="button"
                  className="w-full py-1.5 px-3 rounded-lg text-[11px] font-bold bg-brand-500 text-slate-950 group-hover:bg-brand-400 shadow-sm shadow-brand-500/20 transition-all flex items-center justify-center gap-1.5"
                >
                  <Zap className="w-3 h-3 fill-slate-950" />
                  <span>Clone Database &rarr;</span>
                </button>
              </div>
            </div>
          ))}

          {/* Quick Register Card */}
          <div
            onClick={() => setIsAddModalOpen(true)}
            className="glass-panel p-4 rounded-2xl border border-dashed border-slate-800 hover:border-brand-500/50 bg-slate-950/40 hover:bg-slate-900/60 transition-all cursor-pointer group flex flex-col items-center justify-center text-center gap-2 min-h-[150px]"
          >
            <div className="w-9 h-9 rounded-xl bg-slate-900 group-hover:bg-brand-500/10 text-slate-500 group-hover:text-brand-400 border border-slate-800 group-hover:border-brand-500/30 flex items-center justify-center transition-all">
              <Plus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-300 group-hover:text-white transition-colors">
                + Register Production DB
              </h3>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Add an Atlas or standalone MongoDB URI
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Add Production DB Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="glass-panel w-full max-w-lg rounded-3xl border border-slate-700 p-6 space-y-5 shadow-2xl bg-slate-900/95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono">
                    Register Production MongoDB Database
                  </h3>
                  <p className="text-xs text-slate-400">
                    Connect and save a new Production database endpoint
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
                  Production Database Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. payment_service_prod, customers_db"
                  value={newDbName}
                  onChange={(e) => setNewDbName(e.target.value)}
                  className="w-full glass-input px-3.5 py-2.5 rounded-xl font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
                  Cluster / Host Label (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. AWS US-East Production ReplicaSet"
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

              {/* Test Connection Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleTestNewConn}
                  disabled={testingNew || !newUri.trim()}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center gap-2 font-semibold transition-colors"
                >
                  {testingNew ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
                      <span>Testing Endpoint Connectivity...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 text-cyber-amber" />
                      <span>Test MongoDB Connection</span>
                    </>
                  )}
                </button>

                {testResult && (
                  <div
                    className={`mt-2.5 p-3 rounded-xl border text-xs font-mono ${
                      testResult.success
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {testResult.success ? (
                      <span className="flex items-center gap-1.5 font-semibold">
                        <CheckCircle2 className="w-4 h-4" />
                        Connected Successfully ({testResult.latency}ms ping latency)
                      </span>
                    ) : (
                      <span>{testResult.error || 'Connection failed'}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNewProdDb}
                disabled={!newDbName.trim() || !newUri.trim()}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-brand-500 text-slate-950 hover:bg-brand-400 disabled:opacity-50 transition-all shadow-md shadow-brand-500/20"
              >
                Save Production DB
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Production DB Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="glass-panel w-full max-w-lg rounded-3xl border border-slate-700 p-6 space-y-5 shadow-2xl bg-slate-900/95 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-cyber-cyan/10 text-cyber-cyan border border-cyber-cyan/20">
                  <Edit2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono">
                    Edit Production Database
                  </h3>
                  <p className="text-xs text-slate-400">
                    Update connection credentials and database properties
                  </p>
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
                  Production Database Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. nexus-meta-test"
                  value={editDbName}
                  onChange={(e) => setEditDbName(e.target.value)}
                  className="w-full glass-input px-3.5 py-2.5 rounded-xl font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
                  Cluster / Host Label
                </label>
                <input
                  type="text"
                  placeholder="e.g. Primary Atlas Cluster"
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

              {/* Test Connection Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleTestEditConn}
                  disabled={testingEdit || !editUri.trim()}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center justify-center gap-2 font-semibold transition-colors"
                >
                  {testingEdit ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-cyber-cyan" />
                      <span>Testing Endpoint Connectivity...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 text-cyber-cyan" />
                      <span>Test Connection</span>
                    </>
                  )}
                </button>

                {editTestResult && (
                  <div
                    className={`mt-2.5 p-3 rounded-xl border text-xs font-mono ${
                      editTestResult.success
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {editTestResult.success ? (
                      <span className="flex items-center gap-1.5 font-semibold">
                        <CheckCircle2 className="w-4 h-4" />
                        Connected Successfully ({editTestResult.latency}ms ping latency)
                      </span>
                    ) : (
                      <span>{editTestResult.error || 'Connection failed'}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEditDb}
                disabled={!editDbName.trim() || !editUri.trim()}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-cyber-cyan text-slate-950 hover:bg-cyan-400 disabled:opacity-50 transition-all shadow-md shadow-cyan-500/20"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Professional Delete Confirmation Modal */}
      {dbToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md rounded-3xl border border-rose-500/30 p-6 space-y-5 shadow-2xl bg-slate-900/95 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-2xl bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  Remove Production Database?
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Unregister database connection from catalog
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800">
              Are you sure you want to remove <span className="text-white font-mono font-bold bg-slate-800 px-1.5 py-0.5 rounded">{dbToDelete.name}</span> from your Production Databases? This will unregister it from the dashboard.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDbToDelete(null)}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-750 transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={confirmDeleteDb}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-500 hover:bg-rose-400 text-slate-950 transition-all shadow-lg shadow-rose-500/25 flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5 fill-slate-950" />
                <span>Remove Database</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
