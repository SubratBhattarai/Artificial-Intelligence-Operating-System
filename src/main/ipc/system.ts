import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, ipcMain } from 'electron';
import type { Health, ShellSnapshot, SystemMetrics } from '../../shared/protocol';
import { config } from '../config';
import { listFolder } from '../fs/allowed';
import type { FileIndex } from '../files/indexer';
import type { ModelAdapter } from '../llm/adapter';
import { setShellSnapshot } from '../state/shellState';
import type { ToolRegistry } from '../tools';

const startedAt = Date.now();

type CpuTimes = { idle: number; total: number };
let lastCpu: CpuTimes | null = null;

function readCpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const { user, nice, sys, idle: idleTime, irq } = cpu.times;
    idle += idleTime;
    total += user + nice + sys + idleTime + irq;
  }
  return { idle, total };
}

/** CPU load since the previous sample (the widget polls every couple of seconds). */
function sampleCpuPercent(): number {
  const current = readCpuTimes();
  const previous = lastCpu;
  lastCpu = current;
  if (!previous) return 0;
  const total = current.total - previous.total;
  if (total <= 0) return 0;
  return Math.round(Math.min(100, Math.max(0, (1 - (current.idle - previous.idle) / total) * 100)));
}

async function sampleDiskPercent(): Promise<number | null> {
  try {
    const stats = await fs.promises.statfs(app.getPath('userData'));
    if (!stats.blocks) return null;
    return Math.round((1 - stats.bavail / stats.blocks) * 100);
  } catch {
    return null;
  }
}

export async function getMetrics(): Promise<SystemMetrics> {
  const ram = Math.round((1 - os.freemem() / os.totalmem()) * 100);
  return { cpu: sampleCpuPercent(), ram, disk: await sampleDiskPercent() };
}

let summonRegistered = false;
export function setSummonRegistered(value: boolean): void {
  summonRegistered = value;
}

export async function getHealth(adapter: ModelAdapter, registry: ToolRegistry): Promise<Health> {
  let reachable: boolean | null = null;
  try {
    reachable = await adapter.ping();
  } catch {
    reachable = null;
  }
  const configured = adapter.configured;
  return {
    status: configured && reachable === true ? 'ok' : 'degraded',
    appVersion: app.getVersion(),
    platform: process.platform,
    uptimeMs: Date.now() - startedAt,
    provider: {
      id: adapter.id,
      model: adapter.model,
      configured,
      reachable,
    },
    tools: registry.names(),
    summonShortcut: { accelerator: config.summonShortcut, registered: summonRegistered },
    checkedAt: Date.now(),
  };
}

export function registerSystemIpc(
  adapter: ModelAdapter,
  registry: ToolRegistry,
  fileIndex: FileIndex,
): void {
  ipcMain.handle('system:health', () => getHealth(adapter, registry));
  ipcMain.handle('system:tools', () => registry.descriptors());
  ipcMain.handle('system:metrics', () => getMetrics());

  /** Read-only folder browsing for the Files app — same allowlist as the list_folder tool. */
  ipcMain.handle('fs:list', async (_event, target?: string) => {
    const listing = await listFolder(target);
    return {
      ...listing,
      entries: listing.entries.map((entry) => {
        if (entry.type !== 'file') return entry;
        const known = fileIndex.statusOf(path.join(listing.path, entry.name));
        return known ? { ...entry, indexStatus: known.status, indexReason: known.reason } : entry;
      }),
    };
  });

  /** Renderer pushes its window snapshot so app_status can report on the shell. */
  ipcMain.on('shell:state', (_event, snapshot: ShellSnapshot | null) => {
    if (!snapshot || !Array.isArray(snapshot.windows)) return;
    setShellSnapshot({
      windows: snapshot.windows.slice(0, 64).map((win) => ({
        id: String(win?.id ?? ''),
        appId: String(win?.appId ?? ''),
        title: String(win?.title ?? '').slice(0, 120),
        state: win?.state === 'minimized' || win?.state === 'maximized' ? win.state : 'normal',
        focused: Boolean(win?.focused),
      })),
      activeAppId: snapshot.activeAppId ? String(snapshot.activeAppId) : null,
      updatedAt: Date.now(),
    });
  });
}
