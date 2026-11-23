import fs from 'node:fs';
import path from 'node:path';

export const BACKUP_FORMAT = 'ai-os-backup';
export const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 80 * 1024 * 1024;
const FILE_NAME = /^[a-z0-9][a-z0-9-]*\.json$/;

/**
 * Never exported or restored:
 *  - permissions.json — a backup file must not be able to switch on the microphone or camera,
 *  - file-index.json — rebuildable, and large.
 */
const EXCLUDED = new Set(['permissions.json', 'file-index.json']);

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: number;
  appVersion: string;
  files: Record<string, string>;
}

export function isBackupFileName(name: string): boolean {
  return FILE_NAME.test(name) && !EXCLUDED.has(name);
}

export function createBackup(dataDir: string, appVersion: string, now = Date.now()): BackupFile {
  const files: Record<string, string> = {};
  let names: string[] = [];
  try {
    names = fs.readdirSync(dataDir);
  } catch {
    names = [];
  }
  for (const name of names.filter(isBackupFileName)) {
    const text = fs.readFileSync(path.join(dataDir, name), 'utf8');
    try {
      JSON.parse(text);
    } catch {
      continue; // never put a damaged file into a backup
    }
    files[name] = text;
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: now, appVersion, files };
}

export interface BackupCheck {
  ok: boolean;
  error?: string;
  files: string[];
  createdAt?: number;
}

/** Validate untrusted backup text before anything is written. */
export function inspectBackup(text: string): { check: BackupCheck; backup?: BackupFile } {
  if (text.length > MAX_BACKUP_BYTES) {
    return { check: { ok: false, error: 'That backup is too large.', files: [] } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { check: { ok: false, error: 'That is not a valid AI OS backup file.', files: [] } };
  }
  const data = parsed as Partial<BackupFile> | null;
  if (
    !data ||
    data.format !== BACKUP_FORMAT ||
    typeof data.files !== 'object' ||
    data.files === null
  ) {
    return { check: { ok: false, error: 'That is not an AI OS backup.', files: [] } };
  }
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    return {
      check: { ok: false, error: 'That backup was made by a newer version of AI OS.', files: [] },
    };
  }
  const files: Record<string, string> = {};
  for (const [name, content] of Object.entries(data.files)) {
    if (!isBackupFileName(name) || typeof content !== 'string') continue; // unknown names are ignored, never written
    try {
      JSON.parse(content);
    } catch {
      return {
        check: { ok: false, error: `The backup contains a damaged file (${name}).`, files: [] },
      };
    }
    files[name] = content;
  }
  const names = Object.keys(files);
  if (names.length === 0)
    return { check: { ok: false, error: 'The backup contains no data.', files: [] } };
  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    version: data.version,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
    appVersion: typeof data.appVersion === 'string' ? data.appVersion : '',
    files,
  };
  return { check: { ok: true, files: names, createdAt: backup.createdAt }, backup };
}

export interface RestoreResult {
  restored: string[];
  safetyCopy: string;
}

/** Copy the current data aside, then write each file atomically. The caller restarts the app. */
export function restoreBackup(
  dataDir: string,
  backup: BackupFile,
  now = Date.now(),
): RestoreResult {
  const safetyCopy = path.join(dataDir, 'backups', `pre-restore-${now}`);
  fs.mkdirSync(safetyCopy, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  for (const name of fs.readdirSync(dataDir).filter(isBackupFileName)) {
    fs.copyFileSync(path.join(dataDir, name), path.join(safetyCopy, name));
  }
  const restored: string[] = [];
  for (const [name, content] of Object.entries(backup.files)) {
    if (!isBackupFileName(name)) continue;
    const target = path.join(dataDir, name);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, target);
    restored.push(name);
  }
  return { restored, safetyCopy };
}
