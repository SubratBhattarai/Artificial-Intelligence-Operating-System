import { create } from 'zustand';

interface ScreenState {
  /** True only while a screenshot is being taken and read. */
  reading: boolean;
  setReading: (reading: boolean) => void;
}

export const useScreen = create<ScreenState>((set) => ({
  reading: false,
  setReading: (reading) => set({ reading }),
}));
