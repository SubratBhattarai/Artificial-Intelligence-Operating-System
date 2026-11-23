import { useCallback, useRef } from 'react';
import { listShellApps } from '../apps/registry';
import { useWindows } from '../state/windowStore';
import { useUi } from '../state/uiStore';
import { JarvisOrb } from './JarvisOrb';

/** Everyday apps stay on the dock; the rest are one click away under "All apps" (or Ctrl+Space). */
const PINNED = ['files', 'notes', 'tasks', 'calendar', 'mail', 'agents', 'briefing', 'settings'];

const MAX_BOOST = 0.52;
const REACH_PX = 110;

/** A floating dock. Icons swell smoothly toward the pointer, like a lens passing over them. */
export function Dock() {
  const openApp = useWindows((state) => state.openApp);
  const windows = useWindows((state) => state.windows);
  const openJarvis = useUi((state) => state.openJarvis);
  const openLauncher = useUi((state) => state.openLauncher);
  const rowRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  const running = new Set(Object.values(windows).map((win) => win.appId));
  const all = listShellApps();
  const shown = [
    ...PINNED.map((id) => all.find((app) => app.id === id)).filter((app) => app !== undefined),
    ...all.filter((app) => !PINNED.includes(app.id) && running.has(app.id)),
  ];

  const magnify = useCallback((pointerX: number | null) => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const items = rowRef.current?.querySelectorAll<HTMLElement>('[data-dock-item]');
      items?.forEach((item) => {
        if (pointerX === null) {
          item.style.setProperty('--boost', '0');
          return;
        }
        const box = item.getBoundingClientRect();
        const distance = Math.abs(pointerX - (box.left + box.width / 2));
        const boost = MAX_BOOST * Math.exp(-((distance / REACH_PX) ** 2));
        item.style.setProperty('--boost', boost.toFixed(3));
      });
    });
  }, []);

  return (
    <nav className="aura-dock" aria-label="Dock">
      <div
        ref={rowRef}
        className="aura-dock-row"
        onPointerMove={(event) => magnify(event.clientX)}
        onPointerLeave={() => magnify(null)}
      >
        <button
          type="button"
          className="aura-dock-item"
          data-dock-item
          data-label="Search"
          aria-label="Search"
          onClick={openLauncher}
        >
          <span className="aura-dock-icon">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
          </span>
        </button>
        <span className="aura-dock-sep" />
        {shown.map((app) => (
          <button
            key={app.id}
            data-app-id={app.id}
            data-dock-item
            data-label={app.title}
            type="button"
            className={`aura-dock-item ${running.has(app.id) ? 'running' : ''}`}
            aria-label={`Open ${app.title}`}
            onClick={() => openApp(app.id, viewport())}
          >
            <span className="aura-dock-icon">{app.icon}</span>
            <span className="aura-dock-dot" />
          </button>
        ))}
        <button
          type="button"
          className="aura-dock-item"
          data-dock-item
          data-label="All apps"
          aria-label="All apps"
          onClick={openLauncher}
        >
          <span className="aura-dock-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              {[6, 12, 18].flatMap((x) =>
                [6, 12, 18].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />),
              )}
            </svg>
          </span>
        </button>
        <span className="aura-dock-sep" />
        <button
          type="button"
          className="aura-dock-item jarvis"
          data-dock-item
          data-label="JARVIS"
          aria-label="Open JARVIS"
          onClick={openJarvis}
        >
          <span className="aura-dock-icon">
            <JarvisOrb size={30} reactive />
          </span>
        </button>
      </div>
    </nav>
  );
}
