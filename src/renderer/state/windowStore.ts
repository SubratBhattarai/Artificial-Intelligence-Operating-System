import { create } from 'zustand';
import { getShellApp, listShellApps } from '../apps/registry';
import {
  LAYOUT_STORAGE_KEY,
  LAYOUT_VERSION,
  centerBounds,
  clampPosition,
  clampSize,
  isFiniteNumber,
  maximizedBounds,
  sanitizePersistedLayout,
  type Bounds,
  type Viewport,
} from '../lib/layout';

/** How long close/minimize animations run before the window is actually removed/hidden. */
export const EXIT_ANIMATION_MS = 260;
/** The minimize genie is longer than a close fade. */
export const MINIMIZE_ANIMATION_MS = 540;
/** How long bounds transitions stay enabled after a maximize/restore. */
export const SMOOTH_BOUNDS_MS = 560;
/** Genie restore from the dock. */
export const RESTORE_ANIMATION_MS = 520;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

export type WindowStateKind = 'normal' | 'minimized' | 'maximized';

export interface WindowInstance extends Bounds {
  id: string;
  appId: string;
  title: string;
  state: WindowStateKind;
  minSize: { width: number; height: number };
  /** Bounds to return to when leaving the maximized state. */
  restoreBounds?: Bounds;
}

interface WindowStoreState {
  windows: Record<string, WindowInstance>;
  /** Z-order, back to front. Last entry is focused. */
  order: string[];
  focusedId: string | null;
  hydrated: boolean;
  /** Windows currently playing their close/minimize animation. */
  exiting: Record<string, 'close' | 'minimize'>;
  /** The window whose bounds should animate (maximize/restore). */
  smoothId: string | null;
  /** Windows currently flying back out of the dock (restore animation). */
  restoring: Record<string, true>;

  hydrate: (viewport: Viewport) => void;
  openApp: (appId: string, viewport: Viewport) => void;
  closeWindow: (id: string) => void;
  /** Applies a pending close/minimize once its animation has finished. */
  finalizeExit: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string, viewport: Viewport) => void;
  setBounds: (id: string, next: Partial<Bounds>, viewport: Viewport) => void;
  cycleFocus: (step: 1 | -1) => void;
}

function uid(): string {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function visibleWindows(order: string[], windows: Record<string, WindowInstance>): string[] {
  return order.filter((id) => windows[id] && windows[id].state !== 'minimized');
}

function focusTopmost(state: WindowStoreState): Partial<WindowStoreState> {
  const visible = visibleWindows(state.order, state.windows);
  const next = visible[visible.length - 1] ?? null;
  return { focusedId: next };
}

export const useWindows = create<WindowStoreState>((set, get) => ({
  windows: {},
  order: [],
  focusedId: null,
  hydrated: false,
  exiting: {},
  smoothId: null,
  restoring: {},

  hydrate(viewport) {
    if (get().hydrated) return;
    const validAppIds = listShellApps().map((app) => app.id);
    let parsed: unknown = null;
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const entries = sanitizePersistedLayout(parsed, viewport, validAppIds);

    const windows: Record<string, WindowInstance> = {};
    const order: string[] = [];
    for (const entry of entries) {
      const app = getShellApp(entry.appId);
      if (!app) continue;
      const id = uid();
      windows[id] = {
        id,
        appId: app.id,
        title: app.title,
        state: entry.state,
        ...entry.bounds,
        minSize: app.minSize ?? { width: 320, height: 200 },
        restoreBounds: entry.state === 'maximized' ? entry.bounds : undefined,
      };
      order.push(id);
    }
    set({ windows, order, focusedId: order[order.length - 1] ?? null, hydrated: true });
  },

  openApp(appId, viewport) {
    const trace = ((window as unknown as { __openTrace?: unknown[] }).__openTrace ??= []);
    trace.push({
      appId,
      at: Date.now(),
      stack: new Error().stack?.split('\n').slice(1, 6).join(' | '),
    });
    if (trace.length > 40) trace.shift();
    const app = getShellApp(appId);
    if (!app) return;
    const state = get();
    const singleton = app.singleton !== false;

    const existingId = state.order.find((id) => state.windows[id]?.appId === appId);
    if (singleton && existingId) {
      const existing = state.windows[existingId];
      const wasMinimized = existing.state === 'minimized';
      const windows = wasMinimized
        ? { ...state.windows, [existingId]: { ...existing, state: 'normal' as const } }
        : state.windows;
      if (wasMinimized && !prefersReducedMotion()) {
        set({ restoring: { ...state.restoring, [existingId]: true } });
        setTimeout(() => {
          const rest = { ...get().restoring };
          delete rest[existingId];
          set({ restoring: rest });
        }, RESTORE_ANIMATION_MS);
      }
      set({
        windows,
        order: [...state.order.filter((entry) => entry !== existingId), existingId],
        focusedId: existingId,
      });
      return;
    }

    const id = uid();
    const cascade = visibleWindows(state.order, state.windows).length % 8;
    const bounds = centerBounds(
      { width: app.defaultSize.width, height: app.defaultSize.height },
      viewport,
      cascade,
    );
    set({
      windows: {
        ...state.windows,
        [id]: {
          id,
          appId: app.id,
          title: app.title,
          state: 'normal',
          ...bounds,
          minSize: app.minSize ?? { width: 320, height: 200 },
        },
      },
      order: [...state.order, id],
      focusedId: id,
    });
  },

  closeWindow(id) {
    const state = get();
    const target = state.windows[id];
    if (!target || state.exiting[id]) return;
    if (target.state === 'minimized' || prefersReducedMotion()) {
      set({ exiting: { ...state.exiting, [id]: 'close' } });
      get().finalizeExit(id);
      return;
    }
    set({ exiting: { ...state.exiting, [id]: 'close' } });
    setTimeout(() => get().finalizeExit(id), EXIT_ANIMATION_MS);
  },

  finalizeExit(id) {
    const state = get();
    const kind = state.exiting[id];
    const target = state.windows[id];
    const exiting = { ...state.exiting };
    delete exiting[id];
    if (!kind || !target) {
      set({ exiting });
      return;
    }
    if (kind === 'close') {
      const windows = { ...state.windows };
      delete windows[id];
      const order = state.order.filter((entry) => entry !== id);
      const visible = visibleWindows(order, windows);
      set({ windows, order, exiting, focusedId: visible[visible.length - 1] ?? null });
      return;
    }
    const windows = { ...state.windows, [id]: { ...target, state: 'minimized' as const } };
    set({ windows, exiting, ...focusTopmost({ ...state, windows }) });
  },

  focusWindow(id) {
    const state = get();
    if (!state.windows[id] || state.windows[id].state === 'minimized') return;
    if (state.focusedId === id && state.order[state.order.length - 1] === id) return;
    set({
      order: [...state.order.filter((entry) => entry !== id), id],
      focusedId: id,
    });
  },

  minimizeWindow(id) {
    const state = get();
    const target = state.windows[id];
    if (!target || target.state === 'minimized' || state.exiting[id]) return;
    set({ exiting: { ...state.exiting, [id]: 'minimize' } });
    if (prefersReducedMotion()) {
      get().finalizeExit(id);
      return;
    }
    setTimeout(() => get().finalizeExit(id), MINIMIZE_ANIMATION_MS);
  },

  toggleMaximize(id, viewport) {
    const state = get();
    const target = state.windows[id];
    if (!target) return;
    if (!prefersReducedMotion()) {
      set({ smoothId: id });
      setTimeout(() => {
        if (get().smoothId === id) set({ smoothId: null });
      }, SMOOTH_BOUNDS_MS);
    }
    if (target.state === 'maximized') {
      set({
        windows: {
          ...state.windows,
          [id]: {
            ...target,
            state: 'normal',
            ...(target.restoreBounds ?? {}),
          },
        },
      });
    } else {
      set({
        windows: {
          ...state.windows,
          [id]: {
            ...target,
            state: 'maximized',
            restoreBounds: { x: target.x, y: target.y, width: target.width, height: target.height },
            ...maximizedBounds(viewport),
          },
        },
      });
    }
  },

  setBounds(id, next, viewport) {
    const state = get();
    const target = state.windows[id];
    if (!target || target.state === 'maximized' || target.state === 'minimized') return;
    const merged: Bounds = {
      x: isFiniteNumber(next.x) ? next.x : target.x,
      y: isFiniteNumber(next.y) ? next.y : target.y,
      width: isFiniteNumber(next.width) ? next.width : target.width,
      height: isFiniteNumber(next.height) ? next.height : target.height,
    };
    const size = clampSize(merged, viewport);
    const position = clampPosition({ ...size, x: merged.x, y: merged.y }, viewport);
    set({
      windows: {
        ...state.windows,
        [id]: { ...target, ...size, ...position },
      },
    });
  },

  cycleFocus(step) {
    const state = get();
    const visible = visibleWindows(state.order, state.windows);
    if (visible.length < 2) return;
    const currentIndex = state.focusedId ? visible.indexOf(state.focusedId) : visible.length - 1;
    const from = currentIndex < 0 ? visible.length - 1 : currentIndex;
    const nextIndex = (from + step + visible.length) % visible.length;
    const nextId = visible[nextIndex];
    set({
      order: [...state.order.filter((entry) => entry !== nextId), nextId],
      focusedId: nextId,
    });
  },
}));

/* --------- safe persistence: debounced write, validated read (see sanitizePersistedLayout) --------- */

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist(state: WindowStoreState): void {
  if (!state.hydrated) return;
  const windows = Object.values(state.windows)
    .filter((win) => win.state !== 'minimized')
    .map((win) => ({
      appId: win.appId,
      state: win.state === 'maximized' ? ('maximized' as const) : ('normal' as const),
      bounds:
        win.state === 'maximized' && win.restoreBounds
          ? win.restoreBounds
          : { x: win.x, y: win.y, width: win.width, height: win.height },
    }));
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ version: LAYOUT_VERSION, windows }));
  } catch {
    // Quota/serialization failures must never break the shell.
  }
}

useWindows.subscribe((state, previous) => {
  if (!state.hydrated) return;
  const layoutChanged = state.windows !== previous.windows || state.order !== previous.order;
  if (!layoutChanged) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(useWindows.getState()), 400);
});

/** Serialize the shell snapshot consumed by the read-only `app_status` tool. */
export function buildShellSnapshot() {
  const state = useWindows.getState();
  return {
    windows: state.order.map((id) => {
      const win = state.windows[id];
      return {
        id: win.id,
        appId: win.appId,
        title: win.title,
        state: win.state,
        focused: win.id === state.focusedId,
      };
    }),
    activeAppId: state.focusedId ? (state.windows[state.focusedId]?.appId ?? null) : null,
    updatedAt: Date.now(),
  };
}

export function resetLayout(): void {
  try {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
  } catch {
    // ignore
  }
}
