import { useState } from 'react';
import type { DragEvent, ReactElement } from 'react';
import { errorText } from '../lib/format';
import { useChat } from '../state/chatStore';
import { usePermissions } from '../state/permissionStore';
import { Banners } from './appKit';

interface DroppedDoc {
  path: string;
  name: string;
}

const SUPPORTED = /\.(pdf|docx|xlsx|pptx|txt|md|csv|json|png|jpe?g|bmp|gif|webp)$/i;

function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/** Drop documents here; then ask JARVIS to summarize, extract from, question or compare them. */
export function DocumentsApp(): ReactElement {
  const api = window.aios;
  const files = usePermissions((state) => state.levels.files);
  const { send, status, messages } = useChat();
  const [docs, setDocs] = useState<DroppedDoc[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [question, setQuestion] = useState('');
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reply = [...messages].reverse().find((m) => m.role === 'assistant');
  const busy = status === 'streaming';

  const onDrop = async (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (!api) return;
    try {
      const paths = [...event.dataTransfer.files]
        .map((file) => api.files.pathFor(file))
        .filter(Boolean);
      const skipped = paths.filter((p) => !SUPPORTED.test(p));
      const accepted = await api.files.allowDropped(paths.filter((p) => SUPPORTED.test(p)));
      setDocs((current) => [
        ...current,
        ...accepted
          .filter((p) => !current.some((d) => d.path === p))
          .map((p) => ({ path: p, name: baseName(p) })),
      ]);
      setError(null);
      setNotice(
        skipped.length ? `${skipped.length} file(s) skipped: that type is not readable.` : null,
      );
    } catch (err) {
      setError(errorText(err));
    }
  };

  const ask = (prompt: string) => {
    if (files === 'off') {
      setError('Allow “Files” in Settings › Permissions so JARVIS can read the documents.');
      return;
    }
    setError(null);
    void send(prompt);
  };

  const toggle = (docPath: string) =>
    setPicked((current) =>
      current.includes(docPath)
        ? current.filter((p) => p !== docPath)
        : [...current.slice(-1), docPath],
    );

  return (
    <div className="app-pad">
      <Banners error={error} notice={notice} />
      <div
        className={`drop-zone ${over ? 'over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => void onDrop(event)}
      >
        <strong>Drop documents here</strong>
        <span className="hint">
          PDF, Word, Excel, PowerPoint, text, CSV or images with text. JARVIS can read only the
          files you drop, and only until AI OS closes.
        </span>
      </div>
      {docs.length > 0 && (
        <section className="card">
          <h4>Your documents</h4>
          {docs.map((doc) => (
            <div key={doc.path} className="row">
              <label>
                <input
                  type="checkbox"
                  checked={picked.includes(doc.path)}
                  onChange={() => toggle(doc.path)}
                />{' '}
                {doc.name}
              </label>
              <span className="hud-spacer" />
              <button
                type="button"
                className="btn compact"
                disabled={busy}
                onClick={() =>
                  ask(
                    `Summarize the document "${doc.path}" in a few clear points. Use the read_document tool.`,
                  )
                }
              >
                Summarize
              </button>
              <button
                type="button"
                className="btn compact"
                disabled={busy}
                onClick={() =>
                  ask(
                    `Extract the key facts from "${doc.path}": names, dates, amounts, deadlines and action items. Use the read_document tool.`,
                  )
                }
              >
                Extract
              </button>
              <button
                type="button"
                className="btn compact"
                onClick={() => {
                  setDocs(docs.filter((d) => d.path !== doc.path));
                  setPicked(picked.filter((p) => p !== doc.path));
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={busy || picked.length !== 2}
              onClick={() =>
                ask(
                  `Compare "${picked[0]}" with "${picked[1]}": what is the same and what differs? Use the compare_documents tool.`,
                )
              }
            >
              Compare the two ticked
            </button>
          </div>
          <div className="form-row">
            <label>Ask a question about the documents</label>
            <textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} />
          </div>
          <div className="row">
            <button
              type="button"
              className="btn primary"
              disabled={busy || !question.trim()}
              onClick={() => {
                const targets = (picked.length ? picked : docs.map((d) => d.path))
                  .map((p) => `"${p}"`)
                  .join(', ');
                ask(
                  `Answer this using only these documents (${targets}) via read_document, and say where in the document you found it: ${question.trim()}`,
                );
                setQuestion('');
              }}
            >
              Ask
            </button>
          </div>
        </section>
      )}
      {reply && reply.content && (
        <section className="card">
          <h4>JARVIS</h4>
          <pre className="mail-body">{reply.content}</pre>
        </section>
      )}
    </div>
  );
}
