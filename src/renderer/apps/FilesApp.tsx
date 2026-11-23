import { useState } from 'react';
import type { ReactElement } from 'react';
import { AskTab } from './files/AskTab';
import { BrowseTab } from './files/BrowseTab';
import { IndexTab } from './files/IndexTab';
import { SearchTab } from './files/SearchTab';
import { useFileIndex } from './files/useFileIndex';
import type { ShellAppProps } from './types';

type Tab = 'browse' | 'search' | 'ask' | 'index';

const TABS: Array<[Tab, string]> = [
  ['browse', 'Browse'],
  ['search', 'Search'],
  ['ask', 'Ask documents'],
  ['index', 'Index'],
];

/** Finder-style file browser with explicit folder selection, content search and cited Q&A. */
export function FilesApp(_props: ShellAppProps): ReactElement {
  const [tab, setTab] = useState<Tab>('browse');
  const index = useFileIndex();

  if (!window.aios) return <div className="app-pad banner error">Backend bridge unavailable.</div>;

  const scanning = index.progress?.phase === 'scanning';

  return (
    <div className="files2">
      <nav className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <span className="tabs-spacer" />
        {scanning && (
          <span className="scan-chip" title={index.progress?.folder ?? ''}>
            <span className="spinner" /> indexing · {index.progress?.scanned ?? 0} files
          </span>
        )}
        <span className="pill ok">read-only</span>
      </nav>
      <div className="tab-body flush">
        {tab === 'browse' && <BrowseTab index={index} />}
        {tab === 'search' && <SearchTab index={index} />}
        {tab === 'ask' && <AskTab index={index} />}
        {tab === 'index' && <IndexTab index={index} />}
      </div>
    </div>
  );
}
