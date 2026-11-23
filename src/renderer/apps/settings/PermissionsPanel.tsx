import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { PERMISSIONS, type PermissionLevel } from '../../../shared/permissions';
import { ConfirmButton } from '../../components/ConfirmButton';
import type { ApprovedApp } from '../../../shared/platform';
import { usePermissions } from '../../state/permissionStore';

const LEVEL_LABEL: Record<PermissionLevel, string> = {
  off: 'Off',
  read: 'Read only',
  write: 'Read & propose',
};
const HARDWARE_LABEL: Record<PermissionLevel, string> = { off: 'Off', read: 'On', write: 'On' };

/** Every switch starts off. Changes here take effect immediately and are enforced in app code, not by the AI. */
export function PermissionsPanel(): ReactElement {
  const { levels, loaded, error, refresh, set, revokeAll } = usePermissions();
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const [apps, setApps] = useState<ApprovedApp[]>([]);
  const loadApps = useCallback(async () => {
    const list = await window.aios?.approvedApps.list();
    if (list) setApps(list);
  }, []);
  useEffect(() => {
    void loadApps();
  }, [loadApps]);

  const hardware = PERMISSIONS.filter((entry) => entry.kind === 'hardware');
  const data = PERMISSIONS.filter((entry) => entry.kind === 'data');

  const row = (entry: (typeof PERMISSIONS)[number]) => {
    const current = levels[entry.id];
    return (
      <div key={entry.id} className="perm-row">
        <div className="perm-text">
          <strong>{entry.label}</strong>
          <span className="hint">{entry.description}</span>
        </div>
        <div className="seg" role="radiogroup" aria-label={entry.label}>
          {entry.levels.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={current === level}
              className={`seg-btn ${current === level ? 'active' : ''}`}
              onClick={() => void set(entry.id, level)}
            >
              {entry.kind === 'hardware' ? HARDWARE_LABEL[level] : LEVEL_LABEL[level]}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      {error && <div className="banner error">{error}</div>}
      <section className="card">
        <h3>Devices</h3>
        <p className="hint">
          Turning one on lets AI OS ask Windows for it; an indicator in the top bar shows whenever
          it is live, and clicking the indicator stops it at once.
        </p>
        {loaded && hardware.map(row)}
      </section>
      <section className="card">
        <h3>What JARVIS can use</h3>
        <p className="hint">
          “Read only” lets JARVIS look. “Read &amp; propose” also lets it suggest changes — every
          change still shows a preview and waits for your approval. The apps themselves always work
          for you, whatever is set here.
        </p>
        {loaded && data.map(row)}
        <h4>Apps JARVIS may open or close</h4>
        <p className="hint">
          Only programs on this list. Add one with the file picker; you still approve each open or
          close. File Explorer can be opened but never closed.
        </p>
        <ul className="chip-list">
          {apps.map((app) => (
            <li key={app.id} className="chip">
              {app.name}
              {!app.builtin && (
                <button
                  type="button"
                  className="chip-x"
                  aria-label={`Remove ${app.name}`}
                  onClick={() => void window.aios?.approvedApps.remove(app.id).then(setApps)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={() => void window.aios?.approvedApps.add().then(setApps)}
          >
            Add a program…
          </button>
        </div>
        <div className="row">
          <ConfirmButton
            label="Turn everything off"
            confirmLabel="Yes, turn all off"
            onConfirm={() => void revokeAll()}
          />
        </div>
      </section>
    </>
  );
}
