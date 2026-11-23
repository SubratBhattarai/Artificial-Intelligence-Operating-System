import type { ShellSnapshot } from '../../shared/protocol';

/**
 * The renderer owns window state; it pushes a sanitized snapshot here so that read-only tools
 * (e.g. `app_status`) can report on the shell without reaching into renderer memory.
 */
let snapshot: ShellSnapshot | null = null;

export function setShellSnapshot(next: ShellSnapshot | null): void {
  snapshot = next;
}

export function getShellSnapshot(): ShellSnapshot | null {
  return snapshot;
}
