import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { CleanupActionId, RestorePreview, StorageReport } from '../../../shared/platform';
import { ConfirmButton } from '../../components/ConfirmButton';
import { errorText, formatSize } from '../../lib/format';

export function StoragePanel(): ReactElement {
  const api = window.aios;
  const [report, setReport] = useState<StorageReport | null>(null);
  const [selected, setSelected] = useState<Set<CleanupActionId>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<RestorePreview | null>(null);

  const reload = useCallback(async () => {
    if (!api) return;
    try {
      const next = await api.storage.report();
      setReport(next);
      setSelected(
        (previous) =>
          new Set(
            next.actions
              .filter(
                (action) => action.items > 0 && (previous.size === 0 || previous.has(action.id)),
              )
              .map((action) => action.id),
          ),
      );
    } catch (err) {
      setError(errorText(err));
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!api) return <div className="banner error">Backend bridge unavailable.</div>;

  const guard = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const reclaimable = report
    ? report.actions.filter((a) => selected.has(a.id)).reduce((sum, a) => sum + a.bytes, 0)
    : 0;

  return (
    <>
      {error && <div className="banner error">{error}</div>}
      {notice && !error && <div className="banner ok">{notice}</div>}

      <section className="card">
        <h3>Memory (RAM)</h3>
        <p>
          AI OS is using about <strong>{report ? `${report.processMemoryMb} MB` : '…'}</strong>.
          {report?.speechModelLoaded
            ? ' The speech model is loaded (it is the largest part).'
            : ' The speech model is not loaded.'}
        </p>
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void guard(async () => {
                await api.storage.freeMemory();
                setNotice('Freed the speech model and temporary caches. They reload when needed.');
                await reload();
              })
            }
          >
            Free memory now
          </button>
        </div>
        <p className="hint">
          The speech model also unloads by itself after 90 seconds of inactivity, except while
          “Jarvis” listening is on.
        </p>
      </section>

      <section className="card">
        <h3>Storage</h3>
        <p>
          AI OS data uses <strong>{report ? formatSize(report.totalBytes) : '…'}</strong>.
        </p>
        <table className="table">
          <tbody>
            {report?.rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="mono">{formatSize(row.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Clean up</h3>
        <p className="hint">Nothing is removed until you press the button. Pick what to clean:</p>
        {report?.actions.map((action) => (
          <label key={action.id} className="check cleanup-row">
            <input
              type="checkbox"
              checked={selected.has(action.id)}
              disabled={action.items === 0}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(action.id);
                else next.delete(action.id);
                setSelected(next);
              }}
            />
            <span>
              {action.label} — {action.items} item{action.items === 1 ? '' : 's'}
              {action.bytes > 0 ? `, about ${formatSize(action.bytes)}` : ''}
              <span className="hint"> {action.description}</span>
            </span>
          </label>
        ))}
        <div className="row">
          <ConfirmButton
            label={`Clean up selected (${formatSize(reclaimable)})`}
            confirmLabel="Yes, clean up"
            disabled={busy || selected.size === 0}
            onConfirm={() =>
              void guard(async () => {
                const result = await api.storage.cleanup([...selected]);
                setNotice(
                  result.ok
                    ? `Cleaned ${result.removedItems} item(s); about ${formatSize(result.freedBytes)} freed.`
                    : `Finished with problems: ${result.errors.join(' ')}`,
                );
                await reload();
              })
            }
          />
        </div>
      </section>

      <section className="card">
        <h3>Backup &amp; restore</h3>
        <p className="hint">
          A backup is one file with your memory, notes, tasks, calendar, finance, mail and
          conversations. It never includes permissions, so a backup cannot switch your microphone or
          camera on.
        </p>
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void guard(async () => {
                const result = await api.storage.exportBackup();
                if (result.canceled) return;
                setNotice(
                  result.ok
                    ? `Backup saved (${result.files?.length ?? 0} data files): ${result.path}`
                    : (result.error ?? 'The backup failed.'),
                );
              })
            }
          >
            Create backup…
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void guard(async () => {
                const result = await api.storage.chooseBackup();
                if (result.canceled) return;
                if (!result.ok) throw new Error(result.error ?? 'That file cannot be restored.');
                setRestore(result);
              })
            }
          >
            Restore from backup…
          </button>
        </div>
        {restore?.ok && restore.token && (
          <div className="banner warn">
            <p>
              This backup (
              {restore.createdAt ? new Date(restore.createdAt).toLocaleString() : 'unknown date'})
              has {restore.files?.length} data file(s). Restoring <strong>replaces</strong> your
              current data and restarts AI OS. A safety copy of what you have now is kept first.
            </p>
            <div className="row">
              <ConfirmButton
                label="Restore this backup"
                confirmLabel="Yes, replace my data"
                onConfirm={() =>
                  void guard(async () => {
                    const token = restore.token as string;
                    setRestore(null);
                    const done = await api.storage.restoreBackup(token);
                    setNotice(`Restored ${done.restored.length} file(s). Restarting…`);
                  })
                }
              />
              <button type="button" className="btn ghost" onClick={() => setRestore(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Delete everything</h3>
        <p className="hint">
          Removes all AI OS data on this computer (memory, notes, tasks, calendar, finance, mail,
          photos, conversations, activity log, settings) and restarts. Create a backup first if you
          might want it.
        </p>
        <div className="row">
          <ConfirmButton
            label="Delete all my data"
            confirmLabel="Yes, delete everything"
            disabled={busy}
            onConfirm={() =>
              void guard(async () => {
                await api.storage.wipeAll('DELETE');
                setNotice('Everything was deleted. Restarting…');
              })
            }
          />
        </div>
      </section>
    </>
  );
}
