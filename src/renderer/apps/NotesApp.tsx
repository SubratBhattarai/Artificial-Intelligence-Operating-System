import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { NoteRecord } from '../../shared/protocol';
import { ConfirmButton } from '../components/ConfirmButton';
import { errorText, formatRelative } from '../lib/format';
import type { ShellAppProps } from './types';

const LEGACY_KEY = 'aios.notes.v1';
const SAVE_DELAY_MS = 600;

/** Saved notes: stored locally by the app (so they are searchable by JARVIS and in the Memory app). */
export function NotesApp(_props: ShellAppProps): ReactElement {
  const api = window.aios;
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!api) return [];
    const list = await api.notes.list();
    setNotes(list);
    return list;
  }, [api]);

  // First load, including a one-time move of the old scratchpad text into a real note.
  useEffect(() => {
    if (!api) return;
    void (async () => {
      try {
        let list = await refresh();
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy && legacy.trim() && list.length === 0) {
          await api.notes.create(legacy);
          localStorage.removeItem(LEGACY_KEY);
          list = await refresh();
        }
        if (list[0]) setSelectedId(list[0].id);
      } catch (err) {
        setError(errorText(err));
      }
    })();
  }, [api, refresh]);

  // Load the selected note's text into the editor.
  useEffect(() => {
    const note = notes.find((entry) => entry.id === selectedId);
    if (!note || loadedId.current === note.id) return;
    loadedId.current = note.id;
    setText(note.body);
    setSavedAt(note.updatedAt);
  }, [notes, selectedId]);

  const flush = useCallback(
    async (id: string, body: string) => {
      if (!api) return;
      try {
        const saved = await api.notes.update(id, body);
        setSavedAt(saved.updatedAt);
        setNotes((current) => current.map((entry) => (entry.id === id ? saved : entry)));
      } catch (err) {
        setError(errorText(err));
      }
    },
    [api],
  );

  const onChange = (value: string) => {
    setText(value);
    if (!selectedId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const id = selectedId;
    saveTimer.current = setTimeout(() => void flush(id, value), SAVE_DELAY_MS);
  };

  const select = async (id: string) => {
    if (saveTimer.current && selectedId) {
      clearTimeout(saveTimer.current);
      await flush(selectedId, text);
    }
    loadedId.current = null;
    setSelectedId(id);
  };

  const create = async () => {
    if (!api) return;
    try {
      if (saveTimer.current && selectedId) {
        clearTimeout(saveTimer.current);
        await flush(selectedId, text);
      }
      const note = await api.notes.create('');
      await refresh();
      loadedId.current = null;
      setSelectedId(note.id);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const remove = async (id: string) => {
    if (!api) return;
    try {
      await api.notes.remove(id);
      const list = await refresh();
      loadedId.current = null;
      setSelectedId(list[0]?.id ?? null);
      if (!list[0]) setText('');
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (!api) return <div className="app-pad banner error">Backend bridge unavailable.</div>;

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="notes2">
      <aside className="notes-side">
        <button type="button" className="btn primary wide" onClick={() => void create()}>
          + New note
        </button>
        <div className="notes-list">
          {notes.length === 0 && <p className="empty">No notes yet.</p>}
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              className={`list-row ${note.id === selectedId ? 'active' : ''}`}
              onClick={() => void select(note.id)}
            >
              <span className="list-title">{note.title}</span>
              <span className="list-meta">{formatRelative(note.updatedAt)}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="notes-main">
        {error && <div className="banner error">{error}</div>}
        {selectedId ? (
          <>
            <textarea
              className="notes-editor"
              value={text}
              spellCheck={false}
              placeholder="Start typing — saved on this computer as you write."
              onChange={(event) => onChange(event.target.value)}
            />
            <div className="notes-footer muted">
              <span>
                {words} words
                {savedAt ? ` · saved ${new Date(savedAt).toLocaleTimeString()}` : ''}
              </span>
              <ConfirmButton label="Delete note" onConfirm={() => void remove(selectedId)} />
            </div>
          </>
        ) : (
          <p className="empty pad">Create a note to get started.</p>
        )}
      </section>
    </div>
  );
}
