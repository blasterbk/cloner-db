import React, { useState, useEffect } from 'react';
import { CloneMode, EndpointConfig, OplogWindow } from '../../types';
import { fetchOplogWindow } from '../../api/client';
import {
  Clock,
  Zap,
  Calendar,
  History,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';

interface Step3TimeTravelProps {
  sourceConfig: EndpointConfig;
  mode: CloneMode;
  setMode: React.Dispatch<React.SetStateAction<CloneMode>>;
  pitrTargetTime: string;
  setPitrTargetTime: React.Dispatch<React.SetStateAction<string>>;
  pitrTimestamp: { T: number; I: number } | undefined;
  setPitrTimestamp: React.Dispatch<React.SetStateAction<{ T: number; I: number } | undefined>>;
  onNext: () => void;
  onBack: () => void;
}

export const Step3TimeTravel: React.FC<Step3TimeTravelProps> = ({
  sourceConfig,
  mode,
  setMode,
  pitrTargetTime,
  setPitrTargetTime,
  pitrTimestamp,
  setPitrTimestamp,
  onNext,
  onBack,
}) => {
  const [oplogWindow, setOplogWindow] = useState<OplogWindow | null>(null);
  const [loading, setLoading] = useState(false);
  const [sliderValue, setSliderValue] = useState<number>(100);

  useEffect(() => {
    checkOplog();
  }, []);

  async function checkOplog() {
    setLoading(true);
    try {
      const window = await fetchOplogWindow(sourceConfig);
      setOplogWindow(window);

      // Default target time to latest oplog timestamp or now
      if (window.available && window.last_timestamp_sec) {
        const date = new Date(window.last_timestamp_sec * 1000);
        setPitrTargetTime(date.toISOString().slice(0, 16));
        setPitrTimestamp({ T: window.last_timestamp_sec, I: window.last_increment });
      } else {
        const now = new Date();
        setPitrTargetTime(now.toISOString().slice(0, 16));
      }
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  function handleSliderChange(val: number) {
    setSliderValue(val);
    if (!oplogWindow || !oplogWindow.available) return;

    const start = oplogWindow.first_timestamp_sec;
    const end = oplogWindow.last_timestamp_sec;
    const targetSec = Math.round(start + (val / 100) * (end - start));

    const date = new Date(targetSec * 1000);
    setPitrTargetTime(date.toISOString().slice(0, 16));
    setPitrTimestamp({ T: targetSec, I: 1 });
  }

  function handleDateTimeChange(dtStr: string) {
    setPitrTargetTime(dtStr);
    const date = new Date(dtStr);
    if (!isNaN(date.getTime())) {
      const targetSec = Math.floor(date.getTime() / 1000);
      setPitrTimestamp({ T: targetSec, I: 1 });

      if (oplogWindow?.available && oplogWindow.last_timestamp_sec > oplogWindow.first_timestamp_sec) {
        const start = oplogWindow.first_timestamp_sec;
        const end = oplogWindow.last_timestamp_sec;
        const percent = Math.min(100, Math.max(0, ((targetSec - start) / (end - start)) * 100));
        setSliderValue(percent);
      }
    }
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
          <Clock className="w-6 h-6 text-brand-400" />
          Choose Restore Time & Mode
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Clone the latest current live snapshot or roll back to an exact historical point in time via Oplog time-travel
        </p>
      </div>

      {/* Mode Selector Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* OPTION 1: INSTANT LIVE SNAPSHOT */}
        <div
          onClick={() => setMode('SNAPSHOT_LIVE')}
          className={`glass-panel p-6 rounded-2xl border-2 cursor-pointer transition-all ${
            mode === 'SNAPSHOT_LIVE'
              ? 'border-brand-500 bg-brand-500/5 shadow-xl shadow-brand-500/10 ring-1 ring-brand-500/30'
              : 'border-slate-800 hover:border-slate-700 bg-slate-900/40 opacity-70 hover:opacity-100'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="p-3 rounded-xl bg-brand-500/10 text-brand-400 border border-brand-500/20 mb-4">
              <Zap className="w-6 h-6" />
            </div>
            {mode === 'SNAPSHOT_LIVE' && (
              <span className="flex items-center gap-1 text-xs font-semibold text-brand-400 bg-brand-500/20 px-2.5 py-1 rounded-full border border-brand-500/30">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Selected
              </span>
            )}
          </div>
          <h3 className="text-lg font-bold text-white">
            Instant Live Snapshot
          </h3>
          <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
            Directly clones the current state of all collections from the production source to the target database with zero delay.
          </p>
          <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center gap-2 text-xs font-medium text-brand-300">
            <span>Fastest &bull; Ideal for standard staging refresh</span>
          </div>
        </div>

        {/* OPTION 2: POINT-IN-TIME RECOVERY (PITR) */}
        <div
          onClick={() => setMode('POINT_IN_TIME_PITR')}
          className={`glass-panel p-6 rounded-2xl border-2 cursor-pointer transition-all ${
            mode === 'POINT_IN_TIME_PITR'
              ? 'border-cyber-cyan bg-cyber-cyan/5 shadow-xl shadow-cyber-cyan/10 ring-1 ring-cyber-cyan/30'
              : 'border-slate-800 hover:border-slate-700 bg-slate-900/40 opacity-70 hover:opacity-100'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="p-3 rounded-xl bg-cyan-500/10 text-cyber-cyan border border-cyan-500/20 mb-4">
              <History className="w-6 h-6" />
            </div>
            {mode === 'POINT_IN_TIME_PITR' && (
              <span className="flex items-center gap-1 text-xs font-semibold text-cyber-cyan bg-cyan-500/20 px-2.5 py-1 rounded-full border border-cyan-500/30">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Selected
              </span>
            )}
          </div>
          <h3 className="text-lg font-bold text-white">
            Point-in-Time Recovery (PITR)
          </h3>
          <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
            Replays MongoDB Oplog operations (<code className="text-cyber-cyan font-mono">local.oplog.rs</code>) up to your exact chosen date, time, or transaction boundary.
          </p>
          <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center gap-2 text-xs font-medium text-cyan-300">
            <span>Time-Travel &bull; Reproduce bugs as of an exact past moment</span>
          </div>
        </div>
      </div>

      {/* PITR Interactive Date/Time & Oplog Timeline Controls */}
      {mode === 'POINT_IN_TIME_PITR' && (
        <div className="glass-panel p-6 rounded-2xl space-y-6 border border-cyber-cyan/30 bg-slate-900/70">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-cyan-500/10 text-cyber-cyan border border-cyan-500/20">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">
                  Point-in-Time Oplog Window
                </h3>
                <p className="text-xs text-slate-400">
                  Select the timestamp you want the database restored to
                </p>
              </div>
            </div>

            {loading && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyber-cyan" />
                <span>Checking Oplog...</span>
              </div>
            )}
          </div>

          {oplogWindow && !oplogWindow.available ? (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-200 leading-relaxed">
                <p className="font-semibold text-amber-300">Oplog Notice</p>
                <p className="mt-0.5">{oplogWindow.message || 'Source cluster is not running as a Replica Set with oplog enabled. The clone will proceed with the baseline snapshot.'}</p>
              </div>
            </div>
          ) : oplogWindow?.available ? (
            <div className="space-y-6">
              {/* Oplog metadata stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">EARLIEST POINT</span>
                  <span className="font-semibold text-slate-200">{new Date(oplogWindow.first_time_utc).toLocaleString()}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">LATEST POINT</span>
                  <span className="font-semibold text-slate-200">{new Date(oplogWindow.last_time_utc).toLocaleString()}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">OPLOG WINDOW</span>
                  <span className="font-semibold text-brand-400">{oplogWindow.window_duration_human}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">OPLOG SIZE</span>
                  <span className="font-semibold text-cyber-amber">{(oplogWindow.oplog_size_bytes / (1024 * 1024)).toFixed(1)} MB</span>
                </div>
              </div>

              {/* Interactive Timeline Slider */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-semibold text-slate-300">
                  <span>Earliest ({new Date(oplogWindow.first_time_utc).toLocaleTimeString()})</span>
                  <span className="text-cyber-cyan font-mono">Target: {pitrTargetTime.replace('T', ' ')}</span>
                  <span>Latest (Now)</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={sliderValue}
                  onChange={(e) => handleSliderChange(Number(e.target.value))}
                  className="w-full h-2.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyber-cyan focus:outline-none"
                />
              </div>

              {/* Precise Datetime Picker */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300">
                    Exact Target Date & Time (Local Time)
                  </label>
                  <input
                    type="datetime-local"
                    value={pitrTargetTime}
                    onChange={(e) => handleDateTimeChange(e.target.value)}
                    className="w-full glass-input px-4 py-2.5 rounded-xl font-mono text-xs"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300">
                    Calculated BSON Timestamp (Sec, Inc)
                  </label>
                  <div className="glass-input px-4 py-2.5 rounded-xl font-mono text-xs text-cyber-cyan bg-slate-950/60 flex items-center justify-between">
                    <span>Timestamp({pitrTimestamp?.T || 0}, {pitrTimestamp?.I || 1})</span>
                    <span className="text-[10px] text-slate-500">Epoch Sec</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-800/80">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Database Selection</span>
        </button>

        <button
          onClick={onNext}
          className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-brand-500 text-slate-950 hover:bg-brand-400 shadow-lg shadow-brand-500/20 transition-all"
        >
          <span>Continue to Data Masking & Sanitization</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
