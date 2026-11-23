import { create } from 'zustand';

export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const KEY = 'aios.display.v1';
export const ZOOM_STEPS = [0.85, 0.9, 1, 1.1, 1.25, 1.4] as const;

interface DisplayState {
  theme: ThemePreference;
  resolved: ResolvedTheme;
  /** Whole-interface scale. */
  zoom: number;
  setTheme: (theme: ThemePreference) => void;
  setZoom: (zoom: number) => void;
}

function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

function resolve(theme: ThemePreference): ResolvedTheme {
  return theme === 'system' ? systemTheme() : theme;
}

const REDESIGN_FLAG = 'aios.display.aura.v1';

function load(): { theme: ThemePreference; zoom: number } {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as {
      theme?: unknown;
      zoom?: unknown;
    };
    let theme: ThemePreference =
      parsed.theme === 'dark' || parsed.theme === 'system' ? parsed.theme : 'light';
    // The redesign opens in the new light theme once; the person can switch back in Settings.
    if (localStorage.getItem(REDESIGN_FLAG) !== '1') {
      localStorage.setItem(REDESIGN_FLAG, '1');
      theme = 'light';
    }
    const zoom =
      typeof parsed.zoom === 'number' && parsed.zoom >= 0.8 && parsed.zoom <= 1.5 ? parsed.zoom : 1;
    return { theme, zoom };
  } catch {
    return { theme: 'light', zoom: 1 };
  }
}

function persist(theme: ThemePreference, zoom: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ theme, zoom }));
  } catch {
    // preferences are best-effort
  }
}

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

const initial = load();

export const useDisplay = create<DisplayState>((set, get) => ({
  theme: initial.theme,
  resolved: resolve(initial.theme),
  zoom: initial.zoom,

  setTheme(theme) {
    const resolved = resolve(theme);
    applyTheme(resolved);
    set({ theme, resolved });
    persist(theme, get().zoom);
  },

  setZoom(zoom) {
    window.aios?.display.setZoom(zoom);
    set({ zoom });
    persist(get().theme, zoom);
  },
}));

/** Apply the saved theme and scale before the first paint, and follow the OS when set to "system". */
export function initDisplay(): void {
  const { theme, zoom } = useDisplay.getState();
  applyTheme(resolve(theme));
  if (zoom !== 1) window.aios?.display.setZoom(zoom);
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (useDisplay.getState().theme !== 'system') return;
    const resolved = systemTheme();
    applyTheme(resolved);
    useDisplay.setState({ resolved });
  });
}
