import path from 'node:path';
import {
  PERMISSIONS,
  emptyPermissions,
  isPermissionId,
  isPermissionLevel,
  labelOf,
  levelAllows,
  requirementFor,
  type PermissionId,
  type PermissionLevel,
  type PermissionMap,
} from '../../shared/permissions';
import { JsonFile } from '../store/jsonFile';

interface PermissionData {
  version: 1;
  levels: PermissionMap;
  changedAt: number | null;
}

/** Everything starts off. Only the user's clicks in Settings change it. */
export class PermissionStore {
  private readonly file: JsonFile<PermissionData>;

  constructor(dataDir: string) {
    this.file = new JsonFile<PermissionData>(
      path.join(dataDir, 'permissions.json'),
      () => ({ version: 1, levels: emptyPermissions(), changedAt: null }),
      (raw) => {
        const data = raw as Partial<PermissionData> | null;
        if (!data || typeof data.levels !== 'object' || data.levels === null) return null;
        const levels = emptyPermissions();
        for (const [key, value] of Object.entries(data.levels)) {
          if (isPermissionId(key) && isPermissionLevel(value)) levels[key] = this.clamp(key, value);
        }
        return {
          version: 1,
          levels,
          changedAt: typeof data.changedAt === 'number' ? data.changedAt : null,
        };
      },
    );
  }

  /** A level the permission does not offer falls back to the nearest lower one. */
  private clamp(id: PermissionId, level: PermissionLevel): PermissionLevel {
    const allowed = PERMISSIONS.find((entry) => entry.id === id)?.levels ?? ['off'];
    if (allowed.includes(level)) return level;
    if (level === 'write' && allowed.includes('read')) return 'read';
    return 'off';
  }

  get(): PermissionMap {
    return { ...this.file.value.levels };
  }

  level(id: PermissionId): PermissionLevel {
    return this.file.value.levels[id] ?? 'off';
  }

  allows(id: PermissionId, needed: PermissionLevel): boolean {
    return levelAllows(this.level(id), needed);
  }

  set(id: PermissionId, level: PermissionLevel, now = Date.now()): PermissionMap {
    const allowed = PERMISSIONS.find((entry) => entry.id === id)?.levels ?? [];
    if (!allowed.includes(level)) throw new Error(`${labelOf(id)} cannot be set to ${level}.`);
    this.file.set({
      version: 1,
      levels: { ...this.file.value.levels, [id]: level },
      changedAt: now,
    });
    return this.get();
  }

  revokeAll(now = Date.now()): PermissionMap {
    this.file.set({ version: 1, levels: emptyPermissions(), changedAt: now });
    return this.get();
  }

  /**
   * Check a tool's declared permissions. Returns null when allowed, otherwise a message that tells
   * the model (and so the user) exactly which switch is off.
   */
  checkTool(toolPermissions: readonly string[]): string | null {
    for (const permission of toolPermissions) {
      const need = requirementFor(permission);
      if (!need) continue;
      if (!this.allows(need.id, need.level)) {
        const verb = need.level === 'write' ? 'change' : need.level === 'read' ? 'read' : 'use';
        return `permission_denied: ${labelOf(need.id)} access is off. Ask the user to allow JARVIS to ${verb} ${labelOf(need.id)} in Settings › Permissions.`;
      }
    }
    return null;
  }

  flush(): void {
    this.file.flushSync();
  }
}
