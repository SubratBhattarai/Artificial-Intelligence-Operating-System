import { useEffect, useState } from 'react';
import type { SystemMetrics } from '../../shared/protocol';

const HISTORY_LENGTH = 36;
const POLL_MS = 2000;
const SPARK_WIDTH = 176;
const SPARK_HEIGHT = 30;

function sparklinePath(values: number[]): string {
  if (values.length < 2) return '';
  const step = SPARK_WIDTH / (HISTORY_LENGTH - 1);
  const offset = (HISTORY_LENGTH - values.length) * step;
  return values
    .map((value, index) => {
      const x = offset + index * step;
      const y = SPARK_HEIGHT - 2 - (Math.min(100, value) / 100) * (SPARK_HEIGHT - 6);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function MetricRow({
  label,
  value,
  glyph,
}: {
  label: string;
  value: number | null;
  glyph: string;
}) {
  return (
    <div className="metric-row">
      <span className="metric-glyph" aria-hidden>
        {glyph}
      </span>
      <span className="metric-label">{label}</span>
      <span className="metric-bar" aria-hidden>
        <span style={{ transform: `scaleX(${(value ?? 0) / 100})` }} />
      </span>
      <span className="metric-value">{value === null ? '—' : `${value}%`}</span>
    </div>
  );
}

/** Clock plus live CPU / RAM / disk. Polls only while the window is visible. */
export function SystemWidget() {
  const [now, setNow] = useState(() => new Date());
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [history, setHistory] = useState<number[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const api = window.aios;
    if (!api) return undefined;
    let cancelled = false;

    const poll = async () => {
      if (document.hidden) return;
      try {
        const next = await api.getMetrics();
        if (cancelled) return;
        setMetrics(next);
        setHistory((previous) => [...previous, next.cpu].slice(-HISTORY_LENGTH));
      } catch {
        // The widget is decorative; skip a failed sample.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <aside className="system-widget" aria-label="Clock and system status">
      <div className="widget-time">
        {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      </div>
      <div className="widget-date">
        {now.toLocaleDateString([], {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })}
      </div>
      <div className="widget-rule" />
      <MetricRow label="CPU" value={metrics?.cpu ?? null} glyph="◧" />
      <MetricRow label="RAM" value={metrics?.ram ?? null} glyph="▤" />
      <MetricRow label="Disk" value={metrics?.disk ?? null} glyph="◫" />
      <svg
        className="widget-spark"
        viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
        width="100%"
        height={SPARK_HEIGHT}
        preserveAspectRatio="none"
        aria-hidden
      >
        <path d={sparklinePath(history)} fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </aside>
  );
}
