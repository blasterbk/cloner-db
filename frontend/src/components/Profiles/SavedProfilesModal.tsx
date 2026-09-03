import React, { useState, useEffect } from 'react';
import { EndpointConfig, SavedProfile } from '../../types';
import { listProfiles, saveProfile, deleteProfile } from '../../api/client';
import { X, Trash2, Check, BookmarkPlus, Server, Database } from 'lucide-react';

interface SavedProfilesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProfile: (config: EndpointConfig, targetSlot: 'source' | 'target') => void;
  currentSourceConfig?: EndpointConfig;
  currentTargetConfig?: EndpointConfig;
}

export const SavedProfilesModal: React.FC<SavedProfilesModalProps> = ({
  isOpen,
  onClose,
  onSelectProfile,
  currentSourceConfig,
  currentTargetConfig,
}) => {
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileSlot, setNewProfileSlot] = useState<'source' | 'target'>('source');

  useEffect(() => {
    if (isOpen) {
      loadProfiles();
    }
  }, [isOpen]);

  async function loadProfiles() {
    setLoading(true);
    try {
      const data = await listProfiles();
      setProfiles(data);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveCurrent() {
    if (!newProfileName.trim()) return;
    const configToSave =
      newProfileSlot === 'source' ? currentSourceConfig : currentTargetConfig;
    if (!configToSave) return;

    try {
      await saveProfile(newProfileName.trim(), newProfileSlot, configToSave);
      setNewProfileName('');
      loadProfiles();
    } catch (e) {
      alert('Failed to save profile');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this profile?')) return;
    try {
      await deleteProfile(id);
      loadProfiles();
    } catch (e) {
      // ignore
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="glass-panel w-full max-w-2xl rounded-2xl border border-slate-700/80 overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyber-amber/10 border border-cyber-amber/20 text-cyber-amber">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                Saved Connection Profiles
              </h2>
              <p className="text-xs text-slate-400">
                Store and quickly load your Production and Staging MongoDB endpoints
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
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Quick save box */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <BookmarkPlus className="w-4 h-4 text-brand-400" />
              Save Current Configuration
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <input
                type="text"
                placeholder="Profile Name (e.g. Prod ReplicaSet, Local Docker)"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                className="sm:col-span-6 glass-input px-3.5 py-2 rounded-xl text-xs"
              />
              <select
                value={newProfileSlot}
                onChange={(e) =>
                  setNewProfileSlot(e.target.value as 'source' | 'target')
                }
                className="sm:col-span-3 glass-input px-3 py-2 rounded-xl text-xs"
              >
                <option value="source">From Source</option>
                <option value="target">From Target</option>
              </select>
              <button
                onClick={handleSaveCurrent}
                disabled={!newProfileName.trim()}
                className="sm:col-span-3 px-4 py-2 rounded-xl text-xs font-semibold bg-brand-500 text-slate-950 hover:bg-brand-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                Save Profile
              </button>
            </div>
          </div>

          {/* List of profiles */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Stored Presets ({profiles.length})
            </h3>
            {loading ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Loading saved profiles...
              </div>
            ) : profiles.length === 0 ? (
              <div className="p-8 text-center rounded-xl border border-dashed border-slate-800 text-xs text-slate-500">
                No saved profiles yet. Save your frequent source or target database configurations above!
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5">
                {profiles.map((prof) => (
                  <div
                    key={prof.id}
                    className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 transition-all flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-white">
                          {prof.name}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-semibold rounded-md uppercase border ${
                            prof.type === 'source'
                              ? 'bg-cyber-cyan/10 text-cyber-cyan border-cyber-cyan/30'
                              : 'bg-cyber-violet/10 text-cyber-violet border-cyber-violet/30'
                          }`}
                        >
                          {prof.type}
                        </span>
                      </div>
                      <p className="text-xs font-mono text-slate-400 truncate mt-0.5">
                        {prof.config.uri ||
                          `mongodb://${prof.config.host || '127.0.0.1'}:${
                            prof.config.port || 27017
                          }`}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => {
                          onSelectProfile(prof.config, 'source');
                          onClose();
                        }}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                      >
                        Load to Source
                      </button>
                      <button
                        onClick={() => {
                          onSelectProfile(prof.config, 'target');
                          onClose();
                        }}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                      >
                        Load to Target
                      </button>
                      <button
                        onClick={() => handleDelete(prof.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title="Delete Profile"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
