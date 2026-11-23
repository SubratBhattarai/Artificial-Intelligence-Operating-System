import { create } from 'zustand';
import {
  AMBIENT_PALETTES,
  CALM_PALETTE,
  ambientFor,
  easePalette,
  type AmbientName,
} from '../lib/ambient';
import { useAgents } from './agentStore';
import { useNotifications } from './notificationStore';

const KEY = 'aios.ambient.v1';

interface AmbientState {
  enabled: boolean;
  name: AmbientName;
  setEnabled: (enabled: boolean) => void;
}

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export const useAmbient = create<AmbientState>((set) => ({
  enabled: loadEnabled(),
  name: 'calm',
  setEnabled(enabled) {
    try {
      localStorage.setItem(KEY, enabled ? 'on' : 'off');
    } catch {
      // best effort
    }
    set({ enabled });
  },
}));

let started = false;
let cpu: number | null = null;
let modelOffline = false;

/** Sample load and model reachability every few seconds, and glide the orb colours toward the result. */
export function initAmbient(): void {
  if (started || !window.aios) return;
  started = true;
  const api = window.aios;
  const sample = () => {
    void api
      .getMetrics()
      .then((m) => {
        cpu = m.cpu;
      })
      .catch(() => {
        cpu = null;
      });
    void api
      .getHealth()
      .then((h) => {
        modelOffline = h.provider.reachable === false;
      })
      .catch(() => undefined);
  };
  sample();
  window.setInterval(sample, 6000);
  window.setInterval(() => {
    const { enabled } = useAmbient.getState();
    const name = enabled
      ? ambientFor({
          cpu,
          modelOffline,
          securityAlert: useNotifications
            .getState()
            .items.some(
              (item) => item.source === 'security' && item.importance === 'urgent' && !item.read,
            ),
          agentsRunning: useAgents
            .getState()
            .agents.filter((a) => a.status === 'running' || a.status === 'waiting_approval').length,
        })
      : 'calm';
    if (name !== useAmbient.getState().name) {
      useAmbient.setState({ name });
      document.documentElement.dataset.ambient = name;
    }
    easePalette(enabled ? AMBIENT_PALETTES[name] : CALM_PALETTE);
  }, 120);
}
