import { create } from 'zustand';
import type { TtsStatus } from '../../shared/tts';

interface TtsState {
  status: TtsStatus | null;
  refresh: () => Promise<void>;
}

export const useTts = create<TtsState>((set) => ({
  status: null,
  async refresh() {
    const status = await window.aios?.tts.status();
    if (status) set({ status });
  },
}));

let started = false;
export function initTts(): void {
  if (started || !window.aios) return;
  started = true;
  void useTts.getState().refresh();
  window.aios.tts.onStatus((status) => useTts.setState({ status }));
}
