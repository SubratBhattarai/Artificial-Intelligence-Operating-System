import { create } from 'zustand';
import {
  emptyPermissions,
  levelAllows,
  type PermissionId,
  type PermissionLevel,
  type PermissionMap,
} from '../../shared/permissions';

interface PermissionState {
  levels: PermissionMap;
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  set: (id: PermissionId, level: PermissionLevel) => Promise<void>;
  revokeAll: () => Promise<void>;
}

/** Mirror of the main-process switches. The main process is the authority; this only displays them. */
export const usePermissions = create<PermissionState>((set) => ({
  levels: emptyPermissions(),
  loaded: false,
  error: null,

  async refresh() {
    try {
      const levels = await window.aios?.permissions.get();
      if (levels) set({ levels, loaded: true, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  async set(id, level) {
    try {
      const levels = await window.aios?.permissions.set(id, level);
      if (levels) set({ levels, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  async revokeAll() {
    try {
      const levels = await window.aios?.permissions.revokeAll();
      if (levels) set({ levels, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },
}));

export function hasPermission(id: PermissionId, needed: PermissionLevel = 'read'): boolean {
  return levelAllows(usePermissions.getState().levels[id], needed);
}
