import path from 'node:path';
import { app } from 'electron';
import type { IpcMain, WebContents } from 'electron';
import type { TranscribeResult } from '../../shared/protocol';
import { config } from '../config';
import { getContextGrant, setContextGrant } from '../context/grants';
import { JsonFile } from '../store/jsonFile';
import {
  DEFAULT_SPEECH_MODEL,
  MAX_SAMPLES,
  isKnownSpeechModel,
  onSpeechProgress,
  prepareSpeechModel,
  setKeepResident,
  transcribeSamples,
  warmUpSpeechModel,
  voiceConfig,
  type SttConfig,
} from '../voice/transcribe';
import { asObject, asString } from './validate';

interface VoiceSettings {
  version: 1;
  model: string;
  keepLoaded: boolean;
}

function toSamples(audio: unknown): Float32Array | null {
  if (audio instanceof Float32Array) return audio;
  if (audio instanceof ArrayBuffer && audio.byteLength % 4 === 0) return new Float32Array(audio);
  if (ArrayBuffer.isView(audio) && audio.byteLength % 4 === 0) {
    return new Float32Array(
      audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
    );
  }
  return null;
}

/** Offline speech-to-text and the session-scoped context grant. */
export function registerVoiceIpc(
  ipcMain: IpcMain,
  getWebContents: () => WebContents | null,
): { currentModel: () => string; warmUp: () => Promise<void> } {
  const settings = new JsonFile<VoiceSettings>(
    path.join(app.getPath('userData'), 'data', 'voice.json'),
    () => ({ version: 1, model: '', keepLoaded: true }),
    (raw) => {
      const data = raw as Partial<VoiceSettings> | null;
      return data && typeof data.model === 'string'
        ? { version: 1, model: data.model, keepLoaded: data.keepLoaded !== false }
        : null;
    },
  );

  const sttConfig = (): SttConfig => {
    const chosen = [settings.value.model, config.stt.model].find(
      (id) => id && isKnownSpeechModel(id),
    );
    return {
      model: chosen ?? DEFAULT_SPEECH_MODEL,
      language: config.stt.language,
      cacheDir: path.join(app.getPath('userData'), 'models'),
      appRoot: app.getAppPath(),
    };
  };

  setKeepResident(settings.value.keepLoaded);

  onSpeechProgress((progress) => {
    const contents = getWebContents();
    if (contents && !contents.isDestroyed()) contents.send('voice:progress', progress);
  });

  ipcMain.handle('voice:config', () => voiceConfig(sttConfig()));
  ipcMain.handle('voice:prepare', () => prepareSpeechModel(sttConfig()));
  ipcMain.handle('voice:set-model', (_event, model: unknown) => {
    const id = asString(model, 'model', 100);
    if (!isKnownSpeechModel(id)) throw new Error('Unknown speech model.');
    settings.set({ ...settings.value, version: 1, model: id });
    return voiceConfig(sttConfig());
  });

  ipcMain.handle('voice:set-keep-loaded', async (_event, on: unknown) => {
    const keep = on === true;
    settings.set({ ...settings.value, version: 1, keepLoaded: keep });
    setKeepResident(keep);
    if (keep) void warmUpSpeechModel(sttConfig());
    return voiceConfig(sttConfig());
  });

  ipcMain.handle('voice:transcribe', async (_event, audio: unknown): Promise<TranscribeResult> => {
    const samples = toSamples(audio);
    if (!samples) return { ok: false, error: 'No audio received.' };
    if (samples.length > MAX_SAMPLES) return { ok: false, error: 'The recording is too long.' };
    return transcribeSamples(sttConfig(), samples);
  });

  ipcMain.handle('context:get', () => getContextGrant());
  ipcMain.handle('context:set', (_event, patch: unknown) => {
    const data = asObject(patch, 'context');
    return setContextGrant({
      windows: typeof data.windows === 'boolean' ? data.windows : undefined,
    });
  });

  return { currentModel: () => sttConfig().model, warmUp: () => warmUpSpeechModel(sttConfig()) };
}
