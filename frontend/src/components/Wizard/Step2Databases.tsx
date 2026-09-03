import React, { useState, useEffect } from 'react';
import { ClusterCatalog, DatabaseMapping, EndpointConfig } from '../../types';
import { fetchCatalog } from '../../api/client';
import {
  Database,
  Layers,
  ArrowRight,
  ArrowLeft,
  Loader2,
  RefreshCw,
  CheckSquare,
  Square,
  Sparkles,
  ArrowRightLeft,
  Key,
} from 'lucide-react';

interface Step2DatabasesProps {
  sourceConfig: EndpointConfig;
  databases: DatabaseMapping[];
  setDatabases: React.Dispatch<React.SetStateAction<DatabaseMapping[]>>;
  onNext: () => void;
  onBack: () => void;
}

export const Step2Databases: React.FC<Step2DatabasesProps> = ({
  sourceConfig,
  databases,
  setDatabases,
  onNext,
  onBack,
}) => {
  const [catalog, setCatalog] = useState<ClusterCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeSystemDBs, setIncludeSystemDBs] = useState(false);

  useEffect(() => {
    loadCatalog();
  }, [includeSystemDBs]);

  async function loadCatalog() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCatalog(sourceConfig, includeSystemDBs);
      setCatalog(data);

      // Auto-select non-empty user databases if none selected yet
      if (databases.length === 0 && data.databases.length > 0) {
        const initialMappings: DatabaseMapping[] = data.databases.map((db) => ({
          source_database: db.name,
          target_database: `${db.name}_test`, // Default convenient prod->test suffix
          all_collections: true,
          collections: db.collections.map((c) => c.name),
        }));
        setDatabases(initialMappings);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to scan source catalog');
    } finally {
      setLoading(false);
    }
  }

  function isDBSelected(dbName: string): boolean {
    return databases.some((d) => d.source_database === dbName);
  }

  function toggleDB(dbName: string) {
    if (isDBSelected(dbName)) {
      setDatabases(databases.filter((d) => d.source_database !== dbName));
    } else {
      const dbInfo = catalog?.databases.find((d) => d.name === dbName);
      const colls = dbInfo ? dbInfo.collections.map((c) => c.name) : [];
      setDatabases([
        ...databases,
        {
          source_database: dbName,
          target_database: `${dbName}_test`,
          all_collections: true,
          collections: colls,
        },
      ]);
    }
  }

  function updateTargetDBName(sourceDB: string, targetDB: string) {
    setDatabases(
      databases.map((d) =>
        d.source_database === sourceDB
          ? { ...d, target_database: targetDB }
          : d
      )
    );
  }

  function toggleCollection(dbName: string, collName: string) {
    setDatabases(
      databases.map((d) => {
        if (d.source_database !== dbName) return d;
        const currentColls = d.collections || [];
        const isColSelected = currentColls.includes(collName);
        const nextColls = isColSelected
          ? currentColls.filter((c) => c !== collName)
          : [...currentColls, collName];
        return {
          ...d,
          all_collections: false,
          collections: nextColls,
        };
      })
    );
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  const hasSelection = databases.length > 0;

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <Layers className="w-6 h-6 text-brand-400" />
            Select Databases & Collections
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Choose which databases to clone and optionally configure target database remapping
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={includeSystemDBs}
              onChange={(e) => setIncludeSystemDBs(e.target.checked)}
              className="rounded border-slate-700 text-brand-500 focus:ring-0"
            />
            <span>Include System DBs</span>
          </label>
          <button
            onClick={loadCatalog}
            disabled={loading}
            className="p-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 transition-colors"
            title="Refresh Catalog"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-16 text-center space-y-3 glass-panel rounded-2xl">
          <Loader2 className="w-8 h-8 animate-spin text-brand-400 mx-auto" />
          <p className="text-sm text-slate-300 font-medium">
            Scanning source cluster catalog and schemas...
          </p>
        </div>
      ) : error ? (
        <div className="p-6 glass-panel rounded-2xl border-rose-500/30 text-center space-y-3">
          <p className="text-rose-400 font-semibold text-sm">{error}</p>
          <button
            onClick={loadCatalog}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white"
          >
            Retry Catalog Scan
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Overview summary bar */}
          {catalog && (
            <div className="p-4 rounded-xl glass-panel bg-slate-900/60 border border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
              <div className="flex items-center gap-6">
                <div>
                  <span className="text-slate-500 block text-[10px]">TOTAL DATABASES</span>
                  <span className="font-bold text-white">{catalog.total_databases}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">TOTAL COLLECTIONS</span>
                  <span className="font-bold text-cyber-cyan">{catalog.total_collections}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">TOTAL DOCUMENTS</span>
                  <span className="font-bold text-brand-400">{catalog.total_documents.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">TOTAL STORAGE</span>
                  <span className="font-bold text-cyber-amber">{formatBytes(catalog.total_data_size_bytes)}</span>
                </div>
              </div>

              <div className="text-right text-slate-400">
                <span className="text-brand-400 font-bold">{databases.length}</span> of {catalog.total_databases} DBs Selected
              </div>
            </div>
          )}

          {/* Database cards */}
          <div className="space-y-4">
            {catalog?.databases.map((db) => {
              const selected = isDBSelected(db.name);
              const mapping = databases.find((d) => d.source_database === db.name);

              return (
                <div
                  key={db.name}
                  className={`glass-panel rounded-2xl border transition-all overflow-hidden ${
                    selected ? 'border-brand-500/40 bg-slate-900/90' : 'border-slate-800/80 bg-slate-950/40 opacity-75'
                  }`}
                >
                  {/* Database Header */}
                  <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/60">
                    <div className="flex items-center gap-3.5">
                      <button
                        onClick={() => toggleDB(db.name)}
                        className="text-slate-400 hover:text-brand-400 transition-colors"
                      >
                        {selected ? (
                          <CheckSquare className="w-5 h-5 text-brand-400" />
                        ) : (
                          <Square className="w-5 h-5 text-slate-600" />
                        )}
                      </button>
                      <div className="p-2 rounded-xl bg-brand-500/10 text-brand-400 border border-brand-500/20">
                        <Database className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-base">
                            {db.name}
                          </span>
                          <span className="text-xs text-slate-400 font-mono">
                            ({db.total_collections} colls &bull; {db.total_documents.toLocaleString()} docs &bull; {formatBytes(db.size_bytes)})
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Target DB Remapping input */}
                    {selected && mapping && (
                      <div className="flex items-center gap-2 self-end sm:self-auto bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800">
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                          Clone to Target:
                        </span>
                        <input
                          type="text"
                          value={mapping.target_database}
                          onChange={(e) => updateTargetDBName(db.name, e.target.value)}
                          className="bg-transparent border-b border-slate-700 text-xs text-brand-300 font-mono focus:border-brand-400 outline-none px-1 py-0.5"
                          placeholder="target_database_name"
                        />
                      </div>
                    )}
                  </div>

                  {/* Collections List */}
                  {selected && (
                    <div className="p-4 sm:p-5 bg-slate-950/40">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                        Included Collections ({mapping?.collections?.length || 0} of {db.collections.length})
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {db.collections.map((coll) => {
                          const isCollSelected =
                            mapping?.all_collections ||
                            (mapping?.collections?.includes(coll.name) ?? false);

                          return (
                            <div
                              key={coll.name}
                              onClick={() => toggleCollection(db.name, coll.name)}
                              className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-center justify-between ${
                                isCollSelected
                                  ? 'bg-slate-900 border-brand-500/30 text-slate-200'
                                  : 'bg-slate-950/60 border-slate-850 text-slate-500 opacity-60'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {isCollSelected ? (
                                  <CheckSquare className="w-4 h-4 text-brand-400 shrink-0" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-600 shrink-0" />
                                )}
                                <span className="font-mono font-medium truncate">
                                  {coll.name}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 text-[11px] font-mono text-slate-400">
                                <span>{coll.doc_count.toLocaleString()} docs</span>
                                {coll.indexes.length > 0 && (
                                  <span className="flex items-center gap-0.5 text-slate-500" title={`${coll.indexes.length} secondary indexes`}>
                                    <Key className="w-3 h-3" />
                                    {coll.indexes.length}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-800/80">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Endpoints</span>
        </button>

        <button
          onClick={onNext}
          disabled={!hasSelection}
          className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-brand-500 text-slate-950 hover:bg-brand-400 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-brand-500/20 transition-all"
        >
          <span>Continue to Time-Travel & PITR</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
