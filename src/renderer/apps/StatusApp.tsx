import type { ReactElement } from 'react';
import { useHealth } from '../lib/health';
import type { ShellAppProps } from './types';

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function StatusApp(_props: ShellAppProps): ReactElement {
  const { health, refresh } = useHealth(8000);

  const statusLabel = !health
    ? 'Checking…'
    : health.status === 'ok'
      ? 'All systems nominal'
      : 'Degraded — model unreachable';

  return (
    <div className="app-pad">
      <div className="status-hero">
        <span
          className={`status-orb ${health?.status === 'ok' ? 'ok' : health ? 'warn' : 'idle'}`}
        />
        <div>
          <h2>{statusLabel}</h2>
          <p className="muted">
            {health
              ? `AI OS v${health.appVersion} · ${health.platform} · up ${formatUptime(health.uptimeMs)}`
              : 'Awaiting main-process health report…'}
          </p>
        </div>
        <button className="btn" onClick={refresh} type="button">
          Refresh
        </button>
      </div>

      <div className="card-grid">
        <section className="card">
          <h3>Assistant</h3>
          <dl className="kv">
            <dt>Configured</dt>
            <dd>{health ? (health.provider.configured ? 'yes' : 'no') : '—'}</dd>
            <dt>Reachable</dt>
            <dd>
              {health?.provider.reachable == null
                ? 'unknown'
                : health.provider.reachable
                  ? 'yes'
                  : 'no'}
            </dd>
          </dl>
          <p className="hint">
            The assistant runs privately on this computer. Nothing is sent online unless you ask
            JARVIS to open a web page and approve it.
          </p>
        </section>

        <section className="card">
          <h3>Registered tools</h3>
          <ul className="chip-list">
            {(health?.tools ?? []).map((tool) => (
              <li key={tool} className="chip">
                {tool}
              </li>
            ))}
            {health && health.tools.length === 0 && <li className="muted">none</li>}
          </ul>
          <p className="hint">
            Read-only tools exposed to JARVIS through the typed tool interface.
          </p>
        </section>

        <section className="card">
          <h3>Summon shortcut</h3>
          <p className="mono">
            {health?.summonShortcut.accelerator ?? 'Alt+Space'}
            <span className={`pill ${health?.summonShortcut.registered ? 'ok' : 'warn'}`}>
              {health?.summonShortcut.registered ? 'global' : 'in-app only'}
            </span>
          </p>
          <p className="hint">Works app-wide even when AI OS is not focused (global shortcut).</p>
        </section>
      </div>
    </div>
  );
}
