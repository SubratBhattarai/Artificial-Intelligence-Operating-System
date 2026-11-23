import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { FileSearchHit, SearchHit } from '../../shared/protocol';
import { errorText, formatDateTime } from '../lib/format';
import { Banners } from './appKit';

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  note: 'Note',
  memory: 'Memory',
  conversation: 'Conversation',
};

/** One search box over notes, memory, conversations and the documents you have indexed. */
export function SecondBrainApp(): ReactElement {
  const api = window.aios;
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [docs, setDocs] = useState<FileSearchHit[]>([]);
  const [idea, setIdea] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const text = query.trim();
    if (!api || !text) {
      setHits(null);
      setDocs([]);
      return;
    }
    const timer = setTimeout(() => {
      Promise.all([api.search.all(text), api.files.search(text, 12)])
        .then(([found, files]) => {
          setHits(found);
          setDocs(files);
          setError(null);
        })
        .catch((err: unknown) => setError(errorText(err)));
    }, 250);
    return () => clearTimeout(timer);
  }, [api, query]);

  if (!api) return <div className="banner error">Backend bridge unavailable.</div>;

  const capture = () => {
    const body = idea.trim();
    if (!body) return;
    api.notes
      .create(body)
      .then(() => {
        setIdea('');
        setNotice('Saved to your notes.');
        setError(null);
      })
      .catch((err: unknown) => setError(errorText(err)));
  };

  return (
    <div className="app-pad">
      <Banners error={error} notice={notice} />
      <section className="card">
        <h4>Capture an idea</h4>
        <textarea
          rows={3}
          value={idea}
          placeholder="Write it down now, find it later."
          onChange={(event) => setIdea(event.target.value)}
        />
        <div className="row">
          <button type="button" className="btn primary" disabled={!idea.trim()} onClick={capture}>
            Save idea
          </button>
        </div>
      </section>
      <section className="card">
        <h4>Search everything</h4>
        <input
          value={query}
          placeholder="Notes, ideas, documents, conversations…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <p className="hint">
          Searches only what is stored on this computer. Documents appear once their folder is
          indexed in Files.
        </p>
        {hits !== null && hits.length === 0 && docs.length === 0 && (
          <p className="hint">Nothing found.</p>
        )}
        <ul className="mail-list">
          {(hits ?? []).map((hit) => (
            <li key={`${hit.kind}-${hit.id}`} className="mail-item">
              <strong>{hit.title || '(untitled)'}</strong>
              <span className="hint">
                {KIND_LABEL[hit.kind]} · {formatDateTime(hit.updatedAt)}
              </span>
              <span>{hit.snippet}</span>
            </li>
          ))}
          {docs.map((doc) => (
            <li key={doc.chunkId} className="mail-item">
              <strong>{doc.name}</strong>
              <span className="hint">Document · {doc.section}</span>
              <span>{doc.snippet}</span>
              <span className="row">
                <button
                  type="button"
                  className="btn compact"
                  onClick={() => void api.files.open(doc.path)}
                >
                  Open
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
