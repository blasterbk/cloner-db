export interface EndpointConfig {
  uri?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  auth_source?: string;
  replica_set?: string;
  tls_enabled?: boolean;
  tls_skip_verify?: boolean;
  direct_connection?: boolean;
  timeout_ms?: number;
}

export interface ServerInfo {
  version: string;
  git_version?: string;
  topology_type: 'Standalone' | 'ReplicaSet' | 'ShardedCluster';
  replica_set_name?: string;
  is_primary: boolean;
  hosts?: string[];
  latency_ms: number;
  uptime_seconds: number;
  max_bson_size_bytes: number;
  storage_engine: string;
}

export interface IndexDetail {
  name: string;
  key: Array<{ Key: string; Value: any }>;
  unique?: boolean;
  sparse?: boolean;
  expire_after_seconds?: number;
  size_bytes: number;
}

export interface CollectionDetail {
  name: string;
  doc_count: number;
  storage_size_bytes: number;
  avg_doc_size_bytes: number;
  total_index_size_bytes: number;
  index_count: number;
  is_capped: boolean;
  max_capped_docs?: number;
  max_capped_bytes?: number;
  indexes: IndexDetail[];
}

export interface DatabaseDetail {
  name: string;
  size_bytes: number;
  empty: boolean;
  total_collections: number;
  total_documents: number;
  collections: CollectionDetail[];
}

export interface ClusterCatalog {
  total_databases: number;
  total_collections: number;
  total_documents: number;
  total_data_size_bytes: number;
  databases: DatabaseDetail[];
}

export interface OplogWindow {
  available: boolean;
  first_timestamp_sec: number;
  first_increment: number;
  first_time_formatted: string;
  first_time_utc: string;

  last_timestamp_sec: number;
  last_increment: number;
  last_time_formatted: string;
  last_time_utc: string;

  window_duration_seconds: number;
  window_duration_human: string;
  oplog_size_bytes: number;
  oplog_max_size_bytes: number;
  message?: string;
}

export type MaskType =
  | 'email'
  | 'phone'
  | 'password'
  | 'credit_card'
  | 'hash_sha256'
  | 'fixed_value'
  | 'remove_field'
  | 'regex_replace';

export interface MaskRule {
  database: string;
  collection: string;
  field_path: string;
  type: MaskType;
  custom_value?: string;
  regex_pattern?: string;
  regex_replace?: string;
}

export interface DatabaseMapping {
  source_database: string;
  target_database: string;
  all_collections: boolean;
  collections?: string[];
  collection_map?: Record<string, string>;
}

export type CloneMode = 'SNAPSHOT_LIVE' | 'POINT_IN_TIME_PITR';

export type JobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'PAUSED';

export interface CollectionCopyProgress {
  database: string;
  collection: string;
  target_database: string;
  target_collection: string;
  transferred_docs: number;
  total_docs: number;
  transferred_bytes: number;
  percent: number;
  docs_per_sec: number;
  bytes_per_sec: number;
  completed: boolean;
  error?: string;
}

export interface ProgressTelemetry {
  phase: string;
  current_collection: string;
  total_collections: number;
  completed_collections: number;
  total_estimated_docs: number;
  transferred_docs: number;
  total_estimated_bytes: number;
  transferred_bytes: number;
  percent: number;
  throughput_mbs: number;
  docs_per_sec: number;
  replayed_oplog_ops: number;
  eta_seconds: number;
  collections: Record<string, CollectionCopyProgress>;
}

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  message: string;
}

export interface CloneJobRequest {
  name: string;
  mode: CloneMode;
  source: EndpointConfig;
  target: EndpointConfig;
  databases: DatabaseMapping[];
  pitr_timestamp?: { T: number; I: number };
  pitr_target_time?: string;
  masking_rules?: MaskRule[];
  drop_target_first: boolean;
  preserve_indexes: boolean;
  batch_size?: number;
  parallel_collections?: number;
  defer_indexes?: boolean;
}

export interface CloneJob {
  id: string;
  name: string;
  status: JobStatus;
  mode: CloneMode;
  source_masked: string;
  target_masked: string;
  request: CloneJobRequest;
  progress: ProgressTelemetry;
  oplog_window?: OplogWindow;
  logs: LogEntry[];
  error?: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  duration_seconds: number;
}

export interface SavedProfile {
  id: string;
  name: string;
  type: 'source' | 'target';
  config: EndpointConfig;
  created_at: string;
}
