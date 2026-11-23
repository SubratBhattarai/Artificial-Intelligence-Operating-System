import { useEffect, useMemo, useRef, useState } from 'react';
import { listShellApps } from '../apps/registry';
import { useUi } from '../state/uiStore';
import { useWindows } from '../state/windowStore';

export function Launcher() {
  const open = useUi((state) => state.launcherOpen);
  const closeLauncher = useUi((state) => state.closeLauncher);
  const openApp = useWindows((state) => state.openApp);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const apps = listShellApps();
    if (!needle) return apps;
    return apps.filter((app) =>
      `${app.title} ${app.description} ${app.id}`.toLowerCase().includes(needle),
    );
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  const launch = (index: number) => {
    const app = results[index];
    if (!app) return;
    openApp(app.id, { width: window.innerWidth, height: window.innerHeight });
    closeLauncher();
  };

  return (
    <div className="overlay-backdrop" onMouseDown={closeLauncher}>
      <div
        className="launcher"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="App launcher"
      >
        <input
          ref={inputRef}
          className="launcher-input"
          placeholder="Search apps…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              launch(activeIndex);
            } else if (event.key === 'Escape') {
              closeLauncher();
            }
          }}
        />
        <ul className="launcher-list">
          {results.map((app, index) => (
            <li key={app.id}>
              <button
                type="button"
                className={`launcher-item ${index === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => launch(index)}
              >
                <span className="launcher-icon">{app.icon}</span>
                <span className="launcher-text">
                  <strong>{app.title}</strong>
                  <span className="muted">{app.description}</span>
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="launcher-empty muted">No apps match “{query}”.</li>
          )}
        </ul>
        <div className="launcher-footer muted">↑↓ navigate · Enter open · Esc close</div>
      </div>
    </div>
  );
}
