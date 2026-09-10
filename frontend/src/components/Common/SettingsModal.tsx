import React, { useState, useEffect } from 'react';
import { X, Settings, Save, Database, ExternalLink, CheckCircle, Trash2, AlertTriangle } from 'lucide-react';
import { getSettings, saveSettings, AppSettings } from '../../utils/profileStorage';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional callback: when user clicks "Load as Target" from settings */
  onLoadAsTarget?: (uri: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onLoadAsTarget,
}) => {
  const [settings, setSettings] = useState<AppSettings>({
    defaultTargetURI: '',
    defaultTargetName: '',
  });
  const [saved, setSaved] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSettings(getSettings());
      setSaved(false);
      setShowClearConfirm(false);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  function handleSave() {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleClearSettings() {
    const empty: AppSettings = { defaultTargetURI: '', defaultTargetName: '' };
    saveSettings(empty);
    setSettings(empty);
    setShowClearConfirm(false);
    setSaved(false);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="glass-panel w-full max-w-lg rounded-2xl border border-slate-700/80 overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-brand-500/10 border border-brand-500/20 text-brand-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">App Settings</h2>
              <p className="text-xs text-slate-400">
                Stored locally in your browser — no server required
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Default Target Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-cyber-violet" />
              <h3 className="text-sm font-semibold text-slate-200">
                Default Target Connection
              </h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Set your default target MongoDB URI here. It will be auto-seeded into your
              saved profiles on first launch and can be loaded into the clone wizard.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Profile Name
                </label>
                <input
                  id="settings-default-target-name"
                  type="text"
                  placeholder="e.g. Birat Staging DB"
                  value={settings.defaultTargetName}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, defaultTargetName: e.target.value }))
                  }
                  className="w-full glass-input px-3.5 py-2.5 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  MongoDB URI
                </label>
                <input
                  id="settings-default-target-uri"
                  type="text"
                  placeholder="mongodb://user:pass@host1,host2/db?authsource=admin"
                  value={settings.defaultTargetURI}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, defaultTargetURI: e.target.value }))
                  }
                  className="w-full glass-input px-3.5 py-2.5 rounded-xl text-sm font-mono"
                />
              </div>

              {settings.defaultTargetURI && onLoadAsTarget && (
                <button
                  onClick={() => {
                    onLoadAsTarget(settings.defaultTargetURI);
                    onClose();
                  }}
                  className="flex items-center gap-1.5 text-xs text-cyber-cyan hover:text-white transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Load this URI into the Clone Wizard target
                </button>
              )}
            </div>
          </div>

          {/* Storage Info */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              <span className="text-slate-400 font-semibold">Storage:</span>{' '}
              These settings (default target URI &amp; name) are stored in your browser's{' '}
              <code className="text-brand-400 bg-slate-800/80 px-1 rounded">localStorage</code>.
              Connection profiles are stored server-side in{' '}
              <code className="text-cyber-cyan bg-slate-800/80 px-1 rounded">data/profiles.json</code>.
            </p>
          </div>

          {/* Clear Settings Danger Zone */}
          {!showClearConfirm ? (
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={!settings.defaultTargetURI && !settings.defaultTargetName}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-rose-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear saved settings
            </button>
          ) : (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-3 animate-in fade-in duration-150">
              <div className="flex items-center gap-2 text-rose-300">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <p className="text-xs font-semibold">
                  This will erase your saved default target URI and name from localStorage.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClearSettings}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-500 hover:bg-rose-400 text-white transition-colors"
                >
                  Yes, Clear Settings
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 pb-5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            id="settings-save-btn"
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-brand-500 text-slate-950 hover:bg-brand-400 transition-all shadow-md shadow-brand-500/20"
          >
            {saved ? (
              <>
                <CheckCircle className="w-4 h-4" />
                Saved!
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Settings
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
