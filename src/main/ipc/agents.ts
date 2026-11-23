import fs from 'node:fs';
import { dialog, type BrowserWindow, type IpcMain, type WebContents } from 'electron';
import type {
  AgentEvent,
  AgentKind,
  NotificationItem,
  NotificationSource,
} from '../../shared/agents';
import { scoreImportance } from '../agents/importance';
import { scanLocalSources } from '../agents/localScan';
import { AgentManager } from '../agents/agentManager';
import { MonitorRunner } from '../agents/monitorRunner';
import type { ModelAdapter } from '../llm/adapter';
import type { Services } from '../services';
import type { ToolRegistry } from '../tools';
import { checkPublicHttpsUrl } from '../tools/webTarget';
import { fetchReadableText } from '../web/fetcher';
import { asId, asObject, asString } from './validate';

export interface AgentsRuntime {
  manager: AgentManager;
  /** Raise a notification from anywhere in the main process (security, briefing, etc.). */
  notify: (input: {
    source: NotificationSource;
    title: string;
    body?: string;
    key: string;
    failed?: boolean;
    needsAction?: boolean;
    securityLevel?: 'low' | 'medium' | 'high';
  }) => NotificationItem | null;
  shutdown: () => void;
}

export function registerAgentsIpc(
  ipcMain: IpcMain,
  deps: {
    services: Services;
    adapter: ModelAdapter;
    registry: ToolRegistry;
    getWindow: () => BrowserWindow | null;
    getContents: () => WebContents | null;
  },
): AgentsRuntime {
  const { services, adapter, registry, getWindow, getContents } = deps;
  const send = (channel: string, payload: unknown) => {
    const contents = getContents();
    if (contents && !contents.isDestroyed()) contents.send(channel, payload);
  };

  const notify: AgentsRuntime['notify'] = (input) => {
    const item = services.notifications.add({
      source: input.source,
      title: input.title,
      body: input.body,
      key: input.key,
      importance: scoreImportance({
        source: input.source,
        failed: input.failed,
        needsAction: input.needsAction,
        securityLevel: input.securityLevel,
      }),
    });
    if (item) send('notifications:new', item);
    return item;
  };

  const manager = new AgentManager({
    adapter,
    registry,
    broker: services.approvals,
    store: services.agentStore,
    reports: services.reports,
    emit: (event: AgentEvent) => send('agents:event', event),
    notify: (note) =>
      notify({
        source: 'agent',
        title: note.title,
        body: note.body,
        key: note.key,
        failed: note.failed,
        needsAction: note.title.includes('approval'),
      }),
  });

  const monitorRunner = new MonitorRunner({
    store: services.monitors,
    canRun: () => services.permissions.allows('web', 'read'),
    fetchText: async (url, signal) =>
      (await fetchReadableText(url, { signal, maxChars: 20_000 })).text,
    notify: (note) =>
      notify({ source: 'monitor', title: note.title, body: note.body, key: note.key }),
  });
  monitorRunner.start();

  const scan = () => {
    for (const item of scanLocalSources({
      tasks: services.tasks,
      events: services.events,
      mail: services.mail,
      notifications: services.notifications,
    })) {
      send('notifications:new', item);
    }
  };
  const firstScan = setTimeout(scan, 6000);
  const scanTimer = setInterval(scan, 5 * 60_000);

  /* agents */
  ipcMain.handle('agents:list', () => services.agentStore.list());
  ipcMain.handle('agents:start', (_e, goal: unknown, kind: unknown) =>
    manager.start(
      asString(goal, 'goal', 1000),
      (kind === 'task' ? 'task' : 'research') as AgentKind,
    ),
  );
  ipcMain.handle('agents:cancel', (_e, id: unknown) => manager.cancel(asId(id, 'agent id')));
  ipcMain.handle('agents:clear-finished', () => {
    services.agentStore.clearFinished();
    return services.agentStore.list();
  });

  /* reports */
  ipcMain.handle('reports:list', () => services.reports.list());
  ipcMain.handle('reports:delete', (_e, id: unknown) =>
    services.reports.remove(asId(id, 'report id')),
  );
  ipcMain.handle('reports:export', async (_e, id: unknown) => {
    const report = services.reports.get(asId(id, 'report id'));
    if (!report) throw new Error('That report no longer exists.');
    const window = getWindow();
    const options = {
      title: 'Save report',
      defaultPath: `${
        report.title
          .replace(/[^\w\- ]+/g, '')
          .trim()
          .slice(0, 60) || 'report'
      }.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    };
    const picked = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (picked.canceled || !picked.filePath) return { ok: true, canceled: true };
    await fs.promises.writeFile(picked.filePath, `# ${report.title}\n\n${report.body}\n`, 'utf8');
    return { ok: true, path: picked.filePath };
  });

  /* monitors */
  ipcMain.handle('monitors:list', () => services.monitors.list());
  ipcMain.handle('monitors:add', (_e, input: unknown) => {
    const data = asObject(input, 'monitor');
    const checked = checkPublicHttpsUrl(asString(data.url, 'url', 2000));
    if (!checked.ok || !checked.url) throw new Error(checked.error ?? 'Invalid address.');
    return services.monitors.add({
      url: checked.url.toString(),
      label: typeof data.label === 'string' ? data.label : checked.url.hostname,
      intervalMinutes: typeof data.intervalMinutes === 'number' ? data.intervalMinutes : 60,
    });
  });
  ipcMain.handle('monitors:remove', (_e, id: unknown) =>
    services.monitors.remove(asId(id, 'monitor id')),
  );
  ipcMain.handle('monitors:check', async (_e, id: unknown) => {
    await monitorRunner.check(asId(id, 'monitor id'));
    return services.monitors.list();
  });
  ipcMain.handle('monitors:seen', (_e, id: unknown) => {
    services.monitors.update(asId(id, 'monitor id'), { unseenChange: false });
    return services.monitors.list();
  });

  /* notifications */
  ipcMain.handle('notifications:list', () => services.notifications.list());
  ipcMain.handle('notifications:read', (_e, id: unknown) => {
    services.notifications.markRead(asId(id, 'notification id'));
    return services.notifications.list();
  });
  ipcMain.handle('notifications:read-all', () => {
    services.notifications.markAllRead();
    return services.notifications.list();
  });
  ipcMain.handle('notifications:clear', () => {
    services.notifications.clear();
    return [];
  });
  ipcMain.handle('notifications:scan', () => {
    scan();
    return services.notifications.list();
  });

  return {
    manager,
    notify,
    shutdown: () => {
      clearTimeout(firstScan);
      clearInterval(scanTimer);
      monitorRunner.stop();
      manager.cancelAll();
    },
  };
}
