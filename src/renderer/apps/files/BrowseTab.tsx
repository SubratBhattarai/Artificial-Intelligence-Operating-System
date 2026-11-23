import { useCallback, useEffect, useRef, useState } from 'react';
import type { FolderEntry, FolderListing } from '../../../shared/protocol';
import { errorText, formatDate, formatSize, joinPath, pathSegments } from '../../lib/format';
import type { FileIndexController } from './useFileIndex';
import { PreviewPane } from './PreviewPane';

function kindOf(entry: FolderEntry): string {
  if (entry.type === 'directory') return 'Folder';
  const dot = entry.name.lastIndexOf('.');
  return dot > 0 ? `${entry.name.slice(dot + 1).toUpperCase()} file` : 'File';
}

function statusLabel(entry: FolderEntry): { text: string; tone: string } | null {
  switch (entry.indexStatus) {
    case 'indexed':
      return { text: 'indexed', tone: 'ok' };
    case 'unreadable':
      return { text: 'unreadable', tone: 'bad' };
    case 'skipped':
      return { text: 'skipped', tone: 'warn' };
    case 'unsupported':
      return { text: 'name only', tone: 'muted' };
    default:
      return null;
  }
}

export function BrowseTab({
  index,
  initialPath,
}: {
  index: FileIndexController;
  initialPath?: string | null;
}) {
  const api = window.aios;
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [selected, setSelected] = useState<FolderEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (target?: string) => {
      if (!api) return;
      setLoading(true);
      setError(null);
      try {
        const next = await api.listFolder(target);
        setListing(next);
        setSelected(null);
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    void load(initialPath ?? undefined);
  }, [load, initialPath]);

  // Re-annotate index status when an indexing run finishes.
  const phase = index.progress?.phase;
  const previousPhase = useRef(phase);
  const currentPath = useRef<string | undefined>(undefined);
  currentPath.current = listing?.path;
  useEffect(() => {
    if (previousPhase.current === 'scanning' && phase !== 'scanning')
      void load(currentPath.current);
    previousPhase.current = phase;
  }, [phase, load]);

  if (!listing && loading) return <div className="app-pad muted">Loading…</div>;

  const roots = listing?.roots ?? [];
  const indexedFolders = new Set(
    (index.overview?.folders ?? []).map((folder) => folder.path.toLowerCase()),
  );
  const currentRoot = listing
    ? roots.find((root) => listing.path.toLowerCase().startsWith(root.toLowerCase()))
    : undefined;
  const crumbs = listing
    ? pathSegments(listing.path).filter((segment) =>
        currentRoot
          ? segment.path.toLowerCase().length >=
            currentRoot.toLowerCase().replace(/[\\/]$/, '').length
          : true,
      )
    : [];
  const selectedPath =
    listing && selected && selected.type === 'file' ? joinPath(listing.path, selected.name) : null;

  return (
    <div className="finder">
      <aside className="finder-side">
        <div className="side-title">Places</div>
        {roots.map((root) => {
          const label = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
          const active = currentRoot === root;
          return (
            <button
              key={root}
              type="button"
              className={`side-item ${active ? 'active' : ''}`}
              onClick={() => void load(root)}
              title={root}
            >
              <span className="side-icon">▸</span>
              <span className="side-label">{label}</span>
              {indexedFolders.has(root.toLowerCase()) && (
                <span className="side-dot" title="Indexed" />
              )}
            </button>
          );
        })}
        <button type="button" className="side-item add" onClick={() => void index.addFolder()}>
          <span className="side-icon">＋</span>
          <span className="side-label">Add folder…</span>
        </button>
        <p className="hint side-hint">
          You choose which folders AI OS can see. Chosen folders are also indexed for search.
        </p>
      </aside>

      <section className="finder-main">
        <div className="finder-bar">
          <button
            type="button"
            className="btn"
            disabled={!listing?.parent}
            onClick={() => void load(listing?.parent ?? undefined)}
          >
            ↑ Up
          </button>
          <div className="crumbs" aria-label="Path">
            {crumbs.map((segment, position) => (
              <span key={segment.path} className="crumb-wrap">
                {position > 0 && <span className="crumb-sep">›</span>}
                <button
                  type="button"
                  className="crumb"
                  onClick={() => void load(segment.path)}
                  disabled={position === crumbs.length - 1}
                >
                  {segment.label}
                </button>
              </span>
            ))}
          </div>
          <button
            type="button"
            className="btn ghost"
            onClick={() => listing && void load(listing.path)}
          >
            Refresh
          </button>
        </div>

        {error && <div className="banner error">{error}</div>}

        <div className="finder-table-wrap">
          {listing && (
            <table className="finder-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Modified</th>
                  <th>Size</th>
                  <th>Kind</th>
                  <th>Index</th>
                </tr>
              </thead>
              <tbody>
                {listing.entries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      This folder is empty.
                    </td>
                  </tr>
                )}
                {listing.entries.map((entry) => {
                  const status = statusLabel(entry);
                  return (
                    <tr
                      key={entry.name}
                      className={selected?.name === entry.name ? 'selected' : ''}
                      onClick={() => setSelected(entry)}
                      onDoubleClick={() => {
                        if (entry.type === 'directory')
                          void load(joinPath(listing.path, entry.name));
                      }}
                    >
                      <td className="name-cell">
                        <span className={`file-glyph ${entry.type}`}>
                          {entry.type === 'directory' ? '▣' : '▤'}
                        </span>
                        {entry.name}
                      </td>
                      <td>{entry.modifiedAt ? formatDate(entry.modifiedAt) : '—'}</td>
                      <td>{entry.type === 'file' ? formatSize(entry.size) : '—'}</td>
                      <td>{kindOf(entry)}</td>
                      <td>
                        {status ? (
                          <span className={`status-tag ${status.tone}`} title={entry.indexReason}>
                            {status.text}
                          </span>
                        ) : (
                          ''
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {listing?.truncated && <p className="hint pad">Showing the first entries only.</p>}
        </div>
      </section>

      <aside className="finder-preview">
        {selected?.type === 'directory' ? (
          <div className="preview empty">Double-click the folder to open it.</div>
        ) : (
          <PreviewPane
            path={selectedPath}
            indexStatus={selected?.indexStatus}
            indexReason={selected?.indexReason}
          />
        )}
      </aside>
    </div>
  );
}
