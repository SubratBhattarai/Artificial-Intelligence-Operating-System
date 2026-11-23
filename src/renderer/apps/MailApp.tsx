import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { MailFolder, MailMessage } from '../../shared/mail';
import { ConfirmButton } from '../components/ConfirmButton';
import { errorText, formatDateTime } from '../lib/format';
import { AppTabs, Banners, describeImport, useRunner } from './appKit';

type View = MailFolder | 'compose';

export function MailApp(): ReactElement {
  const api = window.aios;
  const [view, setView] = useState<View>('inbox');
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ to: '', subject: '', body: '' });

  const reload = useCallback(async () => {
    if (!api || view === 'compose') return;
    setMessages(await api.mail.list(view));
  }, [api, view]);
  const { error, notice, setError, setNotice, run } = useRunner(reload);

  useEffect(() => {
    void reload().catch((err) => setError(errorText(err)));
  }, [reload, setError]);

  if (!api) return <div className="banner error">Backend bridge unavailable.</div>;
  const open = messages.find((message) => message.id === openId) ?? null;

  return (
    <div className="mem">
      <AppTabs
        tabs={[
          ['inbox', 'Inbox'],
          ['sent', 'Sent'],
          ['compose', 'Write'],
        ]}
        value={view}
        onChange={(next) => {
          setView(next);
          setOpenId(null);
        }}
        trailing={
          <button
            type="button"
            className="btn"
            onClick={() =>
              void run(async () => {
                const result = await api.mail.importFile();
                if (!result.canceled) setNotice(describeImport(result));
              })
            }
          >
            Import .eml / .txt
          </button>
        }
      />
      <div className="tab-body">
        <div className="app-pad">
          <Banners error={error} notice={notice} />
          <p className="hint">
            This mailbox lives entirely inside AI OS. Nothing is sent to or received from the
            internet. Text in messages is treated as content, never as instructions for JARVIS.
          </p>
          {view === 'compose' ? (
            <section className="card">
              <div className="form-row">
                <label>To</label>
                <input
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label>Subject</label>
                <input
                  value={draft.subject}
                  onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                />
              </div>
              <textarea
                rows={10}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
              <div className="row">
                <button
                  type="button"
                  className="btn primary"
                  disabled={!draft.to.trim() || !draft.subject.trim()}
                  onClick={() =>
                    void run(async () => {
                      await api.mail.compose(draft);
                      setDraft({ to: '', subject: '', body: '' });
                      setView('sent');
                    }, 'Saved to Sent (local only).')
                  }
                >
                  Save to Sent
                </button>
              </div>
            </section>
          ) : open ? (
            <section className="card">
              <h3>{open.subject || '(no subject)'}</h3>
              <p className="hint">
                From {open.from} · To {open.to} · {formatDateTime(open.date)}
              </p>
              <pre className="mail-body">{open.body}</pre>
              <div className="row">
                <button type="button" className="btn" onClick={() => setOpenId(null)}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void run(() => api.mail.setUnread(open.id, !open.unread))}
                >
                  Mark as {open.unread ? 'read' : 'unread'}
                </button>
                <ConfirmButton
                  label="Delete"
                  confirmLabel="Yes, delete"
                  onConfirm={() =>
                    void run(async () => {
                      await api.mail.remove(open.id);
                      setOpenId(null);
                    })
                  }
                />
              </div>
            </section>
          ) : messages.length === 0 ? (
            <p className="hint">No messages here.</p>
          ) : (
            <ul className="mail-list">
              {messages.map((message) => (
                <li key={message.id}>
                  <button
                    type="button"
                    className={`mail-item ${message.unread ? 'unread' : ''}`}
                    onClick={() => {
                      setOpenId(message.id);
                      if (message.unread) void run(() => api.mail.setUnread(message.id, false));
                    }}
                  >
                    <strong>{message.subject || '(no subject)'}</strong>
                    <span className="hint">
                      {view === 'sent' ? `To ${message.to}` : message.from} ·{' '}
                      {formatDateTime(message.date)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
