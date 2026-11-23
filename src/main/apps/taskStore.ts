import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  isDateString,
  type RecordSource,
  type TaskInput,
  type TaskPatch,
  type TaskPriority,
  type TaskRecord,
  type TaskStatus,
} from '../../shared/apps';
import { JsonFile } from '../store/jsonFile';

const MAX_TASKS = 5000;
const STATUSES: TaskStatus[] = ['todo', 'doing', 'done'];
const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high'];

interface TaskData {
  version: 1;
  tasks: TaskRecord[];
}

function cleanTitle(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A task needs a title.');
  const title = value.replace(/\s+/g, ' ').trim();
  if (!title) throw new Error('A task needs a title.');
  return title.slice(0, 200);
}

function cleanDue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!isDateString(value)) throw new Error('The due date must look like 2026-12-31.');
  return value;
}

/** Local to-do list. Works fully without AI; JARVIS writes only through approved tool calls. */
export class TaskStore {
  private readonly file: JsonFile<TaskData>;

  constructor(dataDir: string) {
    this.file = new JsonFile<TaskData>(
      path.join(dataDir, 'tasks.json'),
      () => ({ version: 1, tasks: [] }),
      (raw) => {
        const data = raw as Partial<TaskData> | null;
        if (!data || !Array.isArray(data.tasks)) return null;
        return {
          version: 1,
          tasks: data.tasks.filter(
            (task): task is TaskRecord =>
              !!task && typeof task.id === 'string' && typeof task.title === 'string',
          ),
        };
      },
    );
  }

  private get tasks(): TaskRecord[] {
    return this.file.value.tasks;
  }

  list(filter: { status?: TaskStatus } = {}): TaskRecord[] {
    const rank = (task: TaskRecord) => (task.status === 'done' ? 1 : 0);
    return this.tasks
      .filter((task) => !filter.status || task.status === filter.status)
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99') ||
          b.createdAt - a.createdAt,
      )
      .map((task) => ({ ...task }));
  }

  get(id: string): TaskRecord | null {
    const task = this.tasks.find((entry) => entry.id === id);
    return task ? { ...task } : null;
  }

  create(input: TaskInput, source: RecordSource = 'user', now = Date.now()): TaskRecord {
    if (this.tasks.length >= MAX_TASKS) throw new Error(`Tasks are limited to ${MAX_TASKS}.`);
    const priority = input.priority ?? 'normal';
    if (!PRIORITIES.includes(priority)) throw new Error('Priority must be low, normal or high.');
    const task: TaskRecord = {
      id: randomUUID(),
      title: cleanTitle(input.title),
      notes: String(input.notes ?? '').slice(0, 5000),
      status: 'todo',
      priority,
      due: cleanDue(input.due),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      source,
    };
    this.tasks.push(task);
    this.file.touch();
    return { ...task };
  }

  update(id: string, patch: TaskPatch, now = Date.now()): TaskRecord {
    const task = this.tasks.find((entry) => entry.id === id);
    if (!task) throw new Error('That task no longer exists.');
    if (patch.title !== undefined) task.title = cleanTitle(patch.title);
    if (patch.notes !== undefined) task.notes = String(patch.notes).slice(0, 5000);
    if (patch.priority !== undefined) {
      if (!PRIORITIES.includes(patch.priority))
        throw new Error('Priority must be low, normal or high.');
      task.priority = patch.priority;
    }
    if (patch.due !== undefined) task.due = cleanDue(patch.due);
    if (patch.status !== undefined) {
      if (!STATUSES.includes(patch.status)) throw new Error('Status must be todo, doing or done.');
      if (patch.status === 'done' && task.status !== 'done') task.completedAt = now;
      if (patch.status !== 'done') task.completedAt = null;
      task.status = patch.status;
    }
    task.updatedAt = now;
    this.file.touch();
    return { ...task };
  }

  remove(id: string): boolean {
    const index = this.tasks.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    this.tasks.splice(index, 1);
    this.file.touch();
    return true;
  }

  flush(): void {
    this.file.flushSync();
  }
}
