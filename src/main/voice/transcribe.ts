import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { isPhantomTranscript } from '../../shared/audioPrep';
import type {
  SpeechModelOption,
  TranscribeResult,
  VoiceConfig,
  VoiceProgress,
} from '../../shared/protocol';

/** Whisper expects 16 kHz mono float samples. */
export const SAMPLE_RATE = 16_000;
export const MAX_SAMPLES = SAMPLE_RATE * 90;
export const SPEECH_MODELS: SpeechModelOption[] = [
  {
    id: 'Xenova/whisper-small.en',
    label: 'Accurate — small (English)',
    sizeMb: 250,
    note: 'Best English accuracy. Roughly 3-6 s per sentence on CPU.',
  },
  {
    id: 'Xenova/whisper-base.en',
    label: 'Balanced — base (English)',
    sizeMb: 80,
    note: 'Good for clear speech, about 1-2 s per sentence.',
  },
  {
    id: 'Xenova/whisper-tiny.en',
    label: 'Fast — tiny (English)',
    sizeMb: 40,
    note: 'Quickest, but misses names and technical words.',
  },
  {
    id: 'Xenova/whisper-small',
    label: 'Multilingual — small',
    sizeMb: 250,
    note: 'Many languages. Set AIOS_STT_LANGUAGE to force one.',
  },
];
export const DEFAULT_SPEECH_MODEL = SPEECH_MODELS[0].id;

export function isKnownSpeechModel(id: string): boolean {
  return SPEECH_MODELS.some((model) => model.id === id);
}

const ENGINE_PACKAGE = '@huggingface/transformers';
const IDLE_UNLOAD_MS = 90_000;
const RUN_TIMEOUT_MS = 120_000;
const LOAD_TIMEOUT_MS = 15 * 60_000;

export interface SttConfig {
  /** Hugging Face model id, e.g. Xenova/whisper-tiny.en. Downloaded once, then cached on disk. */
  model: string;
  language: string;
  cacheDir: string;
  appRoot: string;
}

/**
 * The recogniser runs in a worker thread so the UI never stalls. The worker source is inlined
 * (no extra bundle entry) and only ever sees audio samples, never file paths from the renderer.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
let recogniser = null;
let loading = null;

function load() {
  if (recogniser) return Promise.resolve(recogniser);
  if (loading) return loading;
  loading = (async () => {
    const engine = require(workerData.modulePath);
    engine.env.cacheDir = workerData.cacheDir;
    // Once the files are on disk the model is read straight from there: no network, no waiting.
    engine.env.localModelPath = workerData.cacheDir;
    engine.env.allowLocalModels = true;
    const files = new Map();
    const options = {
      dtype: 'q8',
      progress_callback: (info) => {
        if (info && info.status === 'progress' && info.file) {
          files.set(info.file, { loaded: info.loaded || 0, total: info.total || 0 });
          let loaded = 0;
          let total = 0;
          for (const entry of files.values()) { loaded += entry.loaded; total += entry.total; }
          parentPort.postMessage({ type: 'progress', percent: total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : null, status: 'downloading' });
        }
      },
    };
    if (workerData.cached) {
      try {
        engine.env.allowRemoteModels = false;
        recogniser = await engine.pipeline('automatic-speech-recognition', workerData.model, options);
        return recogniser;
      } catch (offlineError) {
        // Stored files look damaged or incomplete: fall back to fetching them again.
        engine.env.allowRemoteModels = true;
      }
    }
    engine.env.allowRemoteModels = true;
    recogniser = await engine.pipeline('automatic-speech-recognition', workerData.model, options);
    return recogniser;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

parentPort.on('message', async (message) => {
  try {
    if (message.type === 'load') {
      await load();
      parentPort.postMessage({ type: 'ready', id: message.id });
      return;
    }
    const model = await load();
    const options = { chunk_length_s: 30, stride_length_s: 5 };
    if (message.language && !workerData.model.endsWith('.en')) {
      options.language = message.language;
      options.task = 'transcribe';
    }
    const output = await model(message.samples, options);
    const text = Array.isArray(output) ? output.map((part) => part.text).join(' ') : output.text;
    parentPort.postMessage({ type: 'result', id: message.id, text: String(text || '') });
  } catch (error) {
    parentPort.postMessage({ type: 'error', id: message.id, message: String((error && error.message) || error) });
  }
});
`;

interface WorkerReply {
  type: 'ready' | 'result' | 'error' | 'progress';
  id: number;
  percent?: number | null;
  status?: VoiceProgress['status'];
  text?: string;
  message?: string;
}

let worker: Worker | null = null;
let workerModel = '';
let progressListener: ((progress: VoiceProgress) => void) | null = null;

/** Receive model download/load progress (used to show a percentage while the model downloads). */
export function onSpeechProgress(listener: ((progress: VoiceProgress) => void) | null): void {
  progressListener = listener;
}
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (reply: WorkerReply) => void; reject: (error: Error) => void }
>();

function resolveEngine(appRoot: string): string | null {
  try {
    return createRequire(path.join(appRoot, 'package.json')).resolve(ENGINE_PACKAGE);
  } catch {
    return null;
  }
}

function modelCacheExists(config: SttConfig): boolean {
  try {
    const onnxDir = path.join(config.cacheDir, ...config.model.split('/'), 'onnx');
    return fs.readdirSync(onnxDir).filter((name) => name.endsWith('.onnx')).length >= 2;
  } catch {
    return false;
  }
}

export function voiceConfig(config: SttConfig): VoiceConfig {
  return {
    sttConfigured: resolveEngine(config.appRoot) !== null,
    sttModel: config.model,
    sttLocal: true,
    modelCached: modelCacheExists(config),
    cacheDir: config.cacheDir,
    keepLoaded: keepResident,
    loaded: isSpeechEngineLoaded(),
    models: SPEECH_MODELS,
  };
}

/** Clears the "Loading the speech model" indicator, whichever way a load ended (done, failed or stopped). */
function endProgress(): void {
  progressListener?.({ percent: 100, status: 'ready' });
}

function failAll(error: Error): void {
  endProgress();
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

function stopWorker(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const current = worker;
  worker = null;
  if (current) void current.terminate();
  failAll(new Error('The speech engine was stopped.'));
}

/** While "Jarvis" listening is on, keep the model loaded so a command answers at once. */
let keepWarm = false;
export function setKeepWarm(value: boolean): void {
  keepWarm = value;
}

/** The user's "keep the voice model ready" choice: the model stays in memory so it never reloads. */
let keepResident = true;
export function setKeepResident(value: boolean): void {
  keepResident = value;
  if (value && idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}
export function isKeepResident(): boolean {
  return keepResident;
}

/** Load the stored model in the background at launch so the first "Jarvis" answers at once. */
export async function warmUpSpeechModel(config: SttConfig): Promise<void> {
  if (!modelCacheExists(config) || isSpeechEngineLoaded()) return;
  const modulePath = resolveEngine(config.appRoot);
  if (!modulePath) return;
  try {
    await request(config, modulePath, { type: 'load' }, LOAD_TIMEOUT_MS);
  } catch {
    // a failed warm-up is harmless; the first real use will report the problem
  }
}

/** Free the speech model's memory right now. It reloads on next use. */
export function unloadSpeechEngine(): void {
  stopWorker();
}

function scheduleIdleUnload(): void {
  if (idleTimer) clearTimeout(idleTimer);
  if (keepWarm || keepResident) return;
  idleTimer = setTimeout(() => {
    if (pending.size === 0) stopWorker();
  }, IDLE_UNLOAD_MS);
}

function startWorker(config: SttConfig, modulePath: string): Worker {
  if (worker && workerModel !== config.model) stopWorker();
  if (worker) return worker;
  fs.mkdirSync(config.cacheDir, { recursive: true });
  const created = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: {
      modulePath,
      cacheDir: config.cacheDir,
      model: config.model,
      cached: modelCacheExists(config),
    },
  });
  created.on('message', (reply: WorkerReply) => {
    if (reply.type === 'progress') {
      progressListener?.({ percent: reply.percent ?? null, status: 'downloading' });
      return;
    }
    if (reply.type === 'ready' || reply.type === 'error') endProgress();
    const entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);
    entry.resolve(reply);
  });
  created.on('error', (error) => {
    if (worker === created) worker = null;
    failAll(error);
  });
  created.on('exit', () => {
    if (worker === created) worker = null;
    failAll(new Error('The speech engine exited.'));
  });
  worker = created;
  workerModel = config.model;
  return created;
}

function request(
  config: SttConfig,
  modulePath: string,
  message: Record<string, unknown>,
  timeoutMs: number,
  transfer?: ArrayBuffer[],
): Promise<WorkerReply> {
  const target = startWorker(config, modulePath);
  const id = nextId++;
  if (idleTimer) clearTimeout(idleTimer);
  return new Promise<WorkerReply>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      stopWorker();
      endProgress();
      reject(new Error('The speech engine timed out.'));
    }, timeoutMs);
    pending.set(id, {
      resolve: (reply) => {
        clearTimeout(timer);
        scheduleIdleUnload();
        resolve(reply);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    target.postMessage({ ...message, id }, transfer ?? []);
  });
}

function describeError(message: string): string {
  if (/fetch|network|ENOTFOUND|EAI_AGAIN|ECONN|getaddrinfo|Failed to/i.test(message)) {
    return 'The speech model has not been downloaded yet and there is no internet connection. Connect once so it can download (about 40 MB), then it works offline.';
  }
  return `Speech recognition failed: ${message.slice(0, 160)}`;
}

/** Download (first run only) and load the model, so the first real recording is fast. */
export async function prepareSpeechModel(
  config: SttConfig,
): Promise<{ ok: boolean; error?: string }> {
  const modulePath = resolveEngine(config.appRoot);
  if (!modulePath) {
    return {
      ok: false,
      error: 'The speech engine is not installed. Run `npm install` and restart.',
    };
  }
  try {
    const reply = await request(config, modulePath, { type: 'load' }, LOAD_TIMEOUT_MS);
    if (reply.type === 'error') return { ok: false, error: describeError(reply.message ?? '') };
    progressListener?.({ percent: 100, status: 'ready' });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: describeError(error instanceof Error ? error.message : String(error)),
    };
  }
}

/** Transcribe 16 kHz mono samples entirely on this machine. */
export async function transcribeSamples(
  config: SttConfig,
  samples: Float32Array,
): Promise<TranscribeResult> {
  if (samples.length === 0) return { ok: false, error: 'The recording was empty.' };
  if (samples.length > MAX_SAMPLES) return { ok: false, error: 'The recording is too long.' };
  const modulePath = resolveEngine(config.appRoot);
  if (!modulePath) {
    return {
      ok: false,
      error: 'The speech engine is not installed. Run `npm install` and restart, or type instead.',
    };
  }
  try {
    const copy = new Float32Array(samples);
    const reply = await request(
      config,
      modulePath,
      { type: 'run', samples: copy, language: config.language },
      RUN_TIMEOUT_MS,
      [copy.buffer as ArrayBuffer],
    );
    if (reply.type === 'error') return { ok: false, error: describeError(reply.message ?? '') };
    const text = (reply.text ?? '')
      .replace(/\[[A-Z_ ]+\]|\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || isPhantomTranscript(text)) {
      return { ok: false, error: 'No speech was recognised. Try again, or type instead.' };
    }
    return { ok: true, text };
  } catch (error) {
    return {
      ok: false,
      error: describeError(error instanceof Error ? error.message : String(error)),
    };
  }
}

export function isSpeechEngineLoaded(): boolean {
  return worker !== null;
}

export function shutdownSpeechEngine(): void {
  stopWorker();
}
