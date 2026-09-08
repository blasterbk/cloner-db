/**
 * Shared formatting utilities for MongoClone UI.
 * Centralizes formatBytes, formatTime, and formatDocsPerSec to avoid duplication across components.
 */

/** Format a byte count into a human-readable string (e.g., 1.5 GB) */
export function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/** Format a duration in seconds to a human-readable string (e.g., 2h 3m 15s) */
export function formatTime(sec: number): string {
  if (!sec || sec <= 0) return '0s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Format a docs/sec throughput rate with K/M suffixes */
export function formatDocsPerSec(n: number): string {
  if (!n || n <= 0) return '0/s';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M/s`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K/s`;
  return `${n}/s`;
}

/** Format a throughput in bytes/sec to MB/s */
export function formatMBps(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 MB/s';
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
}
