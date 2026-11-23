import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { MonitorSnapshot } from '../../shared/apps';
import { errorText, formatDuration } from '../lib/format';
import type { ShellAppProps } from './types';

const POLL_MS = 2000;
const HISTORY = 40;

function Meter({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <strong>{value === null ? '—' : `${value}%`}</strong>
      </div>
      <div className="bar">
        <i style={{ width: `${value ?? 0}%` }} />
      </div>
      <small className="muted">{detail}</small>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 100 24" />;
  const step = 100 / (HISTORY - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(23 - (v / 100) * 22).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-label="CPU history">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function MonitorApp({ active }: ShellAppProps): ReactElement {
  const api = window.aios;
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const busy = useRef(false);

  // Poll only while this window is focused, so the monitor costs nothing in the background.
  useEffect(() => {
    if (!api || !active) return;
    let stopped = false;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const next = await api.monitor.snapshot();
        if (stopped) return;
        setSnapshot(next);
        setHistory((prev) => [...prev, next.cpu].slice(-HISTORY));
        setError(null);
      } catch (err) {
        if (!stopped) setError(errorText(err));
      } finally {
        busy.current = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [api, active]);

  if (!api) return <div className="app-pad banner error">Backend bridge unavailable.</div>;

  return (
    <div className="app-pad monitor">
      {error && <div className="banner error">{error}</div>}
      {!snapshot && !error && <div className="empty">Reading system…</div>}
      {snapshot && (
        <>
          <div className="meter-grid">
            <Meter label="CPU" value={snapshot.cpu} detail={`${snapshot.perCore.length} cores`} />
            <Meter
              label="Memory"
              value={snapshot.ramPercent}
              detail={`${(snapshot.ramUsedMb / 1024).toFixed(1)} of ${(snapshot.ramTotalMb / 1024).toFixed(1)} GB`}
            />
            <Meter
              label="Disk"
              value={snapshot.diskPercent}
              detail={
                snapshot.diskFreeGb === null ? 'unavailable' : `${snapshot.diskFreeGb} GB free`
              }
            />
          </div>
          <div className="card">
            <div className="card-head">
              <h3>CPU history</h3>
              <span className="muted">
                up {formatDuration(snapshot.uptimeSec * 1000)} (h:m:s from boot)
              </span>
            </div>
            <Sparkline values={history} />
            <div className="core-grid">
              {snapshot.perCore.map((value, index) => (
                <div key={index} className="core" title={`Core ${index + 1}: ${value}%`}>
                  <i style={{ height: `${Math.max(4, value)}%` }} />
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <h3>AI OS processes</h3>
            </div>
            <table className="proc-table">
              <thead>
                <tr>
                  <th>Process</th>
                  <th>Memory</th>
                  <th>CPU</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.processes.map((proc, index) => (
                  <tr key={`${proc.name}-${index}`}>
                    <td>{proc.name}</td>
                    <td>{proc.memoryMb} MB</td>
                    <td>{proc.cpu}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
