/**
 * profileStorage.ts
 *
 * Client-side localStorage service for saved connection profiles and app settings.
 * All profile data is stored exclusively in the browser — no external database required.
 * The backend is fully stateless with respect to connection profiles.
 */

import { EndpointConfig, SavedProfile } from '../types';

const PROFILES_KEY = 'mongoclone_profiles';
const SETTINGS_KEY = 'mongoclone_settings';

export interface AppSettings {
  defaultTargetURI: string;
  defaultTargetName: string;
}

// ─── Settings ────────────────────────────────────────────────────────────────

/** Returns the stored app settings (default target URI/name). */
export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        defaultTargetURI: parsed.defaultTargetURI ?? '',
        defaultTargetName: parsed.defaultTargetName ?? '',
      };
    }
  } catch {
    // ignore
  }
  return { defaultTargetURI: '', defaultTargetName: '' };
}

/** Persists app settings to localStorage. */
export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

// ─── Profiles ─────────────────────────────────────────────────────────────────

/** Returns all saved connection profiles from localStorage. */
export function listProfilesFromStorage(): SavedProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as SavedProfile[];
  } catch {
    // ignore
  }
  return [];
}

/** Persists the full profile list to localStorage. */
function persistProfiles(profiles: SavedProfile[]): void {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    // ignore
  }
}

/**
 * Saves a new connection profile to localStorage.
 * If a profile with the same name and type already exists, its config is updated in-place.
 */
export function saveProfileToStorage(
  name: string,
  type: 'source' | 'target',
  config: EndpointConfig
): SavedProfile {
  const profiles = listProfilesFromStorage();

  // Update existing profile if name+type match
  const existingIdx = profiles.findIndex(
    (p) => p.name === name && p.type === type
  );
  if (existingIdx !== -1) {
    profiles[existingIdx] = { ...profiles[existingIdx], config };
    persistProfiles(profiles);
    return profiles[existingIdx];
  }

  // Create new profile
  const newProfile: SavedProfile = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name,
    type,
    config,
    created_at: new Date().toISOString(),
  };

  profiles.push(newProfile);
  persistProfiles(profiles);
  return newProfile;
}

/**
 * Updates an existing profile by ID.
 * Returns the updated profile or null if not found.
 */
export function updateProfileInStorage(
  id: string,
  name: string,
  config: EndpointConfig
): SavedProfile | null {
  const profiles = listProfilesFromStorage();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  profiles[idx] = { ...profiles[idx], name, config };
  persistProfiles(profiles);
  return profiles[idx];
}

/**
 * Deletes a profile by ID from localStorage.
 * Returns true if a profile was found and deleted.
 */
export function deleteProfileFromStorage(id: string): boolean {
  const profiles = listProfilesFromStorage();
  const filtered = profiles.filter((p) => p.id !== id);
  if (filtered.length === profiles.length) return false;
  persistProfiles(filtered);
  return true;
}

/**
 * Seeds the default target profile from settings into localStorage profiles.
 * Called once on app boot if no profiles exist and defaultTargetURI is configured.
 */
export function seedDefaultProfileIfNeeded(): void {
  const profiles = listProfilesFromStorage();
  const settings = getSettings();

  if (!settings.defaultTargetURI) return;

  const defaultName = settings.defaultTargetName || 'Default Target';
  const alreadyExists = profiles.some(
    (p) => p.type === 'target' && p.name === defaultName
  );

  if (!alreadyExists) {
    saveProfileToStorage(defaultName, 'target', {
      uri: settings.defaultTargetURI,
    });
  }
}
