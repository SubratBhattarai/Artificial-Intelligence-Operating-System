import { useEffect, useState } from 'react';
import type { FilePreview, IndexStatus } from '../../../shared/protocol';
import { errorText, formatDateTime, formatSize } from '../../lib/format';

interface PreviewPaneProps {
  path: string | null;
  indexStatus?: IndexStatus | null;
  indexReason?: string;
  query?: string;
}

/** Read-only preview with explicit Open / Show in folder actions. Nothing is ever modified. */
export function PreviewPane({ path, indexStatus, indexReason }: PreviewPaneProps) {
  const api = window.aios;
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setMessage(null);
    if (!api || !path) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.files
      .preview(path)
      .then((value) => {
        if (!cancelled) setPreview(value);
      })
      .catch((err) => {
        if (!cancelled) {
          setPreview({
            path,
            name: path.split(/[\\/]/).pop() ?? path,
            size: 0,
            modifiedAt: 0,
            kind: 'error',
            error: errorText(err),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, path]);

  if (!path) return <div className="preview empty">Select a file to preview it.</div>;

  const act = async (action: 'open' | 'reveal') => {
    if (!api) return;
    setMessage(null);
    try {
      await (action === 'open' ? api.files.open(path) : api.files.reveal(path));
    } catch (err) {
      setMessage(errorText(err));
    }
  };

  return (
    <div className="preview">
      <div className="preview-head">
        <div className="preview-name" title={path}>
          {preview?.name ?? path.split(/[\\/]/).pop()}
        </div>
        {preview && (
          <div className="preview-meta">
            {formatSize(preview.size)} · modified {formatDateTime(preview.modifiedAt)}
          </div>
        )}
        <div className="preview-path mono" title={path}>
          {path}
        </div>
        <div className="row">
          <button type="button" className="btn primary" onClick={() => void act('open')}>
            Open
          </button>
          <button type="button" className="btn" onClick={() => void act('reveal')}>
            Show in folder
          </button>
        </div>
        {message && <div className="banner error">{message}</div>}
      </div>

      {indexStatus && indexStatus !== 'indexed' && (
        <div className="banner warn">
          {indexStatus === 'unsupported' ? 'Not searchable by content' : 'Could not be read'}
          {indexReason ? ` — ${indexReason}` : ''}
        </div>
      )}

      <div className="preview-body">
        {loading && <p className="empty">Loading preview…</p>}
        {!loading && preview?.kind === 'text' && (
          <>
            <pre className="preview-text">{preview.text}</pre>
            {preview.truncated && (
              <p className="hint">Preview shortened — open the file to see all of it.</p>
            )}
          </>
        )}
        {!loading && preview?.kind === 'image' && preview.dataUrl && (
          <img className="preview-image" src={preview.dataUrl} alt={preview.name} />
        )}
        {!loading && (preview?.kind === 'unsupported' || preview?.kind === 'error') && (
          <p className="empty">{preview.error}</p>
        )}
      </div>
      <p className="hint preview-foot">Read-only: AI OS never changes your files.</p>
    </div>
  );
}
