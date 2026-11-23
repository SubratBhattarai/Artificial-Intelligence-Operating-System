import { useCallback, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { ImportResult } from '../../shared/apps';
import type { ExportResult } from '../../shared/protocol';
import { errorText } from '../lib/format';

/** Shared behaviour for the Phase 7 apps: one consistent error/notice banner and tab bar. */
export function useRunner(reload: () => Promise<void> | void) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(
    async (action: () => Promise<unknown>, success?: string) => {
      setError(null);
      try {
        await action();
        setNotice(success ?? null);
        await reload();
      } catch (err) {
        setNotice(null);
        setError(errorText(err));
      }
    },
    [reload],
  );

  return { error, notice, setError, setNotice, run };
}

export function Banners({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error && <div className="banner error">{error}</div>}
      {notice && !error && <div className="banner ok">{notice}</div>}
    </>
  );
}

export function AppTabs<T extends string>({
  tabs,
  value,
  onChange,
  trailing,
}: {
  tabs: Array<[T, string]>;
  value: T;
  onChange: (tab: T) => void;
  trailing?: ReactNode;
}): ReactElement {
  return (
    <nav className="tabs" role="tablist">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          className={`tab ${value === id ? 'active' : ''}`}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
      {trailing && <span className="tabs-spacer" />}
      {trailing}
    </nav>
  );
}

export function describeImport(result: ImportResult): string {
  if (result.canceled) return '';
  if (!result.ok) return result.error ?? 'Import failed.';
  const skipped = result.skipped ? `, skipped ${result.skipped}` : '';
  return `Imported ${result.imported}${skipped}.${result.notes.length ? ` ${result.notes[0]}` : ''}`;
}

export function describeExport(result: ExportResult): string {
  if (result.canceled) return '';
  if (!result.ok) return result.error ?? 'Export failed.';
  return `Exported to ${result.path}`;
}

export function todayString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
