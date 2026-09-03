import React, { useState } from 'react';
import { EndpointConfig, ServerInfo } from '../../types';
import { testConnection } from '../../api/client';
import {
  Server,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Shield,
  Zap,
  Sliders,
  Database,
  ExternalLink,
} from 'lucide-react';

interface Step1ConnectionsProps {
  sourceConfig: EndpointConfig;
  setSourceConfig: React.Dispatch<React.SetStateAction<EndpointConfig>>;
  targetConfig: EndpointConfig;
  setTargetConfig: React.Dispatch<React.SetStateAction<EndpointConfig>>;
  onNext: () => void;
}

export const Step1Connections: React.FC<Step1ConnectionsProps> = ({
  sourceConfig,
  setSourceConfig,
  targetConfig,
  setTargetConfig,
  onNext,
}) => {
  const [sourceStatus, setSourceStatus] = useState<{
    tested: boolean;
    loading: boolean;
    success?: boolean;
    server_info?: ServerInfo;
    error?: string;
  }>({ tested: false, loading: false });

  const [targetStatus, setTargetStatus] = useState<{
    tested: boolean;
    loading: boolean;
    success?: boolean;
    server_info?: ServerInfo;
    error?: string;
  }>({ tested: false, loading: false });

  const [showAdvancedSource, setShowAdvancedSource] = useState(false);
  const [showAdvancedTarget, setShowAdvancedTarget] = useState(false);

  async function handleTestSource() {
    setSourceStatus({ tested: false, loading: true });
    try {
      const res = await testConnection(sourceConfig);
      setSourceStatus({
        tested: true,
        loading: false,
        success: res.success,
        server_info: res.server_info,
        error: res.error,
      });
    } catch (e: any) {
      setSourceStatus({
        tested: true,
        loading: false,
        success: false,
        error: e.message || 'Connection failed',
      });
    }
  }

  async function handleTestTarget() {
    setTargetStatus({ tested: false, loading: true });
    try {
      const res = await testConnection(targetConfig);
      setTargetStatus({
        tested: true,
        loading: false,
        success: res.success,
        server_info: res.server_info,
        error: res.error,
      });
    } catch (e: any) {
      setTargetStatus({
        tested: true,
        loading: false,
        success: false,
        error: e.message || 'Connection failed',
      });
    }
  }

  // Preload fast sample URIs for convenience
  function loadDemoURIs() {
    setSourceConfig({
      uri: 'mongodb://127.0.0.1:27017/?directConnection=true',
      timeout_ms: 10000,
    });
    setTargetConfig({
      uri: 'mongodb://127.0.0.1:27018/?directConnection=true',
      timeout_ms: 10000,
    });
  }

  const canProceed = sourceStatus.success && targetStatus.success;

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Step Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <Server className="w-6 h-6 text-brand-400" />
            Configure MongoDB Endpoints
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Specify the Source (Production cluster) and Target (Test / Staging cluster) connection URIs
          </p>
        </div>
        <button
          onClick={loadDemoURIs}
          className="self-start sm:self-auto px-3.5 py-1.5 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700/60 transition-colors flex items-center gap-1.5"
        >
          <Zap className="w-3.5 h-3.5 text-cyber-amber" />
          <span>Fill Local Sample URIs</span>
        </button>
      </div>

      {/* Connection Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SOURCE ENDPOINT */}
        <div className="glass-panel p-6 rounded-2xl space-y-5 border-l-4 border-l-cyber-cyan/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-cyan-500/10 text-cyber-cyan border border-cyan-500/20">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">
                  Source MongoDB (Prod)
                </h3>
                <p className="text-xs text-slate-400">Database being cloned from</p>
              </div>
            </div>
            {sourceStatus.tested && (
              sourceStatus.success ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-400 bg-brand-500/10 px-2.5 py-1 rounded-full border border-brand-500/30">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Connected ({sourceStatus.server_info?.latency_ms}ms)
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded-full border border-rose-500/30">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Failed
                </span>
              )
            )}
          </div>

          {/* URI Input */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300">
              MongoDB Connection URI
            </label>
            <input
              type="text"
              placeholder="mongodb://user:password@host:27017/admin?replicaSet=rs0"
              value={sourceConfig.uri || ''}
              onChange={(e) => {
                setSourceConfig({ ...sourceConfig, uri: e.target.value });
                setSourceStatus({ tested: false, loading: false });
              }}
              className="w-full glass-input px-4 py-2.5 rounded-xl font-mono text-xs placeholder:text-slate-600"
            />
          </div>

          {/* Advanced options toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvancedSource(!showAdvancedSource)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{showAdvancedSource ? 'Hide Advanced Options' : 'Show Advanced (TLS, Direct Connection)'}</span>
            </button>

            {showAdvancedSource && (
              <div className="mt-3 p-4 rounded-xl bg-slate-900/80 border border-slate-800 grid grid-cols-2 gap-3 text-xs">
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sourceConfig.tls_enabled || false}
                    onChange={(e) =>
                      setSourceConfig({ ...sourceConfig, tls_enabled: e.target.checked })
                    }
                    className="rounded border-slate-700 text-brand-500 focus:ring-0"
                  />
                  <span>Enable TLS / SSL</span>
                </label>
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sourceConfig.direct_connection || false}
                    onChange={(e) =>
                      setSourceConfig({ ...sourceConfig, direct_connection: e.target.checked })
                    }
                    className="rounded border-slate-700 text-brand-500 focus:ring-0"
                  />
                  <span>Direct Connection</span>
                </label>
              </div>
            )}
          </div>

          {/* Test connection & Server info box */}
          <div className="pt-2 flex flex-col gap-3">
            <button
              onClick={handleTestSource}
              disabled={sourceStatus.loading || !sourceConfig.uri}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              {sourceStatus.loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-cyber-cyan" />
                  <span>Testing Connection...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 text-cyber-cyan" />
                  <span>Test Source Connection</span>
                </>
              )}
            </button>

            {sourceStatus.server_info && (
              <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs grid grid-cols-2 gap-2 text-slate-300 font-mono">
                <div>
                  <span className="text-slate-500 block text-[10px]">VERSION</span>
                  <span className="font-semibold text-white">{sourceStatus.server_info.version}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">TOPOLOGY</span>
                  <span className="font-semibold text-brand-400">
                    {sourceStatus.server_info.topology_type} {sourceStatus.server_info.replica_set_name ? `(${sourceStatus.server_info.replica_set_name})` : ''}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">ENGINE</span>
                  <span>{sourceStatus.server_info.storage_engine || 'WiredTiger'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">LATENCY</span>
                  <span>{sourceStatus.server_info.latency_ms} ms</span>
                </div>
              </div>
            )}

            {sourceStatus.error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                {sourceStatus.error}
              </div>
            )}
          </div>
        </div>

        {/* TARGET ENDPOINT */}
        <div className="glass-panel p-6 rounded-2xl space-y-5 border-l-4 border-l-cyber-violet/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-violet-500/10 text-cyber-violet border border-violet-500/20">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">
                  Target MongoDB (Test / Dev)
                </h3>
                <p className="text-xs text-slate-400">Destination database for restored clone</p>
              </div>
            </div>
            {targetStatus.tested && (
              targetStatus.success ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-400 bg-brand-500/10 px-2.5 py-1 rounded-full border border-brand-500/30">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Connected ({targetStatus.server_info?.latency_ms}ms)
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded-full border border-rose-500/30">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Failed
                </span>
              )
            )}
          </div>

          {/* URI Input */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300">
              MongoDB Connection URI
            </label>
            <input
              type="text"
              placeholder="mongodb://user:password@staging-host:27017/admin"
              value={targetConfig.uri || ''}
              onChange={(e) => {
                setTargetConfig({ ...targetConfig, uri: e.target.value });
                setTargetStatus({ tested: false, loading: false });
              }}
              className="w-full glass-input px-4 py-2.5 rounded-xl font-mono text-xs placeholder:text-slate-600"
            />
          </div>

          {/* Advanced options toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvancedTarget(!showAdvancedTarget)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{showAdvancedTarget ? 'Hide Advanced Options' : 'Show Advanced (TLS, Direct Connection)'}</span>
            </button>

            {showAdvancedTarget && (
              <div className="mt-3 p-4 rounded-xl bg-slate-900/80 border border-slate-800 grid grid-cols-2 gap-3 text-xs">
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={targetConfig.tls_enabled || false}
                    onChange={(e) =>
                      setTargetConfig({ ...targetConfig, tls_enabled: e.target.checked })
                    }
                    className="rounded border-slate-700 text-brand-500 focus:ring-0"
                  />
                  <span>Enable TLS / SSL</span>
                </label>
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={targetConfig.direct_connection || false}
                    onChange={(e) =>
                      setTargetConfig({ ...targetConfig, direct_connection: e.target.checked })
                    }
                    className="rounded border-slate-700 text-brand-500 focus:ring-0"
                  />
                  <span>Direct Connection</span>
                </label>
              </div>
            )}
          </div>

          {/* Test connection & Server info box */}
          <div className="pt-2 flex flex-col gap-3">
            <button
              onClick={handleTestTarget}
              disabled={targetStatus.loading || !targetConfig.uri}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              {targetStatus.loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-cyber-violet" />
                  <span>Testing Connection...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 text-cyber-violet" />
                  <span>Test Target Connection</span>
                </>
              )}
            </button>

            {targetStatus.server_info && (
              <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs grid grid-cols-2 gap-2 text-slate-300 font-mono">
                <div>
                  <span className="text-slate-500 block text-[10px]">VERSION</span>
                  <span className="font-semibold text-white">{targetStatus.server_info.version}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">TOPOLOGY</span>
                  <span className="font-semibold text-cyber-violet">
                    {targetStatus.server_info.topology_type} {targetStatus.server_info.replica_set_name ? `(${targetStatus.server_info.replica_set_name})` : ''}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">ENGINE</span>
                  <span>{targetStatus.server_info.storage_engine || 'WiredTiger'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">LATENCY</span>
                  <span>{targetStatus.server_info.latency_ms} ms</span>
                </div>
              </div>
            )}

            {targetStatus.error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                {targetStatus.error}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex justify-end pt-4 border-t border-slate-800/80">
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-brand-500 text-slate-950 hover:bg-brand-400 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-brand-500/20 transition-all"
        >
          <span>Continue to Catalog & Schema Selection</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
