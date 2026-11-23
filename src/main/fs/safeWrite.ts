import fs from 'node:fs/promises';
import path from 'node:path';
import { allowedRoots, resolveAllowed } from './allowed';

/** Programs and scripts are never created, moved onto or edited by JARVIS. */
export const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'bat',
  'cmd',
  'com',
  'ps1',
  'psm1',
  'vbs',
  'vbe',
  'wsf',
  'msi',
  'scr',
  'lnk',
  'dll',
  'sys',
  'reg',
  'jar',
  'hta',
  'cpl',
  'msc',
  'appx',
  'msix',
]);

export const MAX_CREATE_BYTES = 200_000;
export const MAX_EDIT_BYTES = 1_000_000;

export function hasBlockedExtension(target: string): boolean {
  return BLOCKED_EXTENSIONS.has(path.extname(target).slice(1).toLowerCase());
}

async function realRoots(): Promise<string[]> {
  return Promise.all(allowedRoots().map((root) => fs.realpath(root).catch(() => root)));
}

function inside(root: string, real: string): boolean {
  const relative = path.relative(root, real);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Resolve a path JARVIS wants to write: inside an allowed folder both lexically and after
 * following links. For a file that does not exist yet, its parent folder is what gets checked.
 */
export async function resolveWritable(
  target: string,
): Promise<{ lexical: string; real: string; exists: boolean }> {
  const lexical = resolveAllowed(target);
  let exists = true;
  let real: string;
  try {
    real = await fs.realpath(lexical);
  } catch {
    exists = false;
    const parent = await fs.realpath(path.dirname(lexical)).catch(() => null);
    if (!parent) throw new Error('That folder does not exist.');
    real = path.join(parent, path.basename(lexical));
  }
  const roots = await realRoots();
  if (!roots.some((root) => inside(root, real))) throw new Error(`PATH_NOT_ALLOWED: ${real}`);
  return { lexical, real, exists };
}

/** Refuse root folders and names Windows treats specially. */
export function checkFileName(target: string): string | null {
  const name = path.basename(target);
  if (!name || name.startsWith('.')) return 'Choose a normal file name (not hidden).';
  const forbidden = /[<>:"|?*]/.test(name) || [...name].some((char) => char.charCodeAt(0) < 32);
  if (forbidden) return 'That file name has characters Windows does not allow.';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(name))
    return 'That is a reserved Windows name.';
  if (hasBlockedExtension(name)) return 'Programs and scripts cannot be created or changed here.';
  return null;
}
