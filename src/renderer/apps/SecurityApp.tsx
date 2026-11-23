import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { SecurityReport } from '../../shared/security';
import { errorText, formatDateTime } from '../lib/format';
import { usePermissions } from '../state/permissionStore';
import { Banners } from './appKit';

const LEVEL_TEXT = { high: 'Needs attention', medium: 'Worth a look', info: 'FYI' } as const;

export function SecurityApp(): ReactElement {
  const api = window.aios;
  const allowed = usePermissions((state) => state.levels.system) === 'read';
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      setReport(await api.security.scan());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api) return;
    void api.security.last().then((last) => last && setReport(last));
  }, [api]);

  if (!api) return <div className="banner error">Backend bridge unavailable.</div>;
  return (
    <div className="app-pad">
      <div className="row">
        <h3>Security Center</h3>
        <span className="hud-spacer" />
        <button
          type="button"
          className="btn primary"
          disabled={busy || !allowed}
          onClick={() => void scan()}
        >
          {busy ? 'Scanning…' : 'Scan now'}
        </button>
      </div>
      <p className="hint">
        Read-only: it looks at running programs, network connections and Windows protection, and
        explains what it finds. It never closes or changes anything.
        {!allowed
          ? ' Turn on “System info” in Settings › Permissions to use it.'
          : ' While AI OS is open it re-checks every 30 minutes.'}
      </p>
      <Banners error={error} notice={null} />
      {report && (
        <>
          {report.note && <div className="banner">{report.note}</div>}
          <section className="card">
            <h4>Status · {formatDateTime(report.scannedAt)}</h4>
            <ul className="brief-list">
              <li>
                Virus protection:{' '}
                {report.defender === 'on'
                  ? 'on'
                  : report.defender === 'off'
                    ? 'OFF'
                    : 'could not be read'}
              </li>
              <li>
                Firewall:{' '}
                {report.firewall === 'on'
                  ? 'on'
                  : report.firewall === 'off'
                    ? 'OFF for a profile'
                    : 'could not be read'}
              </li>
              <li>{report.processCount} programs running</li>
            </ul>
          </section>
          <section className="card">
            <h4>Findings</h4>
            {report.findings.length === 0 && <p className="hint">Nothing suspicious found.</p>}
            {report.findings.map((finding) => (
              <div
                key={finding.key}
                className={`bell-item ${finding.level === 'high' ? 'urgent' : ''}`}
              >
                <span className="bell-tag">{LEVEL_TEXT[finding.level]}</span>
                <strong>{finding.title}</strong>
                <span className="hint">{finding.why}</span>
              </div>
            ))}
          </section>
          <section className="card">
            <h4>Network</h4>
            <p className="hint">Programs listening for incoming connections</p>
            <ul className="brief-list">
              {report.listening.map((item) => (
                <li key={item.port}>
                  Port {item.port} — {item.process}
                </li>
              ))}
              {report.listening.length === 0 && <li>None found.</li>}
            </ul>
            <p className="hint">Programs with outside connections</p>
            <ul className="brief-list">
              {report.established.map((item) => (
                <li key={item.process}>
                  {item.process} — {item.count}
                </li>
              ))}
              {report.established.length === 0 && <li>None found.</li>}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
