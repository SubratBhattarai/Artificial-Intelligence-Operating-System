import { useMemo } from 'react';
import { formatRelative } from '../lib/format';
import { useNotifications } from '../state/notificationStore';

const LABEL = { urgent: 'Urgent', important: 'Important', info: 'FYI' } as const;

export function NotificationBell() {
  const { items, open, setOpen, markRead, markAllRead, clear } = useNotifications();
  const unread = useMemo(() => items.filter((item) => !item.read).length, [items]);
  const important = items.filter((item) => item.importance !== 'info');
  const quiet = items.filter((item) => item.importance === 'info');

  return (
    <div className="bell-wrap">
      <button
        type="button"
        className="top-btn bell"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        onClick={() => setOpen(!open)}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7.5 2 7.5H4S6 15 6 9z" />
          <path d="M10 19.5a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            <span className="hint">Filtered by importance</span>
            <span className="hud-spacer" />
            <button type="button" className="btn compact" onClick={() => void markAllRead()}>
              Mark read
            </button>
            <button type="button" className="btn compact" onClick={() => void clear()}>
              Clear
            </button>
          </div>
          {items.length === 0 && <p className="hint">Nothing needs your attention.</p>}
          {[...important, ...quiet].map((item) => (
            <button
              key={item.id}
              type="button"
              className={`bell-item ${item.importance} ${item.read ? 'read' : ''}`}
              onClick={() => void markRead(item.id)}
            >
              <span className="bell-tag">{LABEL[item.importance]}</span>
              <strong>{item.title}</strong>
              {item.body && <span className="hint">{item.body}</span>}
              <span className="hint">{formatRelative(item.at)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NotificationToasts() {
  const { toasts, dismissToast } = useNotifications();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          <strong>{toast.title}</strong>
          {toast.body && <span className="hint">{toast.body}</span>}
          <button
            type="button"
            className="hud-x"
            aria-label="Dismiss"
            onClick={() => dismissToast(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
