import type { ReactElement } from 'react';
import { useAmbient } from '../../state/ambientStore';
import { ZOOM_STEPS, useDisplay, type ThemePreference } from '../../state/displayStore';

const THEMES: Array<[ThemePreference, string]> = [
  ['dark', 'Dark'],
  ['light', 'Light'],
  ['system', 'Match Windows'],
];

export function DisplayPanel(): ReactElement {
  const { theme, zoom, setTheme, setZoom } = useDisplay();
  const ambient = useAmbient();
  return (
    <section className="card">
      <h3>Appearance</h3>
      <div className="perm-row">
        <div className="perm-text">
          <strong>Theme</strong>
          <span className="hint">
            Dark is the default. “Match Windows” follows your system setting.
          </span>
        </div>
        <div className="seg" role="radiogroup" aria-label="Theme">
          {THEMES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={theme === id}
              className={`seg-btn ${theme === id ? 'active' : ''}`}
              onClick={() => setTheme(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="perm-row">
        <div className="perm-text">
          <strong>Interface size</strong>
          <span className="hint">
            Scales everything — icons, windows and text — together. Pick a larger size on a big or
            high-resolution screen, a smaller one on a small laptop.
          </span>
        </div>
        <div className="seg" role="radiogroup" aria-label="Interface size">
          {ZOOM_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              role="radio"
              aria-checked={Math.abs(zoom - step) < 0.01}
              className={`seg-btn ${Math.abs(zoom - step) < 0.01 ? 'active' : ''}`}
              onClick={() => setZoom(step)}
            >
              {Math.round(step * 100)}%
            </button>
          ))}
        </div>
      </div>
      <div className="perm-row">
        <div className="perm-text">
          <strong>Ambient mode</strong>
          <span className="hint">
            The orb and desktop glow shift with what your computer is doing: busy, working agents,
            offline model, or a security alert. Based on simple rules, not the AI.
          </span>
        </div>
        <label>
          <input
            type="checkbox"
            checked={ambient.enabled}
            onChange={(e) => ambient.setEnabled(e.target.checked)}
          />{' '}
          On
        </label>
      </div>
    </section>
  );
}
