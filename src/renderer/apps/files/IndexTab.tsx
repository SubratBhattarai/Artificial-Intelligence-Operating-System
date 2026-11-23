import { ConfirmButton } from '../../components/ConfirmButton';
import { formatDateTime, formatRelative, formatSize } from '../../lib/format';
import type { FileIndexController } from './useFileIndex';

export function IndexTab({ index }: { index: FileIndexController }) {
  const { overview, progress, busy } = index;
  const totals = overview?.totals;

  return (
    <div className="stack">
      {index.error && <div className="banner error">{index.error}</div>}

      <section className="card">
        <div className="card-head">
          <h3>Indexed folders</h3>
          <button type="button" className="btn primary" onClick={() => void index.addFolder()}>
            Add folder…
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || (overview?.folders.length ?? 0) === 0}
            onClick={() => void index.reindex()}
          >
            Re-index all
          </button>
        </div>
        {(overview?.folders.length ?? 0) === 0 && (
          <p className="empty">
            Nothing is indexed. AI OS only reads folders you choose here — never anything else.
          </p>
        )}
        <ul className="mem-list">
          {(overview?.folders ?? []).map((folder) => (
            <li key={folder.path} className="mem-item">
              <div className="mem-main">
                <div className="mem-fact mono">{folder.path}</div>
                <div className="mem-meta">
                  added {formatRelative(folder.addedAt)} ·{' '}
                  {folder.lastIndexedAt
                    ? `indexed ${formatDateTime(folder.lastIndexedAt)}`
                    : 'not indexed yet'}
                </div>
              </div>
              <div className="mem-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void index.reindex(folder.path)}
                >
                  Re-index
                </button>
                <ConfirmButton
                  label="Remove"
                  confirmLabel="Stop & forget"
                  onConfirm={() => void index.removeFolder(folder.path)}
                />
              </div>
            </li>
          ))}
        </ul>
        <p className="hint">
          Removing a folder only deletes AI OS’s index of it. Your files are never touched. Files
          that are online-only in OneDrive are downloaded when they are indexed.
        </p>
      </section>

      {progress && progress.phase !== 'idle' && (
        <section className="card">
          <h3>
            {progress.phase === 'scanning' && 'Indexing…'}
            {progress.phase === 'done' && 'Last run finished'}
            {progress.phase === 'cancelled' && 'Last run was stopped'}
            {progress.phase === 'error' && 'Last run failed'}
          </h3>
          {progress.phase === 'scanning' && (
            <div className="progress-bar">
              <span />
            </div>
          )}
          <p className="hint mono">{progress.folder}</p>
          <p>
            {progress.scanned} files checked · {progress.indexed} new or changed ·{' '}
            {progress.unchanged} unchanged · {progress.unreadable} unreadable · {progress.removed}{' '}
            removed
          </p>
          {progress.message && <p className="hint">{progress.message}</p>}
          {busy && (
            <button type="button" className="btn danger" onClick={() => void index.cancel()}>
              Stop indexing
            </button>
          )}
        </section>
      )}

      {totals && totals.files > 0 && (
        <section className="stat-grid">
          {(
            [
              ['Files known', totals.files],
              ['Searchable', totals.indexed],
              ['Passages', totals.chunks],
              ['Duplicate groups', totals.duplicateGroups],
              ['Name only', totals.unsupported],
              ['Skipped', totals.skipped],
              ['Unreadable', totals.unreadable],
            ] as Array<[string, number]>
          ).map(([label, value]) => (
            <div key={label} className="stat">
              <div className="stat-value">{value.toLocaleString()}</div>
              <div className="stat-label">{label}</div>
            </div>
          ))}
        </section>
      )}

      {(overview?.problems.length ?? 0) > 0 && (
        <section className="card attention">
          <h3>Files that could not be read · {overview?.problems.length}</h3>
          <p className="hint">
            These are left out of search and answers until the problem is fixed.
          </p>
          <ul className="mem-list">
            {overview?.problems.map((file) => (
              <li key={file.id} className="mem-item">
                <div className="mem-main">
                  <div className="mem-fact">{file.name}</div>
                  <div className="mem-meta mono">{file.path}</div>
                  <div className="mem-meta">
                    {file.status} — {file.reason ?? 'unknown reason'} · {formatSize(file.size)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
