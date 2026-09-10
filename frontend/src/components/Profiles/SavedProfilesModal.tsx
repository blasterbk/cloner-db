import React, { useState, useEffect } from 'react';
import { EndpointConfig, SavedProfile } from '../../types';
import { listProfiles, saveProfile, updateProfile, deleteProfile } from '../../api/client';
import {
  X,
  Trash2,
  BookmarkPlus,
  Database,
  Pencil,
  Check,
  AlertTriangle,
} from 'lucide-react';

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

  // Delete confirmation
  const [profileToDelete, setProfileToDelete] = useState<SavedProfile | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edit mode
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editUri, setEditUri] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadProfiles();
      setEditingId(null);
      setProfileToDelete(null);
    }
  }, [isOpen]);

  // Escape-key support
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (profileToDelete) { setProfileToDelete(null); return; }
        if (editingId) { setEditingId(null); return; }
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, profileToDelete, editingId, onClose]);

  async function loadProfiles() {
    setLoading(true);
    try {
      const data = await listProfiles();
      setProfiles(data);
    } catch (_) {
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
    } catch (_) {
      // ignore — handled silently
    }
  }

  async function handleDeleteConfirmed() {
    if (!profileToDelete) return;
    setDeleting(true);
    try {
      await deleteProfile(profileToDelete.id);
      setProfileToDelete(null);
      loadProfiles();
    } catch (_) {
    } finally {
      setDeleting(false);
    }
  }

  function startEdit(prof: SavedProfile) {
    setEditingId(prof.id);
    setEditName(prof.name);
    setEditUri(prof.config.uri || `mongodb://${prof.config.host || ''}:${prof.config.port || 27017}`);
    setEditError(null);
  }

  async function handleEditSave(prof: SavedProfile) {
    if (!editName.trim()) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await updateProfile(prof.id, editName.trim(), { ...prof.config, uri: editUri.trim() }, prof.type as 'source' | 'target');
      setEditingId(null);
      loadProfiles();
    } catch (e: any) {
      setEditError(e.message || 'Failed to update profile');
    } finally {
      setEditSaving(false);
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
                {profiles.map((prof) => {
                  const isEditing = editingId === prof.id;
                  const displayUri =
                    prof.config.uri ||
                    `mongodb://${prof.config.host || '127.0.0.1'}:${prof.config.port || 27017}`;

                  return (
                    <div
                      key={prof.id}
                      className={`p-3.5 rounded-xl border transition-all ${
                        isEditing
                          ? 'bg-slate-900 border-brand-500/40 shadow-md shadow-brand-500/10'
                          : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      {isEditing ? (
                        /* ── Edit Mode ─────────────────────────────────────── */
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 mb-1">
                            <Pencil className="w-3.5 h-3.5 text-brand-400" />
                            <span className="text-xs font-semibold text-brand-400">Editing Profile</span>
                          </div>
                          <div className="grid grid-cols-1 gap-2.5">
                            <div>
                              <label className="block text-[10px] text-slate-400 mb-1">Profile Name</label>
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="w-full glass-input px-3 py-2 rounded-lg text-xs"
                                placeholder="Profile name"
                                autoFocus
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-slate-400 mb-1">MongoDB URI</label>
                              <input
                                type="text"
                                value={editUri}
                                onChange={(e) => setEditUri(e.target.value)}
                                className="w-full glass-input px-3 py-2 rounded-lg text-xs font-mono"
                                placeholder="mongodb://user:pass@host/db"
                              />
                            </div>
                          </div>
                          {editError && (
                            <p className="text-[11px] text-rose-400 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              {editError}
                            </p>
                          )}
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={() => handleEditSave(prof)}
                              disabled={!editName.trim() || editSaving}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-500 text-slate-950 hover:bg-brand-400 disabled:opacity-50 transition-all"
                            >
                              <Check className="w-3.5 h-3.5" />
                              {editSaving ? 'Saving...' : 'Save Changes'}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* ── View Mode ─────────────────────────────────────── */
                        <div className="flex items-center justify-between gap-4">
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
                              {displayUri}
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
                            {/* Edit button */}
                            <button
                              onClick={() => startEdit(prof)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                              title="Edit Profile"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            {/* Delete button */}
                            <button
                              onClick={() => setProfileToDelete(prof)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                              title="Delete Profile"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Delete Confirmation Modal ──────────────────────────────────────────── */}
      {profileToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150">
          <div className="glass-panel w-full max-w-sm rounded-3xl border border-rose-500/30 p-6 space-y-5 shadow-2xl bg-slate-900/95 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-2xl bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Delete Profile?</h3>
                <p className="text-xs text-slate-400 mt-0.5">This cannot be undone</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
              Delete{' '}
              <span className="text-white font-mono font-bold bg-slate-800 px-1.5 py-0.5 rounded">
                {profileToDelete.name}
              </span>
              ? Saved connection details will be permanently removed from the server.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setProfileToDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirmed}
                disabled={deleting}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-500 hover:bg-rose-400 text-white transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
