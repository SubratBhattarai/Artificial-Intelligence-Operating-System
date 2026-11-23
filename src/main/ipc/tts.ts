import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, type BrowserWindow, type IpcMain } from 'electron';
import type { TtsQuality, TtsStatus } from '../../shared/tts';
import { JsonFile } from '../store/jsonFile';
import { QwenTts } from '../voice/qwenTts';
import { asObject } from './validate';

interface TtsSettings {
  version: 1;
  quality: TtsQuality;
  enabled: boolean;
  /** Name of the bundled voice clip already applied, so it is only used once and later choices stick. */
  bundledReference: string;
}

const BUNDLED_REFERENCE = 'british-girl.wav';

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

export function registerTtsIpc(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  send: (channel: string, payload: unknown) => void,
): { qwen: QwenTts; shutdown: () => void } {
  const settings = new JsonFile<TtsSettings>(
    path.join(app.getPath('userData'), 'data', 'tts.json'),
    () => ({ version: 1, quality: 'fast', enabled: true, bundledReference: '' }),
    (raw) => {
      const data = raw as Partial<TtsSettings> | null;
      return data
        ? {
            version: 1,
            quality: data.quality === 'best' ? 'best' : 'fast',
            enabled: data.enabled !== false,
            bundledReference:
              typeof data.bundledReference === 'string' ? data.bundledReference : '',
          }
        : null;
    },
  );
  const qwen = new QwenTts(
    {
      root: path.join(app.getPath('userData'), 'tts'),
      scriptDir: path.join(app.getAppPath(), 'tts'),
      onStatus: (status: TtsStatus) => send('tts:status', status),
    },
    settings.value,
  );

  // The voice clip shipped with AI OS (a British female voice) becomes the reference once.
  // Choosing another clip later in Settings is kept; this never overrides it again.
  const bundledClip = path.join(app.getAppPath(), 'tts', 'voices', BUNDLED_REFERENCE);
  if (settings.value.bundledReference !== BUNDLED_REFERENCE && fs.existsSync(bundledClip)) {
    try {
      qwen.setReference(bundledClip, '');
      settings.set({ ...settings.value, bundledReference: BUNDLED_REFERENCE });
    } catch {
      // not fatal: the person can still choose a clip in Settings
    }
  }

  ipcMain.handle('tts:status', () => qwen.status());
  ipcMain.handle('tts:install', () => {
    void qwen.install();
    return qwen.status();
  });
  ipcMain.handle('tts:cancel-install', () => {
    qwen.cancelInstall();
    return true;
  });
  ipcMain.handle('tts:configure', (_e, raw: unknown) => {
    const input = asObject(raw, 'settings');
    const next: TtsSettings = {
      version: 1,
      quality:
        input.quality === 'best'
          ? 'best'
          : input.quality === 'fast'
            ? 'fast'
            : settings.value.quality,
      enabled: typeof input.enabled === 'boolean' ? input.enabled : settings.value.enabled,
      bundledReference: settings.value.bundledReference,
    };
    settings.set(next);
    qwen.configure(next);
    if (next.enabled) void qwen.start();
    return qwen.status();
  });
  ipcMain.handle('tts:set-reference', async (_e, transcript: unknown) => {
    const window = getWindow();
    const options = {
      title: 'Choose a reference voice clip (5–10 seconds, clear, one speaker)',
      properties: ['openFile' as const],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] }],
    };
    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || !picked.filePaths[0]) return qwen.status();
    const size = fs.statSync(picked.filePaths[0]).size;
    if (size > MAX_REFERENCE_BYTES)
      throw new Error('That clip is too large. Use one of about 5–10 seconds.');
    qwen.setReference(
      picked.filePaths[0],
      typeof transcript === 'string' ? transcript.slice(0, 600) : '',
    );
    if (settings.value.enabled) void qwen.start();
    return qwen.status();
  });
  /** Never blocks: when the helper is not ready the renderer simply uses the Windows voice. */
  ipcMain.handle('tts:speak', async (_e, text: unknown) => {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Nothing to say.');
    const status = qwen.status();
    if (status.state === 'stopped') void qwen.start();
    return qwen.speak(text.slice(0, 700));
  });
  ipcMain.handle('tts:stop', () => {
    qwen.stop();
    return qwen.status();
  });

  // Start in the background at launch so the first sentence is not the slow one.
  const warm = setTimeout(() => {
    const status = qwen.status();
    if (settings.value.enabled && status.state === 'stopped' && status.hasReference)
      void qwen.start();
  }, 4000);
  return {
    qwen,
    shutdown: () => {
      clearTimeout(warm);
      qwen.stop();
    },
  };
}
