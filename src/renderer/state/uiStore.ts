import { create } from 'zustand';

interface UiState {
  launcherOpen: boolean;
  jarvisOpen: boolean;
  openLauncher: () => void;
  closeLauncher: () => void;
  toggleLauncher: () => void;
  openJarvis: () => void;
  closeJarvis: () => void;
  toggleJarvis: () => void;
  closeOverlays: () => void;
}

export const useUi = create<UiState>((set, get) => ({
  launcherOpen: false,
  jarvisOpen: false,
  openLauncher: () => set({ launcherOpen: true }),
  closeLauncher: () => set({ launcherOpen: false }),
  toggleLauncher: () => set({ launcherOpen: !get().launcherOpen }),
  openJarvis: () => set({ jarvisOpen: true }),
  closeJarvis: () => set({ jarvisOpen: false }),
  toggleJarvis: () => set({ jarvisOpen: !get().jarvisOpen }),
  closeOverlays: () => set({ launcherOpen: false, jarvisOpen: false }),
}));
