import { create } from 'zustand';

interface ContextState {
  /** JARVIS may see the open-window list. Session-scoped: always off after a restart. */
  windows: boolean;
  grantedAt: number | null;
  refresh: () => Promise<void>;
  setWindows: (allowed: boolean) => Promise<void>;
}

export const useContextGrant = create<ContextState>((set) => ({
  windows: false,
  grantedAt: null,

  async refresh() {
    try {
      const grant = await window.aios?.context.get();
      if (grant) set({ windows: grant.windows, grantedAt: grant.grantedAt });
    } catch {
      // keep the last known state
    }
  },

  async setWindows(allowed: boolean) {
    try {
      const grant = await window.aios?.context.set({ windows: allowed });
      if (grant) set({ windows: grant.windows, grantedAt: grant.grantedAt });
    } catch {
      // the grant did not change
    }
  },
}));
