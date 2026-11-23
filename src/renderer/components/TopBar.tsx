import { useEffect, useState } from 'react';
import { useHealth } from '../lib/health';
import { useContextGrant } from '../state/contextStore';
import { useScreen } from '../state/screenStore';
import { useCamera } from '../state/cameraStore';
import { useUi } from '../state/uiStore';
import { useWake } from '../state/wakeStore';
import { useVoice } from '../state/voiceStore';
import { useWindows } from '../state/windowStore';
import { JarvisOrb } from './JarvisOrb';
import { formatClock, useFocus } from '../state/focusStore';
import { NotificationBell } from './NotificationBell';

function useMenuClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function TopBar() {
  const now = useMenuClock();
  const { health } = useHealth(15000);
  const openJarvis = useUi((state) => state.openJarvis);
  const focusedId = useWindows((state) => state.focusedId);
  const windows = useWindows((state) => state.windows);
  const focusedApp = focusedId ? windows[focusedId] : null;
  const micPhase = useVoice((state) => state.phase);
  const cancelVoice = useVoice((state) => state.cancel);
  const wakeStatus = useWake((state) => state.status);
  const disableWake = useWake((state) => state.disable);
  const screenReading = useScreen((state) => state.reading);
  const focusEnds = useFocus((state) => state.endsAt);
  const focusLeft = useFocus((state) => state.remaining);
  const stopFocus = useFocus((state) => state.stop);
  const cameraOn = useCamera((state) => state.status === 'on' || state.status === 'starting');
  const stopCamera = useCamera((state) => state.stop);
  const contextOn = useContextGrant((state) => state.windows);
  const setContext = useContextGrant((state) => state.setWindows);

  const statusClass = !health ? 'idle' : health.status === 'ok' ? 'ok' : 'warn';
  const statusText = !health
    ? 'checking…'
    : health.status === 'ok'
      ? 'JARVIS online'
      : 'JARVIS offline';

  return (
    <header className="top-bar menubar">
      <div className="top-left">
        <span className="brand">
          <span className="brand-mark" /> AI OS
        </span>
        <span className="top-sep" />
        <span className="active-app">{focusedApp ? focusedApp.title : 'Desktop'}</span>
      </div>

      <div className="top-right">
        {micPhase === 'recording' && (
          <button
            type="button"
            className="privacy-pill mic-live"
            onClick={cancelVoice}
            title="Microphone is recording — click to cancel"
          >
            <span className="dot" /> MIC LIVE
          </button>
        )}
        {wakeStatus !== 'off' && wakeStatus !== 'error' && (
          <button
            type="button"
            className="privacy-pill mic-live"
            onClick={disableWake}
            title="The microphone is on, listening for “Jarvis”. Click to turn it off."
          >
            <span className="dot" /> MIC ON · STOP
          </button>
        )}
        {focusEnds !== null && (
          <button
            type="button"
            className="privacy-pill focus"
            onClick={stopFocus}
            title="End focus mode"
          >
            FOCUS · {formatClock(focusLeft)}
          </button>
        )}
        <NotificationBell />
        {screenReading && (
          <span className="privacy-pill mic-live" title="AI OS is reading your screen right now.">
            <span className="dot" /> SCREEN · READING
          </span>
        )}
        {cameraOn && (
          <button
            type="button"
            className="privacy-pill mic-live"
            onClick={stopCamera}
            title="The camera is on. Click to turn it off."
          >
            <span className="dot" /> CAMERA ON · STOP
          </button>
        )}
        {contextOn && (
          <button
            type="button"
            className="privacy-pill context-on"
            onClick={() => void setContext(false)}
            title="JARVIS can see your open window titles this session — click to revoke"
          >
            <span className="dot" /> CONTEXT ON
          </button>
        )}
        <button
          type="button"
          className="jarvis-pill"
          onClick={openJarvis}
          title="Summon JARVIS (Alt+Space)"
        >
          <JarvisOrb size={20} reactive />
          JARVIS
        </button>
        <span
          className={`status-pill ${statusClass}`}
          title={health ? `Provider: ${health.provider.id}` : ''}
        >
          <span className="dot" />
          {statusText}
        </span>
        <span className="menubar-clock">
          {now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
          <b>{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b>
        </span>
      </div>
    </header>
  );
}
