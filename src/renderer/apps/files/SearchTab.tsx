import { useEffect, useState } from 'react';
import type { FileSearchHit } from '../../../shared/protocol';
import { Highlight } from '../../components/Highlight';
import { errorText, formatDateTime, formatSize } from '../../lib/format';
import type { FileIndexController } from './useFileIndex';
import { PreviewPane } from './PreviewPane';

export function SearchTab({ index }: { index: FileIndexController }) {
  const api = window.aios;
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<FileSearchHit[] | null>(null);
  const [selected, setSelected] = useState<FileSearchHit | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const text = query.trim();
    if (!api || !text) {
      setHits(null);
      return;
    }
    const timer = setTimeout(() => {
      api.files
        .search(text, 30)
        .then((result) => {
          setHits(result);
          setError(null);
        })
        .catch((err) => setError(errorText(err)));
    }, 250);
    return () => clearTimeout(timer);
  }, [api, query, index.overview?.totals.chunks]);

  const noFolders = (index.overview?.folders.length ?? 0) === 0;

  return (
    <div className="search-layout">
      <section className="search-main">
        <div className="form-row">
          <input
            className="input grow"
            autoFocus
            value={query}
            placeholder="Search the contents and names of your indexed files"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {error && <div className="banner error">{error}</div>}
        {noFolders && (
          <p className="empty">
            No folders are indexed yet.{' '}
            <button type="button" className="link" onClick={() => void index.addFolder()}>
              Choose a folder
            </button>{' '}
            to start.
          </p>
        )}
        {!noFolders && hits === null && (
          <p className="empty">Type to search inside your documents.</p>
        )}
        {hits !== null && hits.length === 0 && (
          <p className="empty">No matches in the indexed files.</p>
        )}
        <ul className="result-list">
          {(hits ?? []).map((hit) => (
            <li
              key={hit.fileId}
              className={`result clickable ${selected?.fileId === hit.fileId ? 'active' : ''}`}
              onClick={() => setSelected(hit)}
            >
              <div className="result-head">
                <span className="result-title">
                  <Highlight text={hit.name} query={query} />
                </span>
                <span className="section-pill">{hit.section}</span>
                <span className="result-date">{formatDateTime(hit.modifiedAt)}</span>
              </div>
              <div className="result-path mono" title={hit.path}>
                {hit.path} · {formatSize(hit.size)}
              </div>
              <div className="result-snippet">
                <Highlight text={hit.snippet} query={query} />
              </div>
              {hit.duplicates.length > 0 && (
                <div className="result-dups">
                  <button
                    type="button"
                    className="link"
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpanded(expanded === hit.fileId ? null : hit.fileId);
                    }}
                  >
                    + {hit.duplicates.length} identical cop
                    {hit.duplicates.length === 1 ? 'y' : 'ies'}
                  </button>
                  {expanded === hit.fileId && (
                    <ul className="dup-list mono">
                      {hit.duplicates.map((duplicate) => (
                        <li key={duplicate}>{duplicate}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      <aside className="search-preview">
        <PreviewPane path={selected?.path ?? null} query={query} />
      </aside>
    </div>
  );
}
