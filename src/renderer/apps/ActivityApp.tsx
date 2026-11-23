import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { AuditRecord, ToolDescriptor } from '../../shared/protocol';
import { ConfirmButton } from '../components/ConfirmButton';
import { formatDateTime } from '../lib/format';
import { AppTabs, Banners, useRunner } from './appKit';
import type { ShellAppProps } from './types';

type Tab = 'audit' | 'tools';

const TIER_LABEL = {
  read: 'Read-only',
  low: 'Reversible change',
  medium: 'Medium impact',
  high: 'High impact',
} as const;

export function ActivityApp(_props: ShellAppProps): ReactElement {
  const api = window.aios;
  const [tab, setTab] = useState<Tab>('audit');
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [tools, setTools] = useState<ToolDescriptor[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!api) return;
    const [nextRecords, nextTools] = await Promise.all([api.audit.list(), api.listTools()]);
    setRecords(nextRecords);
    setTools(nextTools);
  }, [api]);
  const { error, notice, setError, run } = useRunner(reload);

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [reload, setError]);

  if (!api) return <div className="app-pad banner error">Backend bridge unavailable.</div>;

  return (
    <div className="mem">
      <AppTabs
        tabs={[
          ['audit', `Audit log · ${records.length}`],
          ['tools', `Tools · ${tools.length}`],
        ]}
        value={tab}
        onChange={setTab}
        trailing={
          <>
            <button type="button" className="btn" onClick={() => void run(async () => undefined)}>
              Refresh
            </button>
            {tab === 'audit' && (
              <ConfirmButton
                label="Clear log"
                confirmLabel="Clear all records"
                disabled={records.length === 0}
                onConfirm={() => void run(() => api.audit.clear(), 'Audit log cleared.')}
              />
            )}
          </>
        }
      />
      <Banners error={error} notice={notice} />
      <div className="tab-body">
        {tab === 'audit' && (
          <>
            {records.length === 0 && (
              <div className="empty">
                No tool calls yet. Every call JARVIS makes is recorded here.
              </div>
            )}
            {records.map((record) => (
              <div key={record.id} className={`audit-row ${record.outcome}`}>
                <button
                  type="button"
                  className="audit-main"
                  onClick={() => setOpen(open === record.id ? null : record.id)}
                >
                  <span className="audit-outcome">{record.outcome.replace('_', ' ')}</span>
                  <strong>{record.tool}</strong>
                  <span className="muted">{formatDateTime(record.at)}</span>
                  <span className="muted">{record.durationMs} ms</span>
                </button>
                {record.detail && <div className="list-sub">{record.detail}</div>}
                {open === record.id && (
                  <div className="audit-detail">
                    <div>
                      Risk: {TIER_LABEL[record.riskTier]} · Approval:{' '}
                      {record.approval.replace('_', ' ')}
                    </div>
                    <div>Permissions: {record.permissions.join(', ') || 'none'}</div>
                    <div>
                      Arguments: <code>{record.args}</code>
                    </div>
                    <ol>
                      {record.stages.map((stage, index) => (
                        <li key={index}>
                          {stage.stage}
                          {stage.note ? ` — ${stage.note}` : ''}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
        {tab === 'tools' &&
          tools.map((tool) => (
            <div key={tool.name} className="list-row">
              <div className="list-main">
                <div className="list-title">
                  {tool.name} <span className="muted">· {TIER_LABEL[tool.riskTier ?? 'read']}</span>
                </div>
                <div className="list-sub">{tool.description}</div>
                <div className="list-sub">
                  {(tool.permissions ?? []).join(', ') || 'no permissions'} · timeout{' '}
                  {Math.round((tool.timeoutMs ?? 0) / 1000)} s
                  {tool.needsApproval ? ' · asks before every use' : ''}
                </div>
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={tool.enabled !== false}
                  onChange={(event) =>
                    void run(() => api.tools.setEnabled(tool.name, event.target.checked))
                  }
                />
                Enabled
              </label>
            </div>
          ))}
      </div>
    </div>
  );
}
