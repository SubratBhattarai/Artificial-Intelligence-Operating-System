import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  ACTIVE_AGENT_STATUSES,
  type AgentRecord,
  type MonitorRecord,
  type ReportRecord,
} from '../../shared/agents';
import { ApprovalCard } from '../components/ApprovalCard';
import { ConfirmButton } from '../components/ConfirmButton';
import { formatDateTime, formatRelative } from '../lib/format';
import { useAgents } from '../state/agentStore';
import { usePermissions } from '../state/permissionStore';
import { MissionsTab } from './MissionsTab';
import { AppTabs, Banners, useRunner } from './appKit';

type Tab = 'missions' | 'live' | 'new' | 'monitors' | 'reports';

const STATUS_LABEL: Record<AgentRecord['status'], string> = {
  queued: 'Queued',
  running: 'Working',
  waiting_approval: 'Needs your approval',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
};

function AgentCard({ agent }: { agent: AgentRecord }): ReactElement {
  const cancel = useAgents((state) => state.cancel);
  const approvals = useAgents((state) => state.approvals[agent.id] ?? []);
  const active = ACTIVE_AGENT_STATUSES.includes(agent.status);
  const [open, setOpen] = useState(active);
  const recent = (open ? agent.steps : agent.steps.slice(-2)).slice(-12);
  return (
    <article className={`agent-card ${agent.status}`}>
      <header>
        <span className={`agent-dot ${agent.status}`} aria-hidden />
        <strong className="agent-goal">{agent.goal}</strong>
        <span className="hint">
          {agent.kind === 'research' ? 'Research' : 'Task'} · {STATUS_LABEL[agent.status]} ·{' '}
          {formatRelative(agent.updatedAt)}
        </span>
        {active && (
          <button type="button" className="btn compact" onClick={() => void cancel(agent.id)}>
            Stop
          </button>
        )}
      </header>
      {approvals.map((approval) => (
        <ApprovalCard key={approval.id} approval={approval} />
      ))}
      <ul className="agent-steps">
        {recent.map((step, index) => (
          <li key={`${step.at}-${index}`} className={step.kind}>
            {step.text}
          </li>
        ))}
      </ul>
      {agent.error && <p className="hint">{agent.error}</p>}
      <button type="button" className="btn compact ghost" onClick={() => setOpen(!open)}>
        {open ? 'Show less' : 'Show all steps'}
      </button>
    </article>
  );
}

function LiveTab(): ReactElement {
  const agents = useAgents((state) => state.agents);
  const clearFinished = useAgents((state) => state.clearFinished);
  const active = agents.filter((a) => ACTIVE_AGENT_STATUSES.includes(a.status));
  const finished = agents.filter((a) => !ACTIVE_AGENT_STATUSES.includes(a.status));
  return (
    <>
      <p className="hint">
        {active.length === 0
          ? 'No agents are working right now.'
          : `${active.length} agent${active.length === 1 ? ' is' : 's are'} working. Up to 3 run at once.`}
      </p>
      <div className="agent-grid">
        {active.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
      {finished.length > 0 && (
        <>
          <div className="row">
            <h4>Finished</h4>
            <span className="hud-spacer" />
            <ConfirmButton
              label="Clear finished"
              confirmLabel="Yes, clear"
              onConfirm={() => void clearFinished()}
            />
          </div>
          <div className="agent-grid">
            {finished.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function NewTab({ onStarted }: { onStarted: () => void }): ReactElement {
  const start = useAgents((state) => state.start);
  const [goal, setGoal] = useState('');
  const [kind, setKind] = useState<'research' | 'task'>('research');
  const [error, setError] = useState<string | null>(null);
  const web = usePermissions((state) => state.levels.web);
  return (
    <section className="card">
      <h3>Start an agent</h3>
      <p className="hint">
        An agent works on its own while AI OS is open, using only the tools you have allowed in
        Settings › Permissions. Anything that changes something waits for your approval.
        {kind === 'research' && web !== 'read'
          ? ' Research needs Web access to read pages; it is off right now.'
          : ''}
      </p>
      <div className="seg" role="radiogroup" aria-label="Agent type">
        {(['research', 'task'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={kind === id}
            className={`seg-btn ${kind === id ? 'active' : ''}`}
            onClick={() => setKind(id)}
          >
            {id === 'research' ? 'Research a topic' : 'Complete a task'}
          </button>
        ))}
      </div>
      <textarea
        rows={4}
        value={goal}
        maxLength={1000}
        placeholder={
          kind === 'research'
            ? 'e.g. Compare the main approaches to quantized speech models and summarise the trade-offs'
            : 'e.g. Go through my open tasks and draft a study schedule for this week'
        }
        onChange={(event) => setGoal(event.target.value)}
      />
      {error && <div className="banner error">{error}</div>}
      <div className="row">
        <button
          type="button"
          className="btn primary"
          disabled={goal.trim().length < 5}
          onClick={() => {
            setError(null);
            void start(goal, kind).then(
              () => {
                setGoal('');
                onStarted();
              },
              (err: unknown) =>
                setError(err instanceof Error ? err.message : 'Could not start the agent.'),
            );
          }}
        >
          Start
        </button>
      </div>
    </section>
  );
}

function MonitorsTab(): ReactElement {
  const api = window.aios;
  const [monitors, setMonitors] = useState<MonitorRecord[]>([]);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [minutes, setMinutes] = useState(60);
  const web = usePermissions((state) => state.levels.web);
  const reload = useCallback(async () => {
    if (api) setMonitors(await api.monitors.list());
  }, [api]);
  const { error, notice, setError, run } = useRunner(reload);
  useEffect(() => {
    void reload().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : 'Could not load monitors.'),
    );
  }, [reload, setError]);
  if (!api) return <div className="banner error">Backend bridge unavailable.</div>;
  return (
    <>
      <Banners error={error} notice={notice} />
      <p className="hint">
        Monitors check a public page while AI OS is open and tell you when its text changes.
        {web !== 'read'
          ? ' Web access is off in Settings › Permissions, so checks are paused.'
          : ''}
      </p>
      <section className="card">
        <div className="form-row">
          <label>Address</label>
          <input value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Name</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Check every</label>
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {[5, 15, 30, 60, 180, 720, 1440].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={!url.trim()}
            onClick={() =>
              void run(async () => {
                await api.monitors.add({ url, label, intervalMinutes: minutes });
                setUrl('');
                setLabel('');
              }, 'Now watching that page.')
            }
          >
            Watch this page
          </button>
        </div>
      </section>
      {monitors.map((monitor) => (
        <section key={monitor.id} className="card">
          <h3>
            {monitor.label} {monitor.unseenChange && <span className="bell-tag">Changed</span>}
          </h3>
          <p className="hint mono">{monitor.url}</p>
          <p className="hint">
            Every {monitor.intervalMinutes} min ·{' '}
            {monitor.lastChecked
              ? `last checked ${formatRelative(monitor.lastChecked)}`
              : 'not checked yet'}
            {monitor.lastChange ? ` · last change ${formatDateTime(monitor.lastChange)}` : ''}
          </p>
          {monitor.changeSummary && <p>{monitor.changeSummary}</p>}
          {monitor.error && <p className="hint">Last check failed: {monitor.error}</p>}
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={() => void run(() => api.monitors.check(monitor.id), 'Checked.')}
            >
              Check now
            </button>
            {monitor.unseenChange && (
              <button
                type="button"
                className="btn"
                onClick={() => void run(() => api.monitors.seen(monitor.id))}
              >
                Mark seen
              </button>
            )}
            <ConfirmButton
              label="Stop watching"
              confirmLabel="Yes, remove"
              onConfirm={() => void run(() => api.monitors.remove(monitor.id))}
            />
          </div>
        </section>
      ))}
    </>
  );
}

function ReportsTab(): ReactElement {
  const api = window.aios;
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (api) setReports(await api.reports.list());
  }, [api]);
  const { error, notice, setError, setNotice, run } = useRunner(reload);
  const agents = useAgents((state) => state.agents);
  useEffect(() => {
    void reload().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : 'Could not load reports.'),
    );
  }, [reload, setError, agents]);
  if (!api) return <div className="banner error">Backend bridge unavailable.</div>;
  const open = reports.find((report) => report.id === openId);
  return (
    <>
      <Banners error={error} notice={notice} />
      {open ? (
        <section className="card">
          <h3>{open.title}</h3>
          <p className="hint">{formatDateTime(open.createdAt)}</p>
          <pre className="mail-body">{open.body}</pre>
          <div className="row">
            <button type="button" className="btn" onClick={() => setOpenId(null)}>
              Back
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void run(async () => {
                  const r = await api.reports.export(open.id);
                  if (!r.canceled) setNotice(`Saved to ${r.path ?? 'your computer'}.`);
                })
              }
            >
              Save as .md…
            </button>
            <ConfirmButton
              label="Delete"
              confirmLabel="Yes, delete"
              onConfirm={() =>
                void run(async () => {
                  await api.reports.remove(open.id);
                  setOpenId(null);
                })
              }
            />
          </div>
        </section>
      ) : reports.length === 0 ? (
        <p className="hint">No reports yet. Research agents save their findings here.</p>
      ) : (
        <ul className="mail-list">
          {reports.map((report) => (
            <li key={report.id}>
              <button type="button" className="mail-item" onClick={() => setOpenId(report.id)}>
                <strong>{report.title}</strong>
                <span className="hint">{formatDateTime(report.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function AgentsApp(): ReactElement {
  const [tab, setTab] = useState<Tab>('missions');
  const refresh = useAgents((state) => state.refresh);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <div className="mem">
      <AppTabs
        tabs={[
          ['missions', 'Missions'],
          ['live', 'Live view'],
          ['new', 'New agent'],
          ['monitors', 'Monitors'],
          ['reports', 'Reports'],
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="tab-body">
        <div className="app-pad">
          {tab === 'missions' && <MissionsTab />}
          {tab === 'live' && <LiveTab />}
          {tab === 'new' && <NewTab onStarted={() => setTab('live')} />}
          {tab === 'monitors' && <MonitorsTab />}
          {tab === 'reports' && <ReportsTab />}
        </div>
      </div>
    </div>
  );
}
