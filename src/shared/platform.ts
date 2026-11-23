/** Contracts for storage cleanup, backup and restore. */

export type CleanupActionId =
  'expired_memory' | 'old_conversations' | 'old_audit' | 'unused_models' | 'caches' | 'leftovers';

export interface CleanupAction {
  id: CleanupActionId;
  label: string;
  description: string;
  /** Bytes that would be freed (exact for files, estimated for records). */
  bytes: number;
  /** Items that would be removed (records or files). */
  items: number;
}

export interface StorageRow {
  label: string;
  bytes: number;
}

export interface StorageReport {
  totalBytes: number;
  rows: StorageRow[];
  actions: CleanupAction[];
  /** AI OS's own memory use in MB (all processes), for the memory-cleaning panel. */
  processMemoryMb: number;
  speechModelLoaded: boolean;
}

export interface CleanupResult {
  ok: boolean;
  freedBytes: number;
  removedItems: number;
  done: CleanupActionId[];
  errors: string[];
}

export interface BackupResult {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  files?: string[];
  error?: string;
}

export interface RestorePreview {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  token?: string;
  files?: string[];
  createdAt?: number;
}

export interface PhotoInfo {
  name: string;
  bytes: number;
  takenAt: number;
}

export interface ApprovedApp {
  id: string;
  name: string;
  /** Image name used to detect and close the app, e.g. notepad.exe. */
  exe: string;
  /** Full path to launch. Built-in Windows tools launch by name. */
  path?: string;
  builtin: boolean;
}
