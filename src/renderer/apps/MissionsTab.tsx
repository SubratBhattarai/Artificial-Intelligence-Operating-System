import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { MissionRecord } from '../../shared/missions';
import { ApprovalCard } from '../components/ApprovalCard';
import { ConfirmButton } from '../components/ConfirmButton';
import { formatRelative } from '../lib/format';
import { useAgents } from '../state/agentStore';

const STATUS_LABEL: Record<MissionRecord['status'], string> = {
  planning: 'Writing a plan…',
  awaiting_approval: 'Plan ready: needs your approval',
  running: 'Running',
  paused: 'Paused',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
};
const STEP_MARK = { pending: '○', running: '◐', done: '●', failed: '✕', skipped: '–' } as const;

function MissionCard({ mission }: { mission: MissionRecord }): ReactElement {
  const api = window.aios?.missions;
  const running = mission.steps.find((s) => s.status === 'running');
  const approvals = useAgents((state) =>
    running?.agentId ? (state.approvals[running.agentId] ?? []) : [],
  );
  const live = mission.status === 'running' || mission.status === 'paused';
  const act = (fn: Promise<unknown> | undefined) => void fn?.catch(() => undefined);
  return (
    <article className={`agent-card ${mission.status}`}>
      <header>
        <strong className="agent-goal">{mission.objective}</strong>
        <span className="hint">
          {STATUS_LABEL[mission.status]} · {formatRelative(mission.updatedAt)}
        </span>
      </header>
      <ol className="agent-steps">
        {mission.steps.map((step) => (
          <li key={step.id} className={step.status}>
            <strong>
              {STEP_MARK[step.status]} {step.title}
            </strong>
            <div className="hint">
              {step.status === 'done' && step.result ? step.result.slice(0, 200) : step.detail}
            </div>
          </li>
        ))}
      </ol>
      {approvals.map((approval) => (
        <ApprovalCard key={approval.id} approval={approval} />
      ))}
      {mission.error && <p className="hint">{mission.error}</p>}
      <div className="row">
        {mission.status === 'awaiting_approval' && (
          <button
            type="button"
            className="btn primary"
            onClick={() => act(api?.approve(mission.id))}
          >
            Approve plan and start
          </button>
        )}
        {mission.status === 'running' && (
          <button type="button" className="btn compact" onClick={() => act(api?.pause(mission.id))}>
            Pause after this step
          </button>
        )}
        {mission.status === 'paused' && (
          <button
            type="button"
            className="btn compact"
            onClick={() => act(api?.resume(mission.id))}
          >
            Resume
          </button>
        )}
        {(live || mission.status === 'planning' || mission.status === 'awaiting_approval') && (
          <button
            type="button"
            className="btn compact"
            onClick={() => act(api?.cancel(mission.id))}
          >
            {mission.status === 'awaiting_approval' ? 'Reject plan' : 'Stop'}
          </button>
        )}
        {!live && mission.status !== 'planning' && (
          <ConfirmButton
            label="Remove"
            confirmLabel="Remove?"
            onConfirm={() => act(api?.remove(mission.id))}
          />
        )}
      </div>
    </article>
  );
}

export function MissionsTab(): ReactElement {
  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [objective, setObjective] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setMissions((await window.aios?.missions.list()) ?? []);
  }, []);
  useEffect(() => {
    void reload();
    return window.aios?.missions.onEvent((event) => {
      setMissions((prev) =>
        [event.mission, ...prev.filter((m) => m.id !== event.mission.id)].sort(
          (a, b) => b.createdAt - a.createdAt,
        ),
      );
    });
  }, [reload]);
  return (
    <>
      <section className="card">
        <h3>Mission Control</h3>
        <p className="hint">
          Give JARVIS an objective. It writes a plan; nothing runs until you approve it. Agents then
          work through the steps one by one, pausing for your click on anything that changes
          something. You can pause or stop at any time. Only works while AI OS is open.
        </p>
        <textarea
          rows={3}
          value={objective}
          maxLength={500}
          placeholder="e.g. Research quantized speech models and write me a one-page summary in my notes"
          onChange={(event) => setObjective(event.target.value)}
        />
        {error && <div className="banner error">{error}</div>}
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={objective.trim().length < 8}
            onClick={() => {
              setError(null);
              void window.aios?.missions.create(objective).then(
                () => setObjective(''),
                (err: unknown) =>
                  setError(err instanceof Error ? err.message : 'Could not start planning.'),
              );
            }}
          >
            Plan mission
          </button>
        </div>
      </section>
      {missions.map((mission) => (
        <MissionCard key={mission.id} mission={mission} />
      ))}
    </>
  );
}
