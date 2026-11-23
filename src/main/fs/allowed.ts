import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FolderEntry, FolderListing } from '../../shared/protocol';
import { config } from '../config';

const MAX_ENTRIES = 200;

/** Folders the user explicitly picked (file index). They are browsable in addition to the defaults. */
let selectedRoots: string[] = [];

/**
 * Single files the user dragged into AI OS. Exact paths only (never their folders), read-only,
 * and forgotten when the app closes.
 */
const droppedFiles = new Set<string>();
const MAX_DROPPED = 50;

export async function allowDroppedFiles(paths: string[]): Promise<string[]> {
  const accepted: string[] = [];
  for (const raw of paths.slice(0, 10)) {
    if (typeof raw !== 'string' || !path.isAbsolute(raw)) continue;
    try {
      const real = await fs.realpath(raw);
      if (!(await fs.stat(real)).isFile()) continue;
      if (droppedFiles.size >= MAX_DROPPED)
        droppedFiles.delete(droppedFiles.values().next().value as string);
      droppedFiles.add(real);
      accepted.push(real);
    } catch {
      // unreadable or gone: skip it
    }
  }
  return accepted;
}

export function setSelectedRoots(paths: string[]): void {
  selectedRoots = paths.map((entry) => path.resolve(entry));
}

/** Roots that are readable by the Files app and the `list_folder` tool. */
export function allowedRoots(): string[] {
  const defaults = ['Documents', 'Desktop', 'Downloads'].map((name) =>
    path.join(os.homedir(), name),
  );
  const configured = config.allowedFolders.length > 0 ? config.allowedFolders : defaults;
  return [
    ...new Set([...configured, ...selectedRoots].map((root) => path.resolve(expandHome(root)))),
  ];
}

function expandHome(target: string): string {
  if (target === '~') return os.homedir();
  if (target.startsWith('~/') || target.startsWith('~\\'))
    return path.join(os.homedir(), target.slice(2));
  return target;
}

/**
 * Resolve a path against the allowlist. Returns null when the path escapes every allowed root
 * (including via `..` traversal or symlink-free prefix tricks).
 */
export function resolveAllowed(target?: string | null): string {
  const roots = allowedRoots();
  const requested = target && target.trim().length > 0 ? target.trim() : roots[0];
  const resolved = path.resolve(expandHome(requested));
  if (droppedFiles.has(resolved)) return resolved;
  for (const root of roots) {
    const relative = path.relative(root, resolved);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      return resolved;
    }
  }
  throw new Error(`PATH_NOT_ALLOWED: ${resolved}`);
}

export async function listFolder(target?: string | null): Promise<FolderListing> {
  const dir = resolveAllowed(target);
  const dirents = await fs.readdir(dir, { withFileTypes: true });

  const entries: FolderEntry[] = [];
  for (const dirent of dirents) {
    if (entries.length >= MAX_ENTRIES) break;
    if (dirent.name.startsWith('.')) continue;
    let size = 0;
    let modifiedAt = 0;
    try {
      const stats = await fs.stat(path.join(dir, dirent.name));
      size = stats.size;
      modifiedAt = stats.mtimeMs;
    } catch {
      // Ignore entries we cannot stat (locked/removed meanwhile).
    }
    entries.push({
      name: dirent.name,
      type: dirent.isDirectory() ? 'directory' : dirent.isFile() ? 'file' : 'other',
      size,
      modifiedAt,
    });
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const roots = allowedRoots();
  const isRoot = roots.some((root) => path.resolve(dir) === root);
  const parent = isRoot ? null : path.dirname(dir);

  return {
    path: dir,
    parent,
    roots,
    entries,
    truncated: dirents.length > entries.length,
  };
}

/**
 * Like `resolveAllowed`, but also follows symlinks/junctions: the real location of the target must
 * still sit inside a real allowed root. Use before reading, previewing or opening a file.
 */
export async function resolveAllowedReal(target: string): Promise<string> {
  const lexical = resolveAllowed(target);
  const real = await fs.realpath(lexical);
  if (droppedFiles.has(real)) return real;
  const realRoots = await Promise.all(
    allowedRoots().map((root) => fs.realpath(root).catch(() => root)),
  );
  for (const root of realRoots) {
    const relative = path.relative(root, real);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return real;
  }
  throw new Error(`PATH_NOT_ALLOWED: ${real}`);
}
