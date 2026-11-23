import fs from 'node:fs/promises';
import { dialog, type BrowserWindow, type IpcMain } from 'electron';
import type {
  ExportResult,
  MemoryExport,
  MemoryInput,
  MemoryPatch,
  SearchHitKind,
} from '../../shared/protocol';
import { searchAll } from '../memory/searchAll';
import type { Services } from '../services';
import { asId, asObject, asOptionalNumber, asString } from './validate';

const KINDS: SearchHitKind[] = ['memory', 'note', 'conversation'];

function parseExpiry(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return asOptionalNumber(value);
}

export function buildExport(services: Services): MemoryExport {
  return {
    version: 1,
    exportedAt: Date.now(),
    settings: services.memory.getSettings(),
    memories: services.memory.list({ includeExpired: true }),
    notes: services.notes.list(),
    conversations: services.conversations.all().map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({ ...message })),
    })),
  };
}

export function registerMemoryIpc(
  ipcMain: IpcMain,
  services: Services,
  getWindow: () => BrowserWindow | null,
): void {
  const { memory, notes, conversations } = services;

  /* ---- memory records ---- */
  ipcMain.handle('memory:list', (_event, options?: unknown) => {
    const includeExpired =
      typeof options === 'object' &&
      options !== null &&
      (options as { includeExpired?: unknown }).includeExpired === true;
    return memory.list({ includeExpired });
  });
  ipcMain.handle('memory:add', (_event, input: unknown) => {
    const data = asObject(input, 'memory');
    const payload: MemoryInput = {
      fact: asString(data.fact, 'fact', 600),
      confidence: asOptionalNumber(data.confidence),
      expiresAt: parseExpiry(data.expiresAt),
    };
    return memory.add(payload);
  });
  ipcMain.handle('memory:update', (_event, id: unknown, patch: unknown) => {
    const data = asObject(patch, 'changes');
    const payload: MemoryPatch = {};
    if (data.fact !== undefined) payload.fact = asString(data.fact, 'fact', 600);
    if (data.confidence !== undefined) payload.confidence = asOptionalNumber(data.confidence);
    if (data.expiresAt !== undefined) payload.expiresAt = parseExpiry(data.expiresAt);
    return memory.update(asId(id), payload);
  });
  ipcMain.handle('memory:approve', (_event, id: unknown) => memory.approve(asId(id)));
  ipcMain.handle('memory:remove', (_event, id: unknown) => memory.remove(asId(id)));
  ipcMain.handle('memory:removeBySource', (_event, key: unknown) =>
    memory.removeBySource(asString(key, 'source', 300)),
  );
  ipcMain.handle('memory:sources', () => memory.sources());
  ipcMain.handle('memory:purgeExpired', () => memory.purgeExpired());
  ipcMain.handle('memory:clearAll', () => memory.clearAll());
  ipcMain.handle('memory:getSettings', () => memory.getSettings());
  ipcMain.handle('memory:setSettings', (_event, patch: unknown) => {
    const data = asObject(patch, 'settings');
    return memory.setSettings({
      injectIntoPrompt:
        typeof data.injectIntoPrompt === 'boolean' ? data.injectIntoPrompt : undefined,
    });
  });

  /* ---- notes ---- */
  ipcMain.handle('notes:list', () => notes.list());
  ipcMain.handle('notes:create', (_event, body?: unknown) =>
    notes.create(body === undefined ? '' : asString(body, 'note', 200_000)),
  );
  ipcMain.handle('notes:update', (_event, id: unknown, body: unknown) =>
    notes.update(asId(id), asString(body, 'note', 200_000)),
  );
  ipcMain.handle('notes:remove', (_event, id: unknown) => notes.remove(asId(id)));

  /* ---- conversations ---- */
  ipcMain.handle('conversations:list', () => conversations.list());
  ipcMain.handle('conversations:get', (_event, id: unknown) => conversations.get(asId(id)));
  ipcMain.handle('conversations:remove', (_event, id: unknown) => conversations.remove(asId(id)));
  ipcMain.handle('conversations:clearAll', () => conversations.clearAll());

  /* ---- search ---- */
  ipcMain.handle('search:all', (_event, query: unknown, kinds?: unknown) => {
    const text = asString(query, 'query', 500).trim();
    if (!text) return [];
    const wanted = Array.isArray(kinds)
      ? kinds.filter((kind): kind is SearchHitKind => KINDS.includes(kind as SearchHitKind))
      : undefined;
    return searchAll({ memory, notes, conversations }, text, { kinds: wanted });
  });

  /* ---- export (always a user-chosen file) ---- */
  ipcMain.handle('memory:export', async (): Promise<ExportResult> => {
    try {
      const window = getWindow();
      const options = {
        title: 'Export AI OS memory',
        defaultPath: `ai-os-memory-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      };
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      await fs.writeFile(result.filePath, JSON.stringify(buildExport(services), null, 2), 'utf8');
      return { ok: true, path: result.filePath };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
