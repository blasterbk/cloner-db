import React from 'react';
import { Database, History, ZoomIn, ZoomOut, Monitor } from 'lucide-react';

interface HeaderProps {
  activeTab: 'dashboard' | 'history';
  setActiveTab: (tab: 'dashboard' | 'history') => void;
  activeJobsCount: number;
  uiScale: number;
  setUiScale: (scale: number) => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  activeJobsCount,
  uiScale,
  setUiScale,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full glass-panel border-b border-slate-800/80 px-4 sm:px-6 py-2.5 flex items-center justify-between">
      {/* Brand logo & tagline */}
      <div
        onClick={() => setActiveTab('dashboard')}
        className="flex items-center gap-2.5 cursor-pointer group"
      >
        <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-brand-600 via-brand-500 to-cyber-cyan flex items-center justify-center shadow-md shadow-brand-500/20 ring-1 ring-white/20 group-hover:scale-105 transition-transform">
          <Database className="w-4 h-4 text-slate-950 stroke-[2.5]" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              MongoClone
            </h1>
            <span className="px-1.5 py-0.2 text-[9px] font-semibold tracking-wider uppercase rounded-full bg-brand-500/15 text-brand-400 border border-brand-500/30">
              PROD-TO-TEST & PITR
            </span>
          </div>
          <p className="text-[10px] text-slate-400 hidden sm:block">
            Production MongoDB Catalog & High-Speed Side-by-Side Cloner
          </p>
        </div>
      </div>

      {/* Navigation tabs & View Scale Controls */}
      <div className="flex items-center gap-3">
        {/* UI Scale / Zoom Density Switcher */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/90 border border-slate-800 text-[10px] font-mono">
          <span className="text-slate-500 px-1.5 flex items-center gap-1">
            <Monitor className="w-3 h-3" />
            <span className="hidden md:inline">Scale:</span>
          </span>
          <button
            onClick={() => setUiScale(0.65)}
            className={`px-2 py-0.5 rounded-lg transition-all ${
              uiScale === 0.65
                ? 'bg-brand-500 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
            title="60% Ultra Compact View"
          >
            60%
          </button>
          <button
            onClick={() => setUiScale(0.8)}
            className={`px-2 py-0.5 rounded-lg transition-all ${
              uiScale === 0.8
                ? 'bg-brand-500 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
            title="80% Balanced View"
          >
            80%
          </button>
          <button
            onClick={() => setUiScale(1.0)}
            className={`px-2 py-0.5 rounded-lg transition-all ${
              uiScale === 1.0
                ? 'bg-brand-500 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
            title="100% Standard View"
          >
            100%
          </button>
        </div>

        {/* Tab Navigation */}
        <nav className="flex items-center p-0.5 rounded-xl bg-slate-900/80 border border-slate-800">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'dashboard'
                ? 'bg-brand-500 text-slate-950 shadow-md shadow-brand-500/20 font-bold'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Production Databases</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all relative ${
              activeTab === 'history'
                ? 'bg-brand-500 text-slate-950 shadow-md shadow-brand-500/20 font-bold'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Clone History</span>
            {activeJobsCount > 0 && (
              <span className="flex h-1.5 w-1.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyber-cyan opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyber-cyan"></span>
              </span>
            )}
          </button>
        </nav>
      </div>
    </header>
  );
};
