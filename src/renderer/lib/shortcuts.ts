import { useEffect } from 'react';
import type { ShellSnapshot } from '../../shared/protocol';
import { useUi } from '../state/uiStore';
import { useWindows } from '../state/windowStore';

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}

/**
 * Global keyboard navigation for the shell.
 * `globalSummonActive` is true when Electron registered the Alt+Space global shortcut —
 * in that case the local Alt+Space binding is skipped to avoid double-toggling.
 */
export function useShellShortcuts(globalSummonActive: boolean): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ui = useUi.getState();
      const winStore = useWindows.getState();
      const editable = isEditable(event.target);
      const hasFocus = Boolean(winStore.focusedId);

      // Summon JARVIS (local fallback when the global shortcut could not be registered).
      if (event.altKey && event.code === 'Space' && !globalSummonActive) {
        event.preventDefault();
        ui.toggleJarvis();
        return;
      }

      // Launcher.
      if (event.ctrlKey && !event.shiftKey && !event.altKey && event.code === 'Space') {
        event.preventDefault();
        ui.toggleLauncher();
        return;
      }

      if (event.key === 'Escape' && (ui.launcherOpen || ui.jarvisOpen)) {
        event.preventDefault();
        ui.closeOverlays();
        return;
      }

      // Window management combos are skipped while typing.
      if (editable || !event.ctrlKey || !event.shiftKey || event.altKey) return;
      if (!hasFocus) return;

      switch (event.code) {
        case 'ArrowRight':
          event.preventDefault();
          winStore.cycleFocus(1);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          winStore.cycleFocus(-1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          if (winStore.focusedId)
            winStore.toggleMaximize(winStore.focusedId, {
              width: window.innerWidth,
              height: window.innerHeight,
            });
          break;
        case 'ArrowDown':
          event.preventDefault();
          if (winStore.focusedId) winStore.minimizeWindow(winStore.focusedId);
          break;
        case 'KeyM':
          event.preventDefault();
          if (winStore.focusedId) winStore.minimizeWindow(winStore.focusedId);
          break;
        case 'KeyW':
          event.preventDefault();
          if (winStore.focusedId) winStore.closeWindow(winStore.focusedId);
          break;
        case 'KeyJ':
          event.preventDefault();
          ui.toggleJarvis();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [globalSummonActive]);
}

/** Keeps the main process informed about open windows for the read-only `app_status` tool. */
export function useShellStateReporting(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const push = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const state = useWindows.getState();
        const snapshot: ShellSnapshot = {
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
        window.aios?.reportShellState(snapshot);
      }, 250);
    };

    push();
    const unsubscribe = useWindows.subscribe(push);
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
