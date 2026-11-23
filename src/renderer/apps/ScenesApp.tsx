import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { describeStep, type Scene, type SceneStep } from '../../shared/scenes';
import { ConfirmButton } from '../components/ConfirmButton';
import { errorText } from '../lib/format';
import { formatClock, useFocus } from '../state/focusStore';
import { Banners } from './appKit';

type StepKind = SceneStep['kind'];

/** Focus timer and Scenes ("Study mode"): saved setups JARVIS performs one approved step at a time. */
export function ScenesApp(): ReactElement {
  const api = window.aios;
  const focus = useFocus();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [apps, setApps] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<SceneStep[]>([]);
  const [kind, setKind] = useState<StepKind>('open_app');
  const [appName, setAppName] = useState('');
  const [level, setLevel] = useState(50);
  const [minutes, setMinutes] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    void api.scenes.list().then(setScenes);
    void api.approvedApps.list().then((list) => {
      setApps(list.map((a) => a.name));
      setAppName(list[0]?.name ?? '');
    });
  }, [api]);

  if (!api) return <div className="banner error">Backend bridge unavailable.</div>;

  const addStep = () => {
    if (kind === 'open_app' || kind === 'close_app') {
      if (appName) setSteps([...steps, { kind, name: appName }]);
    } else setSteps([...steps, { kind, level }]);
  };

  return (
    <div className="app-pad">
      <Banners error={error} notice={notice} />
      <section className="card">
        <h4>Focus mode</h4>
        {focus.endsAt ? (
          <div className="row">
            <strong>{formatClock(focus.remaining)}</strong>
            <span className="hint">left. Notifications stay quiet except security alerts.</span>
            <span className="hud-spacer" />
            <button type="button" className="btn" onClick={focus.stop}>
              End
            </button>
          </div>
        ) : (
          <div className="row">
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[15, 25, 45, 60, 90].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
            <button type="button" className="btn primary" onClick={() => focus.start(minutes)}>
              Start focus
            </button>
            <span className="hint">Or say “Jarvis, focus for 25 minutes”.</span>
          </div>
        )}
      </section>

      <section className="card">
        <h4>Scenes</h4>
        <p className="hint">
          Say “Jarvis, study mode” and JARVIS does each step in turn. You approve every step, so
          nothing runs unseen. Apps must be on your approved list (Settings › Permissions).
        </p>
        {scenes.length === 0 && <p className="hint">No scenes yet.</p>}
        {scenes.map((scene) => (
          <div key={scene.id} className="bell-item">
            <strong>{scene.name}</strong>
            <span className="hint">{scene.steps.map(describeStep).join(' → ')}</span>
            <span className="row">
              <button
                type="button"
                className="btn compact"
                onClick={() => {
                  setName(scene.name);
                  setSteps(scene.steps);
                }}
              >
                Edit
              </button>
              <ConfirmButton
                label="Delete"
                confirmLabel="Yes, delete"
                onConfirm={() => void api.scenes.remove(scene.id).then(setScenes)}
              />
            </span>
          </div>
        ))}
      </section>

      <section className="card">
        <h4>New or edited scene</h4>
        <div className="form-row">
          <label>Name</label>
          <input
            value={name}
            maxLength={40}
            placeholder="e.g. Study mode"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {steps.map((step, index) => (
          <div key={`${step.kind}-${index}`} className="row">
            <span>
              {index + 1}. {describeStep(step)}
            </span>
            <span className="hud-spacer" />
            <button
              type="button"
              className="btn compact"
              onClick={() => setSteps(steps.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value as StepKind)}>
            <option value="open_app">Open an app</option>
            <option value="close_app">Close an app</option>
            <option value="volume">Set volume</option>
            <option value="brightness">Set brightness</option>
          </select>
          {kind === 'open_app' || kind === 'close_app' ? (
            <select value={appName} onChange={(e) => setAppName(e.target.value)}>
              {apps.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              min={0}
              max={100}
              value={level}
              onChange={(e) =>
                setLevel(Math.min(100, Math.max(0, Math.round(Number(e.target.value)))))
              }
            />
          )}
          <button type="button" className="btn" onClick={addStep}>
            Add step
          </button>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={!name.trim() || steps.length === 0}
            onClick={() => {
              setError(null);
              api.scenes.save({ name, steps }).then(
                (list) => {
                  setScenes(list);
                  setName('');
                  setSteps([]);
                  setNotice('Scene saved.');
                },
                (err: unknown) => setError(errorText(err)),
              );
            }}
          >
            Save scene
          </button>
        </div>
      </section>
    </div>
  );
}
