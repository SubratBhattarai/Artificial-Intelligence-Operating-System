import { useEffect, useState } from 'react';
import { listenForCaptureRequests } from './lib/cameraCapture';
import { SHELL_APPS } from './apps/registry';
import { CursorGlow } from './components/CursorGlow';
import { Dock } from './components/Dock';
import { Jarvis } from './components/Jarvis';
import { VoiceBackground } from './components/VoiceBackground';
import { VoiceHud } from './components/VoiceHud';
import { Launcher } from './components/Launcher';
import { NotificationToasts } from './components/NotificationBell';
import { TopBar } from './components/TopBar';
import { WindowLayer } from './components/WindowLayer';
import { useHealth } from './lib/health';
import { useShellShortcuts, useShellStateReporting } from './lib/shortcuts';
import { useContextGrant } from './state/contextStore';
import { usePermissions } from './state/permissionStore';
import { useWake } from './state/wakeStore';
import { useBriefing } from './state/briefingStore';
import { initTts } from './state/ttsStore';
import { initAmbient } from './state/ambientStore';
import { initAgents } from './state/agentStore';
import { initNotifications } from './state/notificationStore';
import { useScreen } from './state/screenStore';
import { useUi } from './state/uiStore';
import { useVoice } from './state/voiceStore';
import { useWindows } from './state/windowStore';

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

export default function App() {
  const { health } = useHealth(15000);
  const [booted, setBooted] = useState(false);

  useShellShortcuts(health?.summonShortcut.registered ?? false);
  useShellStateReporting();

  useEffect(() => {
    const store = useWindows.getState();
    store.hydrate(viewport());
    if (useWindows.getState().order.length === 0) {
      for (const app of SHELL_APPS) {
        if (app.defaultOpen) useWindows.getState().openApp(app.id, viewport());
      }
    }
    setBooted(true);
    void useVoice.getState().loadConfig();
    initAgents();
    initAmbient();
    initTts();
    // Once a day at launch: open the briefing and read it (only if the user left that on).
    void window.aios?.briefing.launchDue().then((due) => {
      if (!due) return;
      useWindows.getState().openApp('briefing', viewport());
      void useBriefing.getState().readAloud();
    });
    initNotifications();
    void useContextGrant.getState().refresh();
    // Permissions first, then "Jarvis" listening resumes only if the user left it on and it is still allowed.
    void usePermissions
      .getState()
      .refresh()
      .then(() => useWake.getState().resume());

    const unsubscribe = window.aios?.onSummon(() => useUi.getState().toggleJarvis());
    const unsubscribeScreen = window.aios?.onScreenActivity((active) =>
      useScreen.getState().setReading(active),
    );
    const unsubscribeCapture = listenForCaptureRequests();
    const unsubscribeOpen = window.aios?.awareness.onOpenApp((appId) => {
      if (SHELL_APPS.some((app) => app.id === appId))
        useWindows
          .getState()
          .openApp(appId, { width: window.innerWidth, height: window.innerHeight });
    });
    const onResize = () => {
      // Re-clamp everything when the screen size changes (safe, storage-agnostic).
      const state = useWindows.getState();
      for (const id of state.order) state.setBounds(id, {}, viewport());
    };
    window.addEventListener('resize', onResize);

    // Subtle parallax: only the wallpaper layers react, throttled to one update per frame.
    const wallpaper = document.querySelector<HTMLElement>('.wallpaper');
    let parallaxFrame = 0;
    const onPointerMove = (event: PointerEvent) => {
      if (!wallpaper || parallaxFrame) return;
      parallaxFrame = requestAnimationFrame(() => {
        parallaxFrame = 0;
        wallpaper.style.setProperty('--px', (event.clientX / window.innerWidth - 0.5).toFixed(3));
        wallpaper.style.setProperty('--py', (event.clientY / window.innerHeight - 0.5).toFixed(3));
      });
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      if (parallaxFrame) cancelAnimationFrame(parallaxFrame);
      unsubscribe?.();
      unsubscribeScreen?.();
      unsubscribeCapture?.();
      unsubscribeOpen?.();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div className={`desktop ${booted ? 'booted' : ''}`}>
      <div className="wallpaper" aria-hidden="true" />
      <VoiceBackground />
      <TopBar />
      <WindowLayer />
      <Dock />
      <Launcher />
      <VoiceHud />
      <NotificationToasts />
      <Jarvis />
      <CursorGlow />
      <div className="hint-bar">
        Say “Jarvis” · Alt+Space panel · Ctrl+Space launcher · Ctrl+Shift+←/→ cycle windows
      </div>
    </div>
  );
}
