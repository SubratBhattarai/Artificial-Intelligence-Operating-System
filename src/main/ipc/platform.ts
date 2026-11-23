import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, session, type BrowserWindow, type IpcMain } from 'electron';
import type { ImportResult } from '../../shared/apps';
import type { MailInput } from '../../shared/mail';
import { isPermissionId, isPermissionLevel } from '../../shared/permissions';
import type {
  BackupResult,
  CleanupAction,
  CleanupActionId,
  CleanupResult,
  RestorePreview,
  StorageReport,
} from '../../shared/platform';
import { PhotoStore } from '../apps/photoStore';
import type { Services } from '../services';
import { createBackup, inspectBackup, restoreBackup, type BackupFile } from '../storage/backup';
import {
  cacheFolders,
  dataFileSizes,
  findLeftovers,
  findUnusedModels,
  pathSize,
  removePath,
  sizeOfAll,
} from '../storage/storage';
import { unloadSpeechEngine, setKeepWarm } from '../voice/transcribe';
import { flushServices } from '../services';
import { asId, asObject, asString } from './validate';

const DAY_MS = 24 * 60 * 60 * 1000;
const OLD_CONVERSATION_DAYS = 90;
const OLD_AUDIT_DAYS = 30;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const FILE_LABELS: Record<string, string> = {
  'memory.json': 'Memory',
  'notes.json': 'Notes',
  'conversations.json': 'Conversations',
  'tasks.json': 'Tasks',
  'events.json': 'Calendar',
  'finance.json': 'Finance',
  'mail.json': 'Mail',
  'audit.json': 'Activity log',
  'scenes.json': 'Scenes',
  'file-index.json': 'File index',
};

interface PlatformOptions {
  services: Services;
  getWindow: () => BrowserWindow | null;
  /** The speech model currently selected (its cache is kept during cleanup). */
  currentSpeechModel: () => string;
  isSpeechModelLoaded: () => boolean;
}

export function registerPlatformIpc(ipcMain: IpcMain, options: PlatformOptions): void {
  const { services, getWindow } = options;
  const photos = new PhotoStore(services.dataDir);
  const pendingRestores = new Map<string, BackupFile>();

  const userDataDir = () => app.getPath('userData');
  const modelsDir = () => path.join(userDataDir(), 'models');

  /* ---------- permissions ---------- */
  ipcMain.handle('permissions:get', () => services.permissions.get());
  ipcMain.handle('permissions:set', (_e, id: unknown, level: unknown) => {
    if (!isPermissionId(id) || !isPermissionLevel(level)) throw new Error('Invalid permission.');
    return services.permissions.set(id, level);
  });
  ipcMain.handle('permissions:revoke-all', () => services.permissions.revokeAll());
  ipcMain.handle('voice:keep-warm', (_e, on: unknown) => {
    // A warm model only makes sense while the microphone permission is on.
    setKeepWarm(on === true && services.permissions.allows('microphone', 'write'));
    return true;
  });
  ipcMain.handle('voice:unload', () => {
    unloadSpeechEngine();
    return true;
  });

  /* ---------- approved apps (what JARVIS may open or close) ---------- */
  ipcMain.handle('apps-allow:list', () => services.appsAllowlist.list());
  ipcMain.handle('apps-allow:add', async () => {
    const window = getWindow();
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Choose a program JARVIS may open and close',
      filters: [{ name: 'Programs', extensions: ['exe'] }],
      properties: ['openFile'],
    };
    const picked = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (picked.canceled || picked.filePaths.length === 0) return services.appsAllowlist.list();
    services.appsAllowlist.add(picked.filePaths[0]);
    return services.appsAllowlist.list();
  });
  ipcMain.handle('apps-allow:remove', (_e, id: unknown) => {
    services.appsAllowlist.remove(asId(id));
    return services.appsAllowlist.list();
  });

  /* ---------- mail (local only) ---------- */
  const mail = services.mail;
  ipcMain.handle('mail:list', (_e, folder: unknown) =>
    mail.list({ folder: folder === 'sent' ? 'sent' : 'inbox' }),
  );
  ipcMain.handle('mail:unread', () => mail.unreadCount());
  ipcMain.handle('mail:compose', (_e, input: unknown) =>
    mail.compose(asObject(input, 'message') as unknown as MailInput),
  );
  ipcMain.handle('mail:set-unread', (_e, id: unknown, unread: unknown) =>
    mail.setUnread(asId(id), unread === true),
  );
  ipcMain.handle('mail:remove', (_e, id: unknown) => mail.remove(asId(id)));
  ipcMain.handle('mail:import', async (): Promise<ImportResult> => {
    const window = getWindow();
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Import a message',
      filters: [{ name: 'Message', extensions: ['eml', 'txt'] }],
      properties: ['openFile'],
    };
    const picked = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: true, canceled: true, imported: 0, skipped: 0, notes: [] };
    }
    const stat = await fs.promises.stat(picked.filePaths[0]);
    if (stat.size > MAX_IMPORT_BYTES)
      throw new Error('That file is too large to import (limit 5 MB).');
    return mail.importFile(await fs.promises.readFile(picked.filePaths[0], 'utf8'));
  });

  /* ---------- camera photos ---------- */
  ipcMain.handle('photos:list', () => photos.list());
  ipcMain.handle('photos:save', (_e, dataUrl: unknown) => {
    // Saving only makes sense while the camera permission is on.
    if (!services.permissions.allows('camera', 'write')) throw new Error('Camera access is off.');
    return photos.save(asString(dataUrl, 'photo', 12_000_000));
  });
  ipcMain.handle('photos:read', (_e, name: unknown) => photos.read(asString(name, 'name', 80)));
  ipcMain.handle('photos:remove', (_e, name: unknown) => photos.remove(asString(name, 'name', 80)));

  /* ---------- storage report and cleanup ---------- */
  async function buildActions(): Promise<CleanupAction[]> {
    const now = Date.now();
    const conversationCutoff = now - OLD_CONVERSATION_DAYS * DAY_MS;
    const auditCutoff = now - OLD_AUDIT_DAYS * DAY_MS;
    const [leftovers, models] = await Promise.all([
      findLeftovers(services.dataDir),
      findUnusedModels(modelsDir(), options.currentSpeechModel()),
    ]);
    const caches = cacheFolders(userDataDir());
    const [leftoverBytes, modelBytes, cacheBytes] = await Promise.all([
      sizeOfAll(leftovers),
      sizeOfAll(models),
      sizeOfAll(caches),
    ]);
    const expired = services.memory.countExpired(now);
    const oldConversations = services.conversations.countOlderThan(conversationCutoff);
    const oldAudit = services.audit.countOlderThan(auditCutoff);
    // Record sizes are estimated (about 1.2 KB per memory/audit entry, 6 KB per conversation).
    return [
      {
        id: 'expired_memory',
        label: 'Expired memories',
        description: 'Facts that passed their expiry date.',
        bytes: expired * 1200,
        items: expired,
      },
      {
        id: 'old_conversations',
        label: `Conversations older than ${OLD_CONVERSATION_DAYS} days`,
        description: 'Saved chat history you have not opened or continued.',
        bytes: oldConversations * 6000,
        items: oldConversations,
      },
      {
        id: 'old_audit',
        label: `Activity log older than ${OLD_AUDIT_DAYS} days`,
        description: 'Old tool-call records.',
        bytes: oldAudit * 1200,
        items: oldAudit,
      },
      {
        id: 'unused_models',
        label: 'Unused speech models',
        description: 'Downloaded models other than the one you selected.',
        bytes: modelBytes,
        items: models.length,
      },
      {
        id: 'caches',
        label: 'Temporary caches',
        description: 'Rebuilt automatically when needed.',
        bytes: cacheBytes,
        items: caches.length,
      },
      {
        id: 'leftovers',
        label: 'Leftover temp and damaged-file copies',
        description: 'Files left behind by crashes or recovery.',
        bytes: leftoverBytes,
        items: leftovers.length,
      },
    ];
  }

  ipcMain.handle('storage:report', async (): Promise<StorageReport> => {
    flushServices(services);
    const [files, photosBytes, modelsBytes, cacheBytes, actions] = await Promise.all([
      dataFileSizes(services.dataDir),
      pathSize(path.join(services.dataDir, 'photos')),
      pathSize(modelsDir()),
      sizeOfAll(cacheFolders(userDataDir())),
      buildActions(),
    ]);
    const rows = [
      ...files.map((file) => ({ label: FILE_LABELS[file.name] ?? file.name, bytes: file.bytes })),
      { label: 'Photos', bytes: photosBytes },
      { label: 'Speech models', bytes: modelsBytes },
      { label: 'Caches', bytes: cacheBytes },
    ].filter((row) => row.bytes > 0);
    const processMemoryMb = Math.round(
      app.getAppMetrics().reduce((sum, entry) => sum + entry.memory.workingSetSize, 0) / 1024,
    );
    return {
      totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
      rows: rows.sort((a, b) => b.bytes - a.bytes),
      actions,
      processMemoryMb,
      speechModelLoaded: options.isSpeechModelLoaded(),
    };
  });

  ipcMain.handle('storage:cleanup', async (_e, ids: unknown): Promise<CleanupResult> => {
    const wanted = (Array.isArray(ids) ? ids : []).filter(
      (id): id is CleanupActionId =>
        typeof id === 'string' &&
        [
          'expired_memory',
          'old_conversations',
          'old_audit',
          'unused_models',
          'caches',
          'leftovers',
        ].includes(id),
    );
    const actions = await buildActions();
    const result: CleanupResult = {
      ok: true,
      freedBytes: 0,
      removedItems: 0,
      done: [],
      errors: [],
    };
    const now = Date.now();
    for (const id of new Set(wanted)) {
      const action = actions.find((entry) => entry.id === id);
      if (!action) continue;
      try {
        switch (id) {
          case 'expired_memory':
            result.removedItems += services.memory.purgeExpired(now);
            break;
          case 'old_conversations':
            result.removedItems += services.conversations.pruneOlderThan(
              now - OLD_CONVERSATION_DAYS * DAY_MS,
            );
            break;
          case 'old_audit':
            result.removedItems += services.audit.pruneOlderThan(now - OLD_AUDIT_DAYS * DAY_MS);
            break;
          case 'unused_models': {
            const paths = await findUnusedModels(modelsDir(), options.currentSpeechModel());
            for (const target of paths) await removePath(target);
            result.removedItems += paths.length;
            break;
          }
          case 'caches':
            await session.defaultSession.clearCache();
            await session.defaultSession.clearCodeCaches({});
            result.removedItems += 1;
            break;
          case 'leftovers': {
            const paths = await findLeftovers(services.dataDir);
            for (const target of paths) await removePath(target);
            result.removedItems += paths.length;
            break;
          }
        }
        result.freedBytes += action.bytes;
        result.done.push(id);
      } catch (error) {
        result.ok = false;
        result.errors.push(
          `${action.label}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    flushServices(services);
    return result;
  });

  /** Free memory right now: unload the speech model and drop renderer caches. */
  ipcMain.handle('storage:free-memory', async () => {
    unloadSpeechEngine();
    await session.defaultSession.clearCache();
    return true;
  });

  /* ---------- backup, restore, delete everything ---------- */
  ipcMain.handle('backup:export', async (): Promise<BackupResult> => {
    try {
      flushServices(services);
      const backup = createBackup(services.dataDir, app.getVersion());
      const window = getWindow();
      const saveOptions: Electron.SaveDialogOptions = {
        title: 'Save AI OS backup',
        defaultPath: `ai-os-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'AI OS backup', extensions: ['json'] }],
      };
      const picked = window
        ? await dialog.showSaveDialog(window, saveOptions)
        : await dialog.showSaveDialog(saveOptions);
      if (picked.canceled || !picked.filePath) return { ok: true, canceled: true };
      await fs.promises.writeFile(picked.filePath, JSON.stringify(backup), 'utf8');
      return { ok: true, path: picked.filePath, files: Object.keys(backup.files) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /** Step 1: choose a file and check it. Nothing is written yet. */
  ipcMain.handle('backup:choose', async (): Promise<RestorePreview> => {
    try {
      const window = getWindow();
      const openOptions: Electron.OpenDialogOptions = {
        title: 'Choose an AI OS backup',
        filters: [{ name: 'AI OS backup', extensions: ['json'] }],
        properties: ['openFile'],
      };
      const picked = window
        ? await dialog.showOpenDialog(window, openOptions)
        : await dialog.showOpenDialog(openOptions);
      if (picked.canceled || picked.filePaths.length === 0) return { ok: true, canceled: true };
      const text = await fs.promises.readFile(picked.filePaths[0], 'utf8');
      const { check, backup } = inspectBackup(text);
      if (!check.ok || !backup) return { ok: false, error: check.error };
      const token = randomUUID();
      pendingRestores.clear();
      pendingRestores.set(token, backup);
      return { ok: true, token, files: check.files, createdAt: check.createdAt };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /** Step 2: the user confirmed. A safety copy is made, files are replaced, and the app restarts. */
  ipcMain.handle('backup:restore', (_e, token: unknown) => {
    const backup = pendingRestores.get(asString(token, 'token', 80));
    if (!backup) throw new Error('Choose the backup again.');
    pendingRestores.clear();
    flushServices(services);
    const result = restoreBackup(services.dataDir, backup);
    // exit() skips the quit hooks, so in-memory data cannot overwrite the restored files.
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 400);
    return result;
  });

  /** Delete every piece of local data and restart. The renderer asks for explicit confirmation first. */
  ipcMain.handle('data:wipe-all', async (_e, confirm: unknown) => {
    if (confirm !== 'DELETE') throw new Error('Confirmation text did not match.');
    flushServices(services); // nothing may be pending, or a timer could recreate a file after deletion
    unloadSpeechEngine();
    const targets = [services.dataDir, ...cacheFolders(userDataDir())];
    for (const target of targets) await removePath(target);
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 400);
    return true;
  });
}
