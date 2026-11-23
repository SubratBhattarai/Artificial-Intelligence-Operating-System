import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  AgentRecord,
  Importance,
  MonitorRecord,
  NotificationItem,
  NotificationSource,
  ReportRecord,
} from '../../shared/agents';
import { ACTIVE_AGENT_STATUSES } from '../../shared/agents';
import { JsonFile } from '../store/jsonFile';

const MAX_AGENTS = 30;
const MAX_REPORTS = 100;
const MAX_MONITORS = 10;
const MAX_NOTIFICATIONS = 200;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Agents only run while AI OS is open, so any still marked active at startup were cut off. */
export class AgentStore {
  private readonly file: JsonFile<{ version: 1; agents: AgentRecord[] }>;
  constructor(dataDir: string, now = Date.now) {
    this.file = new JsonFile(
      path.join(dataDir, 'agents.json'),
      () => ({ version: 1 as const, agents: [] }),
      (raw) => {
        if (!isObject(raw) || !Array.isArray(raw.agents)) return null;
        const agents = (raw.agents as AgentRecord[])
          .filter(
            (agent) =>
              isObject(agent) && typeof agent.id === 'string' && typeof agent.goal === 'string',
          )
          .map((agent) =>
            ACTIVE_AGENT_STATUSES.includes(agent.status)
              ? {
                  ...agent,
                  status: 'cancelled' as const,
                  error: 'AI OS was closed while this was running.',
                  updatedAt: now(),
                }
              : agent,
          );
        return { version: 1 as const, agents };
      },
    );
  }
  list(): AgentRecord[] {
    return [...this.file.value.agents].sort((a, b) => b.createdAt - a.createdAt);
  }
  get(id: string): AgentRecord | undefined {
    return this.file.value.agents.find((agent) => agent.id === id);
  }
  save(agent: AgentRecord): void {
    const others = this.file.value.agents.filter((entry) => entry.id !== agent.id);
    const agents = [...others, agent]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_AGENTS);
    this.file.set({ version: 1, agents });
  }
  clearFinished(): void {
    this.file.set({
      version: 1,
      agents: this.file.value.agents.filter((agent) =>
        ACTIVE_AGENT_STATUSES.includes(agent.status),
      ),
    });
  }
}

export class ReportStore {
  private readonly file: JsonFile<{ version: 1; reports: ReportRecord[] }>;
  constructor(dataDir: string) {
    this.file = new JsonFile(
      path.join(dataDir, 'reports.json'),
      () => ({ version: 1 as const, reports: [] }),
      (raw) =>
        isObject(raw) && Array.isArray(raw.reports)
          ? { version: 1 as const, reports: raw.reports as ReportRecord[] }
          : null,
    );
  }
  list(): ReportRecord[] {
    return [...this.file.value.reports].sort((a, b) => b.createdAt - a.createdAt);
  }
  get(id: string): ReportRecord | undefined {
    return this.file.value.reports.find((report) => report.id === id);
  }
  create(input: { title: string; body: string; agentId?: string }, now = Date.now()): ReportRecord {
    const report: ReportRecord = {
      id: randomUUID(),
      title: input.title.trim().slice(0, 120) || 'Report',
      body: input.body.slice(0, 60_000),
      createdAt: now,
      agentId: input.agentId,
    };
    this.file.set({
      version: 1,
      reports: [report, ...this.file.value.reports].slice(0, MAX_REPORTS),
    });
    return report;
  }
  remove(id: string): boolean {
    const before = this.file.value.reports.length;
    const reports = this.file.value.reports.filter((report) => report.id !== id);
    if (reports.length === before) return false;
    this.file.set({ version: 1, reports });
    return true;
  }
}

export class MonitorStore {
  private readonly file: JsonFile<{
    version: 1;
    monitors: MonitorRecord[];
    texts: Record<string, string>;
  }>;
  constructor(dataDir: string) {
    this.file = new JsonFile(
      path.join(dataDir, 'monitors.json'),
      () => ({ version: 1 as const, monitors: [], texts: {} }),
      (raw) =>
        isObject(raw) && Array.isArray(raw.monitors)
          ? {
              version: 1 as const,
              monitors: raw.monitors as MonitorRecord[],
              texts: isObject(raw.texts) ? (raw.texts as Record<string, string>) : {},
            }
          : null,
    );
  }
  list(): MonitorRecord[] {
    return [...this.file.value.monitors];
  }
  get(id: string): MonitorRecord | undefined {
    return this.file.value.monitors.find((monitor) => monitor.id === id);
  }
  lastText(id: string): string | undefined {
    return this.file.value.texts[id];
  }
  add(
    input: { url: string; label: string; intervalMinutes: number },
    now = Date.now(),
  ): MonitorRecord {
    if (this.file.value.monitors.length >= MAX_MONITORS) {
      throw new Error(`You can watch up to ${MAX_MONITORS} websites. Remove one first.`);
    }
    const monitor: MonitorRecord = {
      id: randomUUID(),
      url: input.url,
      label: input.label.trim().slice(0, 80) || input.url,
      intervalMinutes: Math.min(1440, Math.max(5, Math.round(input.intervalMinutes))),
      createdAt: now,
      unseenChange: false,
    };
    this.file.set({ ...this.file.value, monitors: [...this.file.value.monitors, monitor] });
    return monitor;
  }
  update(id: string, patch: Partial<MonitorRecord>, text?: string): void {
    const monitors = this.file.value.monitors.map((monitor) =>
      monitor.id === id ? { ...monitor, ...patch } : monitor,
    );
    const texts =
      text === undefined
        ? this.file.value.texts
        : { ...this.file.value.texts, [id]: text.slice(0, 20_000) };
    this.file.set({ version: 1, monitors, texts });
  }
  remove(id: string): boolean {
    const before = this.file.value.monitors.length;
    const monitors = this.file.value.monitors.filter((monitor) => monitor.id !== id);
    if (monitors.length === before) return false;
    const texts = { ...this.file.value.texts };
    delete texts[id];
    this.file.set({ version: 1, monitors, texts });
    return true;
  }
}

export class NotificationStore {
  private readonly file: JsonFile<{ version: 1; items: NotificationItem[] }>;
  constructor(dataDir: string) {
    this.file = new JsonFile(
      path.join(dataDir, 'notifications.json'),
      () => ({ version: 1 as const, items: [] }),
      (raw) =>
        isObject(raw) && Array.isArray(raw.items)
          ? { version: 1 as const, items: raw.items as NotificationItem[] }
          : null,
    );
  }
  list(): NotificationItem[] {
    return [...this.file.value.items].sort((a, b) => b.at - a.at);
  }
  unreadCount(): number {
    return this.file.value.items.filter((item) => !item.read).length;
  }
  /** Returns the new item, or null when this event was already announced. */
  add(
    input: {
      source: NotificationSource;
      title: string;
      body?: string;
      importance: Importance;
      key: string;
    },
    now = Date.now(),
  ): NotificationItem | null {
    if (this.file.value.items.some((item) => item.key === input.key)) return null;
    const item: NotificationItem = {
      id: randomUUID(),
      at: now,
      source: input.source,
      title: input.title.slice(0, 140),
      body: input.body?.slice(0, 300),
      importance: input.importance,
      read: input.importance === 'info', // quiet items never raise the unread badge
      key: input.key,
    };
    this.file.set({
      version: 1,
      items: [item, ...this.file.value.items].slice(0, MAX_NOTIFICATIONS),
    });
    return item;
  }
  markRead(id: string): void {
    this.file.set({
      version: 1,
      items: this.file.value.items.map((item) => (item.id === id ? { ...item, read: true } : item)),
    });
  }
  markAllRead(): void {
    this.file.set({
      version: 1,
      items: this.file.value.items.map((item) => ({ ...item, read: true })),
    });
  }
  clear(): void {
    this.file.set({ version: 1, items: [] });
  }
}
