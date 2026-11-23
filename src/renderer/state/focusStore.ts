import { create } from 'zustand';
import { useVoice } from './voiceStore';

interface FocusState {
  /** Epoch ms when the session ends, or null. */
  endsAt: number | null;
  minutes: number;
  /** Seconds left, updated each second while running. */
  remaining: number;
  start: (minutes: number) => void;
  stop: () => void;
}

let timer: ReturnType<typeof setInterval> | null = null;
let halfwayDone = false;

function clear(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export const useFocus = create<FocusState>((set, get) => ({
  endsAt: null,
  minutes: 25,
  remaining: 0,
  start(minutes) {
    clear();
    halfwayDone = false;
    const total = Math.min(180, Math.max(1, Math.round(minutes)));
    const endsAt = Date.now() + total * 60_000;
    set({ endsAt, minutes: total, remaining: total * 60 });
    useVoice.getState().speak(`Focus mode on for ${total} minutes. I will stay quiet until then.`);
    timer = setInterval(() => {
      const left = Math.max(0, Math.round(((get().endsAt ?? 0) - Date.now()) / 1000));
      set({ remaining: left });
      if (!halfwayDone && total >= 20 && left <= (total * 60) / 2) {
        halfwayDone = true;
        useVoice.getState().speak('Halfway there. Keep going.');
      }
      if (left <= 0) {
        clear();
        set({ endsAt: null });
        useVoice
          .getState()
          .speak(`Your ${total} minute focus session is complete. Take a short break.`);
      }
    }, 1000);
  },
  stop() {
    clear();
    if (get().endsAt) useVoice.getState().speak('Focus mode ended.');
    set({ endsAt: null, remaining: 0 });
  },
}));

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
