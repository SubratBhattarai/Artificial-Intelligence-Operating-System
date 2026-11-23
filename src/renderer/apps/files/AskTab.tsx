import { Fragment, useEffect, useRef, useState } from 'react';
import type { DocSource, DocUnreadable, DocsEvent } from '../../../shared/protocol';
import { errorText, formatDate } from '../../lib/format';
import type { FileIndexController } from './useFileIndex';
import { PreviewPane } from './PreviewPane';

type Status = 'idle' | 'working' | 'error';

function newRequestId(): string {
  return `docs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Turn "[1]" / "[2][3]" markers in the answer into links to the matching source card. */
function CitedText({ text, onCite }: { text: string; onCite: (n: number) => void }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((part, position) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (!match) return <Fragment key={position}>{part}</Fragment>;
        const n = Number(match[1]);
        return (
          <button
            key={position}
            type="button"
            className="cite"
            onClick={() => onCite(n)}
            title={`Source ${n}`}
          >
            {n}
          </button>
        );
      })}
    </>
  );
}

export function AskTab({ index }: { index: FileIndexController }) {
  const api = window.aios;
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<DocSource[]>([]);
  const [unreadable, setUnreadable] = useState<DocUnreadable[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocSource | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const requestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!api) return;
    return api.docs.onEvent((event: DocsEvent) => {
      if (event.requestId !== requestRef.current) return;
      switch (event.type) {
        case 'sources':
          setSources(event.sources);
          setUnreadable(event.unreadable);
          break;
        case 'text':
          setAnswer((current) => current + event.text);
          break;
        case 'done':
        case 'cancelled':
          setStatus('idle');
          requestRef.current = null;
          break;
        case 'error':
          setStatus('error');
          setError(event.message);
          requestRef.current = null;
          break;
      }
    });
  }, [api]);

  const ask = async () => {
    const text = question.trim();
    if (!api || !text || status === 'working') return;
    const requestId = newRequestId();
    requestRef.current = requestId;
    setAnswer('');
    setSources([]);
    setUnreadable([]);
    setPreview(null);
    setError(null);
    setAsked(text);
    setStatus('working');
    try {
      await api.docs.ask({ requestId, question: text });
    } catch (err) {
      setStatus('error');
      setError(errorText(err));
      requestRef.current = null;
    }
  };

  const stop = () => {
    if (api && requestRef.current) void api.docs.cancel(requestRef.current);
  };

  const cite = (n: number) => {
    setFlash(n);
    document
      .getElementById(`source-${n}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setTimeout(() => setFlash(null), 1400);
  };

  const noFolders = (index.overview?.folders.length ?? 0) === 0;
  const unreadableTotal = index.overview?.totals.unreadable ?? 0;

  return (
    <div className="ask-layout">
      <section className="ask-main">
        <div className="form-row">
          <textarea
            className="input grow ask-input"
            rows={2}
            value={question}
            placeholder="Ask a question about your documents — answers cite the files and sections used"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void ask();
              }
            }}
          />
          {status === 'working' ? (
            <button type="button" className="btn danger" onClick={stop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => void ask()}
              disabled={!question.trim()}
            >
              Ask
            </button>
          )}
        </div>

        {noFolders && (
          <p className="empty">
            Choose a folder first so there is something to ask about.{' '}
            <button type="button" className="link" onClick={() => void index.addFolder()}>
              Add folder
            </button>
          </p>
        )}
        {error && <div className="banner error">{error}</div>}

        {asked && (
          <div className="answer">
            <div className="answer-q">{asked}</div>
            <div className="answer-body">
              {answer ? (
                <CitedText text={answer} onCite={cite} />
              ) : status === 'working' ? (
                <span className="caret" />
              ) : null}
            </div>
          </div>
        )}

        {unreadable.length > 0 && (
          <div className="banner warn">
            <strong>These files may be relevant but could not be read:</strong>
            <ul className="plain-list">
              {unreadable.map((file) => (
                <li key={file.path}>
                  <span className="mono">{file.name}</span> — {file.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        {asked && unreadableTotal > 0 && unreadable.length === 0 && (
          <p className="hint">
            {unreadableTotal} indexed file{unreadableTotal === 1 ? '' : 's'} could not be read and
            are not part of any answer. See the Index tab.
          </p>
        )}

        {sources.length > 0 && (
          <div className="sources">
            <h4>Sources used</h4>
            {sources.map((source) => (
              <div
                key={source.chunkId}
                id={`source-${source.n}`}
                className={`source ${flash === source.n ? 'flash' : ''} ${preview?.n === source.n ? 'active' : ''}`}
              >
                <span className="source-n">{source.n}</span>
                <div className="source-body">
                  <div className="source-title">
                    {source.name} <span className="section-pill">{source.section}</span>
                  </div>
                  <div className="result-path mono" title={source.path}>
                    {source.path} · modified {formatDate(source.modifiedAt)}
                  </div>
                  <div className="result-snippet">{source.snippet}</div>
                </div>
                <button type="button" className="btn" onClick={() => setPreview(source)}>
                  Preview
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {preview && (
        <aside className="ask-preview">
          <PreviewPane path={preview.path} />
        </aside>
      )}
    </div>
  );
}
