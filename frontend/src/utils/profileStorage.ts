/**
 * profileStorage.ts
 *
 * Browser localStorage service for app settings only.
 *
 * Profiles (saved MongoDB connection presets) are stored server-side in
 * data/profiles.json via the /api/v1/profiles REST API — NOT in localStorage.
 *
 * This module handles only:
 *   - Default Target URI / Name (used to seed the first profile on boot)
 *   - Any other client-side UI preferences
 */

const SETTINGS_KEY = 'mongoclone_settings';

export interface AppSettings {
  defaultTargetURI: string;
  defaultTargetName: string;
}

// ─── App Settings ─────────────────────────────────────────────────────────────

/** Returns the stored app settings (default target URI/name) from localStorage. */
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
