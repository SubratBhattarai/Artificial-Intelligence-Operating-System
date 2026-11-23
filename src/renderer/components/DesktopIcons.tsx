import { useState } from 'react';
import { listShellApps } from '../apps/registry';
import { useWindows } from '../state/windowStore';

export function DesktopIcons() {
  const openApp = useWindows((state) => state.openApp);
  const [selected, setSelected] = useState<string | null>(null);

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  return (
    <div className="desktop-icons" role="list">
      {listShellApps().map((app) => (
        <button
          key={app.id}
          type="button"
          role="listitem"
          className={`desktop-icon ${selected === app.id ? 'selected' : ''}`}
          onClick={() => setSelected(app.id)}
          onDoubleClick={() => openApp(app.id, viewport())}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openApp(app.id, viewport());
            }
          }}
          aria-label={`Open ${app.title}`}
        >
          <span className="desktop-icon-glyph">{app.icon}</span>
          <span className="desktop-icon-label">{app.title}</span>
        </button>
      ))}
    </div>
  );
}
