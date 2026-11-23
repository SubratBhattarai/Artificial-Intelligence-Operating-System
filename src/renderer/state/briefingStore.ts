import { create } from 'zustand';
import type { Briefing, BriefingSettings } from '../../shared/briefing';
import { errorText } from '../lib/format';
import { BRIEFING_COMMAND } from './briefingCommand';
import { useVoice } from './voiceStore';

interface BriefingState {
  briefing: Briefing | null;
  loading: boolean;
  error: string | null;
  settings: BriefingSettings | null;
  load: () => Promise<Briefing | null>;
  /** Build a fresh briefing and read it aloud, section by section. */
  readAloud: () => Promise<Briefing | null>;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: BriefingSettings) => Promise<void>;
}

export { BRIEFING_COMMAND };

export function briefingToText(briefing: Briefing): string {
  return briefing.spoken.join('\n\n');
}

export const useBriefing = create<BriefingState>((set, get) => ({
  briefing: null,
  loading: false,
  error: null,
  settings: null,
  async load() {
    const api = window.aios;
    if (!api || get().loading) return get().briefing;
    set({ loading: true, error: null });
    try {
      const briefing = await api.briefing.get();
      set({ briefing, loading: false });
      return briefing;
    } catch (error) {
      set({ loading: false, error: errorText(error) });
      return null;
    }
  },
  async readAloud() {
    const briefing = await get().load();
    if (briefing) useVoice.getState().speak(briefingToText(briefing));
    return briefing;
  },
  async loadSettings() {
    const settings = await window.aios?.briefing.settings();
    if (settings) set({ settings });
  },
  async saveSettings(settings) {
    const saved = await window.aios?.briefing.saveSettings(settings);
    if (saved) set({ settings: saved });
  },
}));
