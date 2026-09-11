import {
  ClusterCatalog,
  CloneJob,
  CloneJobRequest,
  EndpointConfig,
  OplogWindow,
  SavedProfile,
  ServerInfo,
} from '../types';


const API_BASE = '/api/v1';

/** Returns the stored auth token (or empty string if not logged in / auth disabled). */
export function getAuthToken(): string {
  try { return localStorage.getItem('mongoclone_auth_token') ?? ''; } catch { return ''; }
}

/** Returns headers object with Authorization Bearer token when a token exists. */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/** Auth API */
export async function loginUser(
  username: string,
  password: string
): Promise<{ token?: string; error?: string }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
}

export async function logoutUser(): Promise<void> {
  const token = getAuthToken();
  if (!token) return;
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
  localStorage.removeItem('mongoclone_auth_token');
}

export async function testConnection(config: EndpointConfig): Promise<{
  success: boolean;
  server_info?: ServerInfo;
  masked_uri?: string;
  error?: string;
}> {
  const res = await fetch(`${API_BASE}/mongo/test-connection`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(config),
  });
  return res.json();
}

export async function fetchCatalog(
  config: EndpointConfig,
  includeSystemDBs = false
): Promise<ClusterCatalog> {
  const res = await fetch(`${API_BASE}/mongo/catalog`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ config, include_system_dbs: includeSystemDBs }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch database catalog');
  }
  return res.json();
}

export async function fetchConnectionsOverview(forceRefresh = false): Promise<Array<{
  profile: SavedProfile;
  online: boolean;
  server_info?: ServerInfo;
  catalog?: ClusterCatalog;
  error?: string;
}>> {
  const url = forceRefresh
    ? `${API_BASE}/mongo/connections/overview?refresh=1`
    : `${API_BASE}/mongo/connections/overview`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch connections overview');
  return res.json();
}

/**
 * Async generator that streams the connections overview as NDJSON.
 * Yields each profile result the moment it arrives from the backend,
 * enabling progressive card rendering without waiting for all connections.
 */
export async function* streamConnectionsOverview(forceRefresh = false): AsyncGenerator<{
  profile: SavedProfile;
  online: boolean;
  server_info?: ServerInfo;
  catalog?: ClusterCatalog;
  error?: string;
}> {
  const url = forceRefresh
    ? `${API_BASE}/mongo/connections/overview/stream?refresh=1`
    : `${API_BASE}/mongo/connections/overview/stream`;

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok || !res.body) throw new Error('Failed to open overview stream');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Each JSON object is newline-delimited
      const lines = buffer.split('\n');
      // Keep the last (potentially incomplete) chunk in the buffer
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          yield JSON.parse(trimmed);
        } catch {
          // ignore malformed lines
        }
      }
    }
    // Flush any remaining data in the buffer
    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer.trim());
      } catch {
        // ignore
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function fetchOplogWindow(config: EndpointConfig): Promise<OplogWindow> {
  const res = await fetch(`${API_BASE}/mongo/oplog-window`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to inspect oplog window');
  }
  return res.json();
}

export async function startCloneJob(request: CloneJobRequest): Promise<CloneJob> {
  const res = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to start clone job');
  }
  return res.json();
}

export async function listJobs(): Promise<CloneJob[]> {
  const res = await fetch(`${API_BASE}/jobs`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch jobs list');
  return res.json();
}

export async function getJob(id: string): Promise<CloneJob> {
  const res = await fetch(`${API_BASE}/jobs/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Job not found');
  return res.json();
}

export async function cancelJob(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/jobs/${id}/cancel`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await res.json();
  return data.cancelled;
}

export async function pauseJob(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/jobs/${id}/pause`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await res.json();
  return data.paused;
}

export async function deleteJob(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/jobs/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  const data = await res.json();
  return data.deleted;
}

/** Bulk-delete multiple jobs in a single request. Returns the number deleted. */
export async function deleteJobsBulk(ids: string[]): Promise<number> {
  const res = await fetch(`${API_BASE}/jobs`, {
    method: 'DELETE',
    headers: authHeaders(),
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error('Bulk delete failed');
  const data = await res.json();
  return data.deleted ?? 0;
}

/** Delete ALL non-running job history records. Returns the number cleared. */
export async function clearAllJobs(): Promise<number> {
  const res = await fetch(`${API_BASE}/jobs`, {
    method: 'DELETE',
    headers: authHeaders(),
    body: JSON.stringify({ clear_all: true }),
  });
  if (!res.ok) throw new Error('Clear history failed');
  const data = await res.json();
  return data.cleared ?? 0;
}


// ─── Profiles (backend API → data/profiles.json) ───────────────────────────────────
// Profiles are stored server-side in data/profiles.json via the backend REST API.
// No MongoDB dependency — the backend uses local JSON files only.

export async function listProfiles(): Promise<SavedProfile[]> {
  const res = await fetch(`${API_BASE}/profiles`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function saveProfile(
  name: string,
  type: 'source' | 'target',
  config: EndpointConfig
): Promise<SavedProfile> {
  const res = await fetch(`${API_BASE}/profiles`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, type, config }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to save profile (${res.status})`);
  }
  return res.json();
}

export async function updateProfile(
  id: string,
  name: string,
  config: EndpointConfig,
  type: 'source' | 'target' = 'target'
): Promise<SavedProfile> {
  const res = await fetch(`${API_BASE}/profiles/${id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ name, config }),
  });
  if (!res.ok) throw new Error('Failed to update profile');
  return res.json();
}

export async function deleteProfile(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/profiles/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  const data = await res.json();
  return data.deleted;
}

export async function resumeJob(id: string): Promise<{ resumed: boolean }> {
  const res = await fetch(`${API_BASE}/jobs/${id}/resume`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to resume job');
  }
  return res.json();
}

// WebSocket Stream Client
export function connectTelemetryWebSocket(
  onMessage: (msg: { type: string; job_id?: string; payload: any }) => void,
  onOpen?: () => void,
  onClose?: () => void
): () => void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Pass auth token as query param — browsers can't set custom headers on WebSocket connections
  const token = getAuthToken();
  const wsUrl = `${protocol}//${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;

  let ws: WebSocket | null = null;
  let isClosed = false;
  let reconnectTimeout: any;

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => { onOpen?.(); };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (e) {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      onClose?.();
      if (!isClosed) {
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => { ws?.close(); };
  }

  connect();

  return () => {
    isClosed = true;
    clearTimeout(reconnectTimeout);
    ws?.close();
  };
}
