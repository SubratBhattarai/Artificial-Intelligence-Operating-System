import { useEffect, useRef } from 'react';
import { playGenie } from '../lib/genie';
import { getShellApp } from '../apps/registry';
import { resizeBounds, type Bounds, type ResizeDirection, type Viewport } from '../lib/layout';
import { useWindows, type WindowInstance } from '../state/windowStore';

const HANDLES: ResizeDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const viewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });

interface DragState {
  mode: 'move' | 'resize';
  direction?: ResizeDirection;
  startX: number;
  startY: number;
  origin: Bounds;
}

export function WindowFrame({
  win,
  active,
  zIndex,
}: {
  win: WindowInstance;
  active: boolean;
  zIndex: number;
}) {
  const focusWindow = useWindows((state) => state.focusWindow);
  const closeWindow = useWindows((state) => state.closeWindow);
  const minimizeWindow = useWindows((state) => state.minimizeWindow);
  const toggleMaximize = useWindows((state) => state.toggleMaximize);
  const setBounds = useWindows((state) => state.setBounds);
  const dragRef = useRef<DragState | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const exiting = useWindows((state) => state.exiting[win.id]);
  const smooth = useWindows((state) => state.smoothId === win.id);
  const restoring = useWindows((state) => state.restoring[win.id] === true);

  // Genie: pinch into the window's dock icon on minimize, grow back out of it on restore.
  useEffect(() => {
    const element = frameRef.current;
    if (!element || (exiting !== 'minimize' && !restoring)) return;
    const icon = document.querySelector(`[data-app-id="${CSS.escape(win.appId)}"]`);
    const animation = playGenie(element, icon, exiting === 'minimize');
    return () => animation?.cancel();
  }, [exiting, restoring, win.appId]);

  const app = getShellApp(win.appId);

  const beginDrag = (
    event: React.PointerEvent,
    mode: 'move' | 'resize',
    direction?: ResizeDirection,
  ) => {
    if (event.button !== 0) return;
    // Pointer capture would redirect the click away from the control buttons.
    if ((event.target as HTMLElement).closest('.window-controls')) return;
    if (win.state === 'maximized' && mode === 'move') return;
    event.preventDefault();
    event.stopPropagation();
    focusWindow(win.id);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      mode,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: win.x, y: win.y, width: win.width, height: win.height },
    };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const vp = viewport();
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (drag.mode === 'move') {
      setBounds(win.id, { x: drag.origin.x + dx, y: drag.origin.y + dy }, vp);
    } else if (drag.direction) {
      setBounds(win.id, resizeBounds(drag.origin, drag.direction, dx, dy, vp, win.minSize), vp);
    }
  };

  const endDrag = (event: React.PointerEvent) => {
    if (dragRef.current) {
      const target = event.currentTarget as HTMLElement;
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  const style = {
    left: win.x,
    top: win.y,
    width: win.width,
    height: win.height,
    zIndex,
    // Where the minimize animation flies to: the dock, bottom centre of the screen.
    '--dock-dx': `${window.innerWidth / 2 - (win.x + win.width / 2)}px`,
    '--dock-dy': `${window.innerHeight - (win.y + win.height / 2)}px`,
  } as React.CSSProperties;
  const frameClass = [
    'window',
    active ? 'active' : '',
    win.state === 'maximized' ? 'maximized' : '',
    smooth ? 'smooth' : '',
    restoring ? 'restoring' : '',
    exiting ? `exiting-${exiting}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={frameRef}
      className={frameClass}
      style={style}
      onPointerDownCapture={() => focusWindow(win.id)}
      role="dialog"
      aria-label={win.title}
    >
      <div
        className="titlebar"
        onPointerDown={(event) => beginDrag(event, 'move')}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => toggleMaximize(win.id, viewport())}
      >
        <span className="titlebar-icon">{app?.icon}</span>
        <span className="titlebar-title">{win.title}</span>
        <div className="window-controls">
          <button
            type="button"
            className="wc"
            aria-label="Minimize"
            onClick={(event) => {
              event.stopPropagation();
              minimizeWindow(win.id);
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
          <button
            type="button"
            className="wc"
            aria-label={win.state === 'maximized' ? 'Restore' : 'Maximize'}
            onClick={(event) => {
              event.stopPropagation();
              toggleMaximize(win.id, viewport());
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect
                x="1.5"
                y="1.5"
                width="7"
                height="7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
          </button>
          <button
            type="button"
            className="wc close"
            aria-label="Close"
            onClick={(event) => {
              event.stopPropagation();
              closeWindow(win.id);
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1.4" />
              <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        </div>
      </div>

      <div className="window-body">
        {app ? <app.Component windowId={win.id} appId={win.appId} active={active} /> : null}
      </div>

      {win.state !== 'maximized' &&
        HANDLES.map((direction) => (
          <div
            key={direction}
            className={`resize-handle ${direction}`}
            onPointerDown={(event) => beginDrag(event, 'resize', direction)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        ))}
    </div>
  );
}
