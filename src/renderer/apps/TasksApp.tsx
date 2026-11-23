import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { TaskPriority, TaskRecord, TaskStatus } from '../../shared/apps';
import { ConfirmButton } from '../components/ConfirmButton';
import { AppTabs, Banners, todayString, useRunner } from './appKit';
import type { ShellAppProps } from './types';

type Filter = 'open' | 'done' | 'all';

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  doing: 'In progress',
  done: 'Done',
};

export function TasksApp(_props: ShellAppProps): ReactElement {
  const api = window.aios;
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [due, setDue] = useState('');

  const reload = useCallback(async () => {
    if (api) setTasks(await api.tasks.list());
  }, [api]);
  const { error, notice, setError, run } = useRunner(reload);

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [reload, setError]);

  if (!api) return <div className="app-pad banner error">Backend bridge unavailable.</div>;

  const today = todayString();
  const visible = tasks.filter((task) =>
    filter === 'all' ? true : filter === 'done' ? task.status === 'done' : task.status !== 'done',
  );
  const openCount = tasks.filter((task) => task.status !== 'done').length;

  const add = () => {
    if (!title.trim()) return;
    void run(async () => {
      await api.tasks.create({ title, priority, due: due || null });
      setTitle('');
      setDue('');
      setPriority('normal');
    });
  };

  return (
    <div className="mem">
      <AppTabs
        tabs={[
          ['open', `Open · ${openCount}`],
          ['done', 'Done'],
          ['all', 'All'],
        ]}
        value={filter}
        onChange={setFilter}
      />
      <Banners error={error} notice={notice} />
      <form
        className="app-form"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          className="input grow"
          placeholder="Add a task…"
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
        />
        <select
          className="input"
          value={priority}
          onChange={(event) => setPriority(event.target.value as TaskPriority)}
          aria-label="Priority"
        >
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
        <input
          className="input"
          type="date"
          value={due}
          onChange={(event) => setDue(event.target.value)}
          aria-label="Due date"
        />
        <button type="submit" className="btn primary" disabled={!title.trim()}>
          Add
        </button>
      </form>

      <div className="tab-body">
        {visible.length === 0 && <div className="empty">Nothing here.</div>}
        {visible.map((task) => {
          const overdue = task.status !== 'done' && task.due !== null && task.due < today;
          return (
            <div key={task.id} className={`list-row task-row ${task.status}`}>
              <input
                type="checkbox"
                aria-label={`Mark "${task.title}" done`}
                checked={task.status === 'done'}
                onChange={(event) =>
                  void run(() =>
                    api.tasks.setStatus(task.id, event.target.checked ? 'done' : 'todo'),
                  )
                }
              />
              <div className="list-main">
                <div className="list-title">{task.title}</div>
                <div className="list-sub">
                  {task.priority !== 'normal' && `${task.priority} priority · `}
                  {task.due
                    ? overdue
                      ? `overdue · was due ${task.due}`
                      : `due ${task.due}`
                    : 'no due date'}
                  {task.source === 'jarvis' && ' · added by JARVIS'}
                </div>
              </div>
              <select
                className="input compact"
                value={task.status}
                aria-label="Status"
                onChange={(event) =>
                  void run(() => api.tasks.setStatus(task.id, event.target.value as TaskStatus))
                }
              >
                {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
              <ConfirmButton
                label="Delete"
                confirmLabel="Delete task"
                onConfirm={() => void run(() => api.tasks.remove(task.id))}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
