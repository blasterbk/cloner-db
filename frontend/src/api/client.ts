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

export async function fetchConnectionsOverview(): Promise<Array<{
  profile: SavedProfile;
  online: boolean;
  server_info?: ServerInfo;
  catalog?: ClusterCatalog;
  error?: string;
}>> {
  const res = await fetch(`${API_BASE}/mongo/connections/overview`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch connections overview');
  return res.json();
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

export async function deleteProfile(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/profiles/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  const data = await res.json();
  return data.deleted;
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
