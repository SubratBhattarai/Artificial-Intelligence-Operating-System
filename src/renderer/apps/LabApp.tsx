import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { LAB_COMMANDS, LAB_TEMPLATES, type LabProject, type LabRunResult } from '../../shared/lab';
import { Banners } from './appKit';

const COMMANDS_FOR: Record<string, Array<keyof typeof LAB_COMMANDS>> = {
  'static-site': [],
  'node-script': ['npm-install', 'npm-test', 'npm-build', 'node-main'],
  'python-script': ['python-main', 'python-test'],
  custom: ['npm-install', 'npm-test', 'node-main', 'python-main', 'python-test'],
};

export function LabApp(): ReactElement {
  const [projects, setProjects] = useState<LabProject[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<string>('static-site');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<{ title: string; result: LabRunResult } | null>(null);

  const reload = useCallback(async () => {
    setProjects((await window.aios?.lab.list()) ?? []);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const guard = async (label: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="app-pad">
      <section className="card">
        <h3>Engineering Lab</h3>
        <p className="hint">
          Build and test small projects entirely on this computer, in Documents/AI OS Projects. Ask
          JARVIS to write the code, or edit the files yourself. Previews are served on 127.0.0.1
          only. Nothing is uploaded or deployed.
        </p>
        <div className="row">
          <input
            value={name}
            maxLength={40}
            placeholder="project-name"
            onChange={(e) => setName(e.target.value.toLowerCase())}
          />
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            {LAB_TEMPLATES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn primary"
            disabled={!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name) || busy !== null}
            onClick={() =>
              void guard('create', async () => {
                setProjects((await window.aios?.lab.create(name, template)) ?? []);
                setName('');
              })
            }
          >
            Create
          </button>
        </div>
        <Banners error={error} notice={null} />
      </section>
      {!loaded && (
        <div className="skeleton-lines" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      )}
      {loaded && projects.length === 0 && <p className="hint">No projects yet.</p>}
      {projects.map((project) => (
        <article key={project.name} className="agent-card">
          <header>
            <strong className="agent-goal">{project.name}</strong>
            <span className="hint">{project.template}</span>
          </header>
          <div className="row">
            {project.template === 'static-site' &&
              (project.previewPort ? (
                <>
                  <button
                    type="button"
                    className="btn compact"
                    onClick={() =>
                      void guard('open', () => window.aios!.lab.openPreview(project.name))
                    }
                  >
                    Open preview
                  </button>
                  <button
                    type="button"
                    className="btn compact"
                    onClick={() =>
                      void guard('stop', async () =>
                        setProjects((await window.aios?.lab.preview(project.name, false)) ?? []),
                      )
                    }
                  >
                    Stop preview
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn compact"
                  onClick={() =>
                    void guard('start', async () =>
                      setProjects((await window.aios?.lab.preview(project.name, true)) ?? []),
                    )
                  }
                >
                  Start preview
                </button>
              ))}
            {(COMMANDS_FOR[project.template] ?? []).map((command) => (
              <button
                key={command}
                type="button"
                className="btn compact"
                disabled={busy !== null}
                title={LAB_COMMANDS[command]}
                onClick={() =>
                  void guard(`${project.name}:${command}`, async () => {
                    const result = await window.aios!.lab.run(project.name, command);
                    setLog({ title: `${project.name}: ${LAB_COMMANDS[command]}`, result });
                  })
                }
              >
                {busy === `${project.name}:${command}` ? 'Running…' : LAB_COMMANDS[command]}
              </button>
            ))}
          </div>
        </article>
      ))}
      {log && (
        <section className="card">
          <h3>{log.title}</h3>
          <p className="hint">
            {log.result.timedOut ? 'Timed out.' : `Exit code ${log.result.exitCode ?? 'unknown'}.`}
          </p>
          <pre className="log">{log.result.output || '(no output)'}</pre>
        </section>
      )}
    </div>
  );
}
