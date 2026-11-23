import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type {
  Conversation,
  ConversationSummary,
  MemoryRecord,
  MemorySettings,
  MemorySourceSummary,
  SearchHit,
  SearchHitKind,
} from '../../shared/protocol';
import { ConfirmButton } from '../components/ConfirmButton';
import { Highlight } from '../components/Highlight';
import { errorText, formatDate, formatDateTime, formatRelative } from '../lib/format';
import { useChat } from '../state/chatStore';
import { useUi } from '../state/uiStore';
import { useWindows } from '../state/windowStore';
import type { ShellAppProps } from './types';

type Tab = 'memories' | 'conversations' | 'search' | 'privacy';

const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIDENCE_OPTIONS: Array<[string, number]> = [
  ['High', 1],
  ['Medium', 0.7],
  ['Low', 0.4],
];
const EXPIRY_OPTIONS: Array<[string, number | null]> = [
  ['Never expires', null],
  ['1 day', DAY_MS],
  ['1 week', 7 * DAY_MS],
  ['30 days', 30 * DAY_MS],
  ['1 year', 365 * DAY_MS],
];
const KIND_LABEL: Record<SearchHitKind, string> = {
  memory: 'Memory',
  note: 'Note',
  conversation: 'Conversation',
};

function confidenceLabel(value: number): string {
  if (value >= 0.85) return 'High';
  if (value >= 0.55) return 'Medium';
  return 'Low';
}

export function MemoryApp(_props: ShellAppProps): ReactElement {
  const api = window.aios;
  const [tab, setTab] = useState<Tab>('memories');
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [sources, setSources] = useState<MemorySourceSummary[]>([]);
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [showExpired, setShowExpired] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!api) return;
    try {
      const [nextRecords, nextSources, nextSettings, nextConversations] = await Promise.all([
        api.memory.list({ includeExpired: showExpired }),
        api.memory.sources(),
        api.memory.getSettings(),
        api.conversations.list(),
      ]);
      setRecords(nextRecords);
      setSources(nextSources);
      setSettings(nextSettings);
      setConversations(nextConversations);
    } catch (err) {
      setError(errorText(err));
    }
  }, [api, showExpired]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (action: () => Promise<unknown>, success?: string) => {
      setError(null);
      try {
        await action();
        if (success) setNotice(success);
        await reload();
      } catch (err) {
        setError(errorText(err));
      }
    },
    [reload],
  );

  const pending = records.filter((record) => record.status === 'pending');

  if (!api) return <div className="app-pad banner error">Backend bridge unavailable.</div>;

  return (
    <div className="mem">
      <nav className="tabs" role="tablist">
        {(
          [
            ['memories', `Memories${pending.length ? ` · ${pending.length} to review` : ''}`],
            ['conversations', `Conversations · ${conversations.length}`],
            ['search', 'Search'],
            ['privacy', 'Data & privacy'],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`tab ${tab === id ? 'active' : ''}`}
            onClick={() => {
              setTab(id);
              setNotice(null);
              setError(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && <div className="banner error">{error}</div>}
      {notice && !error && <div className="banner ok">{notice}</div>}

      <div className="tab-body">
        {tab === 'memories' && (
          <MemoriesTab
            records={records}
            showExpired={showExpired}
            onShowExpired={setShowExpired}
            run={run}
          />
        )}
        {tab === 'conversations' && (
          <ConversationsTab
            conversations={conversations}
            sources={sources}
            run={run}
            onNotice={setNotice}
          />
        )}
        {tab === 'search' && <SearchTab onOpenTab={setTab} />}
        {tab === 'privacy' && (
          <PrivacyTab
            settings={settings}
            sources={sources}
            recordCount={records.filter((record) => record.status === 'active').length}
            conversationCount={conversations.length}
            run={run}
            onNotice={setNotice}
            onError={setError}
          />
        )}
      </div>
    </div>
  );
}

type Runner = (action: () => Promise<unknown>, success?: string) => Promise<void>;

/* ------------------------------ memories ------------------------------ */

function MemoriesTab({
  records,
  showExpired,
  onShowExpired,
  run,
}: {
  records: MemoryRecord[];
  showExpired: boolean;
  onShowExpired: (value: boolean) => void;
  run: Runner;
}) {
  const api = window.aios!;
  const [fact, setFact] = useState('');
  const [confidence, setConfidence] = useState(1);
  const [expiryMs, setExpiryMs] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const now = Date.now();

  const pending = records.filter((record) => record.status === 'pending');
  const active = records.filter((record) => record.status === 'active');
  const expiredCount = records.filter(
    (record) => record.expiresAt !== null && record.expiresAt <= now,
  ).length;

  const add = () => {
    const text = fact.trim();
    if (!text) return;
    void run(
      () =>
        api.memory.add({
          fact: text,
          confidence,
          expiresAt: expiryMs === null ? null : Date.now() + expiryMs,
        }),
      'Saved to memory.',
    );
    setFact('');
  };

  return (
    <div className="stack">
      <section className="card">
        <h3>Add a memory</h3>
        <div className="form-row">
          <input
            className="input grow"
            value={fact}
            maxLength={500}
            placeholder="A fact for JARVIS to remember, e.g. “I prefer metric units”"
            onChange={(event) => setFact(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
            }}
          />
          <select
            className="select"
            value={confidence}
            onChange={(event) => setConfidence(Number(event.target.value))}
            aria-label="Confidence"
          >
            {CONFIDENCE_OPTIONS.map(([label, value]) => (
              <option key={label} value={value}>
                {label} confidence
              </option>
            ))}
          </select>
          <select
            className="select"
            value={expiryMs ?? 'never'}
            onChange={(event) =>
              setExpiryMs(event.target.value === 'never' ? null : Number(event.target.value))
            }
            aria-label="Expiry"
          >
            {EXPIRY_OPTIONS.map(([label, value]) => (
              <option key={label} value={value ?? 'never'}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" className="btn primary" onClick={add} disabled={!fact.trim()}>
            Save
          </button>
        </div>
      </section>

      {pending.length > 0 && (
        <section className="card attention">
          <h3>Suggested by JARVIS · waiting for your approval</h3>
          <p className="hint">Nothing here is used until you approve it.</p>
          <ul className="mem-list">
            {pending.map((record) => (
              <li key={record.id} className="mem-item">
                <div className="mem-main">
                  <div className="mem-fact">{record.fact}</div>
                  <div className="mem-meta">
                    suggested {formatRelative(record.createdAt)} ·{' '}
                    {confidenceLabel(record.confidence)} confidence
                  </div>
                </div>
                <div className="mem-actions">
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void run(() => api.memory.approve(record.id), 'Approved.')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      void run(() => api.memory.remove(record.id), 'Suggestion rejected.')
                    }
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h3>Saved memories · {active.length}</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={showExpired}
              onChange={(event) => onShowExpired(event.target.checked)}
            />
            Show expired
          </label>
          {showExpired && expiredCount > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() => void run(() => api.memory.purgeExpired(), 'Expired memories deleted.')}
            >
              Delete {expiredCount} expired
            </button>
          )}
        </div>
        {active.length === 0 ? (
          <p className="empty">
            Nothing saved yet. Add a memory above, or approve JARVIS’s suggestions.
          </p>
        ) : (
          <ul className="mem-list">
            {active.map((record) => {
              const expired = record.expiresAt !== null && record.expiresAt <= now;
              const editing = editingId === record.id;
              return (
                <li key={record.id} className={`mem-item ${expired ? 'expired' : ''}`}>
                  <div className="mem-main">
                    {editing ? (
                      <input
                        className="input"
                        autoFocus
                        value={draft}
                        maxLength={500}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setEditingId(null);
                          if (event.key === 'Enter' && draft.trim()) {
                            void run(
                              () => api.memory.update(record.id, { fact: draft }),
                              'Memory updated.',
                            );
                            setEditingId(null);
                          }
                        }}
                      />
                    ) : (
                      <div className="mem-fact">{record.fact}</div>
                    )}
                    <div className="mem-meta">
                      {record.source.label} · saved {formatDate(record.createdAt)} ·{' '}
                      {confidenceLabel(record.confidence)} confidence ·{' '}
                      {record.expiresAt === null
                        ? 'never expires'
                        : expired
                          ? `expired ${formatDate(record.expiresAt)}`
                          : `expires ${formatDate(record.expiresAt)}`}
                    </div>
                  </div>
                  <div className="mem-actions">
                    {editing ? (
                      <>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={!draft.trim()}
                          onClick={() => {
                            void run(
                              () => api.memory.update(record.id, { fact: draft }),
                              'Memory updated.',
                            );
                            setEditingId(null);
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn ghost"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            setEditingId(record.id);
                            setDraft(record.fact);
                          }}
                        >
                          Edit
                        </button>
                        <ConfirmButton
                          label="Delete"
                          onConfirm={() =>
                            void run(() => api.memory.remove(record.id), 'Memory deleted.')
                          }
                        />
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------------------------- conversations --------------------------- */

function ConversationsTab({
  conversations,
  sources,
  run,
  onNotice,
}: {
  conversations: ConversationSummary[];
  sources: MemorySourceSummary[];
  run: Runner;
  onNotice: (message: string) => void;
}) {
  const api = window.aios!;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const resume = useChat((state) => state.resume);
  const openJarvis = useUi((state) => state.openJarvis);

  useEffect(() => {
    if (!selectedId) {
      setConversation(null);
      return;
    }
    let cancelled = false;
    void api.conversations.get(selectedId).then((value) => {
      if (!cancelled) setConversation(value);
    });
    return () => {
      cancelled = true;
    };
  }, [api, selectedId, conversations]);

  const linkedSources = useMemo(
    () => sources.filter((source) => source.sessionId === selectedId),
    [sources, selectedId],
  );
  const linkedCount = linkedSources.reduce((total, source) => total + source.count, 0);

  return (
    <div className="split">
      <div className="split-list">
        {conversations.length === 0 && (
          <p className="empty">
            No conversations yet. Talk to JARVIS (Alt+Space) and they will be saved here, on this
            computer.
          </p>
        )}
        {conversations.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`list-row ${entry.id === selectedId ? 'active' : ''}`}
            onClick={() => setSelectedId(entry.id)}
          >
            <span className="list-title">{entry.title || 'Conversation'}</span>
            <span className="list-sub">{entry.summary}</span>
            <span className="list-meta">
              {formatRelative(entry.updatedAt)} · {entry.messageCount} messages
            </span>
          </button>
        ))}
      </div>

      <div className="split-detail">
        {!conversation && <p className="empty">Select a conversation to read it.</p>}
        {conversation && (
          <>
            <div className="detail-head">
              <div>
                <h3>{conversation.title}</h3>
                <div className="mem-meta">
                  Session <span className="mono">{conversation.id}</span> · started{' '}
                  {formatDateTime(conversation.createdAt)}
                </div>
              </div>
              <div className="mem-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    resume(conversation);
                    openJarvis();
                  }}
                >
                  Continue in JARVIS
                </button>
                {linkedCount > 0 && (
                  <ConfirmButton
                    label={`Delete ${linkedCount} linked memor${linkedCount === 1 ? 'y' : 'ies'}`}
                    confirmLabel="Yes, delete them"
                    onConfirm={() =>
                      void run(async () => {
                        for (const source of linkedSources)
                          await api.memory.removeBySource(source.key);
                      }, 'Memories from this conversation deleted.')
                    }
                  />
                )}
                <ConfirmButton
                  label="Delete conversation"
                  onConfirm={() => {
                    setSelectedId(null);
                    void run(
                      () => api.conversations.remove(conversation.id),
                      'Conversation deleted.',
                    );
                    onNotice('Conversation deleted.');
                  }}
                />
              </div>
            </div>
            <div className="transcript">
              {conversation.messages.map((message) => (
                <div key={message.id} className={`msg ${message.role}`}>
                  <div className="msg-role">
                    {message.role === 'user' ? 'You' : 'JARVIS'}
                    <span className="msg-time">{formatDateTime(message.createdAt)}</span>
                  </div>
                  <div className="msg-content">{message.content}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------- search ------------------------------ */

function SearchTab({ onOpenTab }: { onOpenTab: (tab: Tab) => void }) {
  const api = window.aios!;
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<Record<SearchHitKind, boolean>>({
    memory: true,
    note: true,
    conversation: true,
  });
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openApp = useWindows((state) => state.openApp);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setHits(null);
      return;
    }
    const timer = setTimeout(() => {
      const wanted = (Object.keys(kinds) as SearchHitKind[]).filter((kind) => kinds[kind]);
      api.search
        .all(text, wanted)
        .then((result) => {
          setHits(result);
          setError(null);
        })
        .catch((err) => setError(errorText(err)));
    }, 200);
    return () => clearTimeout(timer);
  }, [api, query, kinds]);

  return (
    <div className="stack">
      <div className="form-row">
        <input
          className="input grow"
          autoFocus
          value={query}
          placeholder="Search memories, notes and conversations"
          onChange={(event) => setQuery(event.target.value)}
        />
        {(Object.keys(KIND_LABEL) as SearchHitKind[]).map((kind) => (
          <label key={kind} className="check">
            <input
              type="checkbox"
              checked={kinds[kind]}
              onChange={(event) => setKinds({ ...kinds, [kind]: event.target.checked })}
            />
            {KIND_LABEL[kind]}
          </label>
        ))}
      </div>
      {error && <div className="banner error">{error}</div>}
      {hits === null && <p className="empty">Type to search everything JARVIS has stored.</p>}
      {hits !== null && hits.length === 0 && <p className="empty">No matches.</p>}
      <ul className="result-list">
        {(hits ?? []).map((hit) => (
          <li key={`${hit.kind}:${hit.id}`} className="result">
            <div className="result-head">
              <span className={`kind-badge ${hit.kind}`}>{KIND_LABEL[hit.kind]}</span>
              <span className="result-title">
                <Highlight text={hit.title} query={query} />
              </span>
              <span className="result-date">{formatDate(hit.updatedAt)}</span>
            </div>
            <div className="result-snippet">
              <Highlight text={hit.snippet} query={query} />
            </div>
            <div className="result-actions">
              {hit.kind === 'note' && (
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    openApp('notes', { width: window.innerWidth, height: window.innerHeight })
                  }
                >
                  Open Notes
                </button>
              )}
              {hit.kind === 'memory' && (
                <button type="button" className="btn" onClick={() => onOpenTab('memories')}>
                  Show in Memories
                </button>
              )}
              {hit.kind === 'conversation' && (
                <button type="button" className="btn" onClick={() => onOpenTab('conversations')}>
                  Show in Conversations
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------- data & privacy ------------------------- */

function PrivacyTab({
  settings,
  sources,
  recordCount,
  conversationCount,
  run,
  onNotice,
  onError,
}: {
  settings: MemorySettings | null;
  sources: MemorySourceSummary[];
  recordCount: number;
  conversationCount: number;
  run: Runner;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const api = window.aios!;

  const exportAll = async () => {
    try {
      const result = await api.memory.exportAll();
      if (result.ok) onNotice(`Exported to ${result.path}`);
      else if (!result.canceled) onError(result.error ?? 'Export failed.');
    } catch (err) {
      onError(errorText(err));
    }
  };

  return (
    <div className="stack">
      <section className="card">
        <h3>How memory is used</h3>
        <label className="check block">
          <input
            type="checkbox"
            checked={settings?.injectIntoPrompt ?? true}
            onChange={(event) =>
              void run(() => api.memory.setSettings({ injectIntoPrompt: event.target.checked }))
            }
          />
          Let JARVIS use my saved memories in its answers
        </label>
        <p className="hint">
          Everything is stored on this computer only. JARVIS can <em>suggest</em> a memory, but it
          is never saved until you approve it. Turn the box off and JARVIS ignores memory entirely.
        </p>
      </section>

      <section className="card">
        <h3>Delete by source</h3>
        {sources.length === 0 ? (
          <p className="empty">No memories yet.</p>
        ) : (
          <ul className="mem-list">
            {sources.map((source) => (
              <li key={source.key} className="mem-item">
                <div className="mem-main">
                  <div className="mem-fact">{source.label}</div>
                  <div className="mem-meta">
                    {source.kind}
                    {source.sessionId ? ` · session ${source.sessionId}` : ''} · {source.count}{' '}
                    {source.count === 1 ? 'memory' : 'memories'}
                  </div>
                </div>
                <div className="mem-actions">
                  <ConfirmButton
                    label="Delete all"
                    confirmLabel={`Delete ${source.count}`}
                    onConfirm={() =>
                      void run(
                        () => api.memory.removeBySource(source.key),
                        `Deleted memories from “${source.label}”.`,
                      )
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3>Your data</h3>
        <div className="row">
          <button type="button" className="btn primary" onClick={() => void exportAll()}>
            Export everything (JSON)…
          </button>
          <ConfirmButton
            label={`Delete all ${recordCount} memories`}
            confirmLabel="Yes, delete all memories"
            disabled={recordCount === 0}
            onConfirm={() => void run(() => api.memory.clearAll(), 'All memories deleted.')}
          />
          <ConfirmButton
            label={`Delete all ${conversationCount} conversations`}
            confirmLabel="Yes, delete all conversations"
            disabled={conversationCount === 0}
            onConfirm={() =>
              void run(() => api.conversations.clearAll(), 'All conversations deleted.')
            }
          />
        </div>
        <p className="hint">
          The export contains your memories, notes and full conversations. It is written only to the
          file you choose.
        </p>
      </section>
    </div>
  );
}
