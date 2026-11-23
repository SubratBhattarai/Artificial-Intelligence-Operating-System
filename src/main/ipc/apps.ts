import fs from 'node:fs';
import os from 'node:os';
import { app, dialog, type BrowserWindow, type IpcMain } from 'electron';
import type {
  EventInput,
  EventPatch,
  ImportResult,
  MonitorSnapshot,
  TaskInput,
  TaskPatch,
  TaskStatus,
  TransactionInput,
  TransactionPatch,
} from '../../shared/apps';
import type { ExportResult } from '../../shared/protocol';
import type { Services } from '../services';
import { asId, asObject, asOptionalNumber, asString } from './validate';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
let lastCpu: { idle: number; total: number }[] | null = null;

function sampleCores(): number[] {
  const current = os.cpus().map((cpu) => {
    const { user, nice, sys, idle, irq } = cpu.times;
    return { idle, total: user + nice + sys + idle + irq };
  });
  const previous = lastCpu;
  lastCpu = current;
  if (!previous || previous.length !== current.length) return current.map(() => 0);
  return current.map((core, index) => {
    const total = core.total - previous[index].total;
    if (total <= 0) return 0;
    return Math.round(
      Math.min(100, Math.max(0, (1 - (core.idle - previous[index].idle) / total) * 100)),
    );
  });
}

export async function getMonitorSnapshot(): Promise<MonitorSnapshot> {
  const perCore = sampleCores();
  const cpu = perCore.length ? Math.round(perCore.reduce((a, b) => a + b, 0) / perCore.length) : 0;
  const total = os.totalmem();
  const free = os.freemem();
  let diskPercent: number | null = null;
  let diskFreeGb: number | null = null;
  try {
    const stats = await fs.promises.statfs(app.getPath('userData'));
    if (stats.blocks) {
      diskPercent = Math.round((1 - stats.bavail / stats.blocks) * 100);
      diskFreeGb = Math.round(((stats.bavail * stats.bsize) / 1024 ** 3) * 10) / 10;
    }
  } catch {
    // leave disk fields null
  }
  const processes = app
    .getAppMetrics()
    .map((entry) => ({
      name: entry.name || entry.type,
      memoryMb: Math.round(entry.memory.workingSetSize / 1024),
      cpu: Math.round(entry.cpu.percentCPUUsage * 10) / 10,
    }))
    .sort((a, b) => b.memoryMb - a.memoryMb)
    .slice(0, 12);
  return {
    at: Date.now(),
    cpu,
    perCore,
    ramPercent: Math.round((1 - free / total) * 100),
    ramUsedMb: Math.round((total - free) / 1024 ** 2),
    ramTotalMb: Math.round(total / 1024 ** 2),
    diskPercent,
    diskFreeGb,
    uptimeSec: Math.round(os.uptime()),
    processes,
  };
}

export function registerAppsIpc(
  ipcMain: IpcMain,
  services: Services,
  getWindow: () => BrowserWindow | null,
): void {
  const { tasks, events, finance } = services;

  /* ---------- tasks ---------- */
  ipcMain.handle('tasks:list', () => tasks.list());
  ipcMain.handle('tasks:create', (_e, input: unknown) =>
    tasks.create(asObject(input, 'task') as unknown as TaskInput, 'user'),
  );
  ipcMain.handle('tasks:update', (_e, id: unknown, patch: unknown) =>
    tasks.update(asId(id), asObject(patch, 'patch') as TaskPatch),
  );
  ipcMain.handle('tasks:set-status', (_e, id: unknown, status: unknown) =>
    tasks.update(asId(id), { status: asString(status, 'status', 10) as TaskStatus }),
  );
  ipcMain.handle('tasks:remove', (_e, id: unknown) => tasks.remove(asId(id)));

  /* ---------- calendar ---------- */
  ipcMain.handle('events:list', (_e, range: unknown) => {
    const r = range && typeof range === 'object' ? (range as Record<string, unknown>) : {};
    return events.list({ from: asOptionalNumber(r.from), to: asOptionalNumber(r.to) });
  });
  ipcMain.handle('events:create', (_e, input: unknown) =>
    events.create(asObject(input, 'event') as unknown as EventInput, 'user'),
  );
  ipcMain.handle('events:update', (_e, id: unknown, patch: unknown) =>
    events.update(asId(id), asObject(patch, 'patch') as EventPatch),
  );
  ipcMain.handle('events:remove', (_e, id: unknown) => events.remove(asId(id)));
  ipcMain.handle('events:import-ics', async (): Promise<ImportResult> => {
    const text = await pickAndRead(getWindow(), 'Import calendar (.ics)', [
      { name: 'iCalendar', extensions: ['ics'] },
    ]);
    if (text === null) return { ok: true, canceled: true, imported: 0, skipped: 0, notes: [] };
    return events.importIcs(text);
  });
  ipcMain.handle('events:export-ics', () =>
    saveText(getWindow(), 'ai-os-calendar.ics', 'iCalendar', 'ics', events.exportIcs()),
  );

  /* ---------- finance (manual entry and file import only) ---------- */
  ipcMain.handle('finance:list', (_e, month: unknown) =>
    finance.list({
      month: typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) ? month : undefined,
    }),
  );
  ipcMain.handle('finance:create', (_e, input: unknown) =>
    finance.create(asObject(input, 'transaction') as unknown as TransactionInput),
  );
  ipcMain.handle('finance:update', (_e, id: unknown, patch: unknown) =>
    finance.update(asId(id), asObject(patch, 'patch') as TransactionPatch),
  );
  ipcMain.handle('finance:remove', (_e, id: unknown) => finance.remove(asId(id)));
  ipcMain.handle('finance:summary', (_e, month: unknown) =>
    finance.summary(asString(month, 'month', 7)),
  );
  ipcMain.handle('finance:import-csv', async (): Promise<ImportResult> => {
    const text = await pickAndRead(getWindow(), 'Import transactions (.csv)', [
      { name: 'CSV', extensions: ['csv'] },
    ]);
    if (text === null) return { ok: true, canceled: true, imported: 0, skipped: 0, notes: [] };
    return finance.importCsv(text);
  });
  ipcMain.handle('finance:export-csv', () =>
    saveText(getWindow(), 'ai-os-transactions.csv', 'CSV', 'csv', finance.exportCsv()),
  );

  /* ---------- system monitor ---------- */
  ipcMain.handle('monitor:snapshot', () => getMonitorSnapshot());
}

async function pickAndRead(
  window: BrowserWindow | null,
  title: string,
  filters: Electron.FileFilter[],
): Promise<string | null> {
  const options: Electron.OpenDialogOptions = { title, filters, properties: ['openFile'] };
  const picked = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (picked.canceled || picked.filePaths.length === 0) return null;
  const file = picked.filePaths[0];
  const stat = await fs.promises.stat(file);
  if (stat.size > MAX_IMPORT_BYTES)
    throw new Error('That file is too large to import (limit 5 MB).');
  return fs.promises.readFile(file, 'utf8');
}

async function saveText(
  window: BrowserWindow | null,
  defaultName: string,
  filterName: string,
  extension: string,
  content: string,
): Promise<ExportResult> {
  try {
    const options: Electron.SaveDialogOptions = {
      title: 'Export',
      defaultPath: defaultName,
      filters: [{ name: filterName, extensions: [extension] }],
    };
    const picked = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (picked.canceled || !picked.filePath) return { ok: true, canceled: true };
    await fs.promises.writeFile(picked.filePath, content, 'utf8');
    return { ok: true, path: picked.filePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
