import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { TtsAudio, TtsQuality, TtsState, TtsStatus } from '../../shared/tts';

const MODELS: Record<TtsQuality, string> = {
  fast: 'Qwen/Qwen3-TTS-12Hz-0.6B-Base',
  best: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base',
};
const START_TIMEOUT_MS = 20 * 60_000;
const INSTALL_TIMEOUT_MS = 45 * 60_000;
const SPEAK_TIMEOUT_MS = 30_000;

/** Qwen3-TTS asks for Python 3.12; 3.10–3.12 are accepted. */
export function parsePythonVersion(text: string): { ok: boolean; version: string } {
  const match = text.match(/Python (\d+)\.(\d+)\.(\d+)/);
  if (!match) return { ok: false, version: '' };
  const minor = Number(match[2]);
  return { ok: match[1] === '3' && minor >= 10 && minor <= 12, version: `${match[1]}.${match[2]}` };
}

export function venvPython(root: string, platform = process.platform): string {
  return platform === 'win32'
    ? path.join(root, 'venv', 'Scripts', 'python.exe')
    : path.join(root, 'venv', 'bin', 'python');
}

function run(file: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 15_000, windowsHide: true }, (error, stdout, stderr) =>
      resolve({ code: error ? 1 : 0, out: `${stdout}${stderr}` }),
    );
  });
}

async function findPython(): Promise<{ file: string; args: string[] } | null> {
  const candidates: Array<{ file: string; args: string[] }> = [
    { file: 'py', args: ['-3.12'] },
    { file: 'py', args: ['-3.11'] },
    { file: 'py', args: ['-3.10'] },
    { file: 'python', args: [] },
    { file: 'python3', args: [] },
  ];
  for (const candidate of candidates) {
    const result = await run(candidate.file, [...candidate.args, '--version']);
    if (result.code === 0 && parsePythonVersion(result.out).ok) return candidate;
  }
  return null;
}

export interface QwenTtsOptions {
  /** <userData>/tts */
  root: string;
  /** Folder containing qwen_server.py */
  scriptDir: string;
  onStatus: (status: TtsStatus) => void;
}

export class QwenTts {
  private state: TtsState = 'not_installed';
  private message = '';
  private log: string[] = [];
  private device: string | undefined;
  private rtf: number | undefined;
  private child: ChildProcess | null = null;
  private port = 0;
  private token = randomBytes(24).toString('hex');
  private installAbort: AbortController | null = null;
  private quality: TtsQuality;
  private enabled: boolean;

  constructor(
    private readonly options: QwenTtsOptions,
    initial: { quality: TtsQuality; enabled: boolean },
  ) {
    this.quality = initial.quality;
    this.enabled = initial.enabled;
    fs.mkdirSync(options.root, { recursive: true });
    this.state =
      fs.existsSync(venvPython(options.root)) && fs.existsSync(this.marker())
        ? 'stopped'
        : 'not_installed';
    this.message = this.describe();
  }

  private marker(): string {
    return path.join(this.options.root, 'installed.ok');
  }
  /** The chosen clip keeps its own extension (wav, mp3, flac, ogg, m4a); the helper converts it. */
  private referencePath(): string {
    const found = fs
      .readdirSync(this.options.root)
      .find((name) => /^reference\.(wav|mp3|flac|ogg|m4a)$/i.test(name));
    return path.join(this.options.root, found ?? 'reference.wav');
  }
  private referenceTextPath(): string {
    return path.join(this.options.root, 'reference.txt');
  }

  private describe(): string {
    switch (this.state) {
      case 'not_installed':
        return 'Not set up. Setup installs a local Python helper (about 3 GB) and, on first start, the voice model (about 2–4 GB).';
      case 'installing':
        return 'Installing the local voice helper…';
      case 'stopped':
        return this.hasReference()
          ? 'Installed. It starts when AI OS needs to speak.'
          : 'Installed. Choose a reference voice clip to finish.';
      case 'starting':
        return 'Loading the voice model (the first start also downloads it)…';
      case 'ready':
        return 'Ready.';
      default:
        return this.message;
    }
  }

  hasReference(): boolean {
    return fs.existsSync(this.referencePath());
  }

  status(): TtsStatus {
    return {
      state: this.state,
      message: this.state === 'error' ? this.message : this.describe(),
      log: this.log.slice(-6),
      device: this.device,
      rtf: this.rtf,
      hasReference: this.hasReference(),
      quality: this.quality,
      enabled: this.enabled,
    };
  }

  private set(state: TtsState, message?: string): void {
    this.state = state;
    if (message !== undefined) this.message = message;
    this.options.onStatus(this.status());
  }

  private push(line: string): void {
    const clean = line.trim().slice(0, 200);
    if (!clean) return;
    this.log = [...this.log, clean].slice(-20);
    this.options.onStatus(this.status());
  }

  configure(settings: { quality?: TtsQuality; enabled?: boolean }): void {
    if (settings.quality && settings.quality !== this.quality) {
      this.quality = settings.quality;
      this.stop();
    }
    if (typeof settings.enabled === 'boolean') this.enabled = settings.enabled;
    this.options.onStatus(this.status());
  }

  /** Copy the chosen clip (and optional transcript) into the helper's private folder. */
  setReference(sourcePath: string, transcript: string): void {
    const extension = path.extname(sourcePath).toLowerCase();
    if (!['.wav', '.mp3', '.flac', '.ogg', '.m4a'].includes(extension)) {
      throw new Error('Use a WAV, MP3, FLAC, OGG or M4A clip.');
    }
    for (const name of fs.readdirSync(this.options.root)) {
      if (/^reference\.(wav|mp3|flac|ogg|m4a)$/i.test(name))
        fs.rmSync(path.join(this.options.root, name), { force: true });
    }
    fs.copyFileSync(sourcePath, path.join(this.options.root, `reference${extension}`));
    if (transcript.trim()) fs.writeFileSync(this.referenceTextPath(), transcript.trim(), 'utf8');
    else fs.rmSync(this.referenceTextPath(), { force: true });
    this.stop();
    if (this.state === 'error') this.set('stopped');
    else this.options.onStatus(this.status());
  }

  /** One-time install into a private virtual environment. Output is shown, never run through a shell. */
  async install(): Promise<void> {
    if (this.state === 'installing') return;
    this.log = [];
    this.set('installing');
    this.installAbort = new AbortController();
    const python = await findPython();
    if (!python) {
      this.set(
        'error',
        'Python 3.10–3.12 was not found. Install Python 3.12 from python.org (tick “Add to PATH”), then try again.',
      );
      return;
    }
    const steps: Array<{ file: string; args: string[] }> = [
      {
        file: python.file,
        args: [...python.args, '-m', 'venv', path.join(this.options.root, 'venv')],
      },
      { file: venvPython(this.options.root), args: ['-m', 'pip', 'install', '--upgrade', 'pip'] },
      {
        file: venvPython(this.options.root),
        args: ['-m', 'pip', 'install', '--upgrade', 'qwen-tts', 'soundfile'],
      },
    ];
    try {
      for (const step of steps) await this.runStep(step.file, step.args);
      fs.writeFileSync(this.marker(), new Date().toISOString());
      this.set('stopped');
    } catch (error) {
      this.set(
        'error',
        `Setup did not finish: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.installAbort = null;
    }
  }

  cancelInstall(): void {
    this.installAbort?.abort();
  }

  private runStep(file: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, {
        windowsHide: true,
        signal: this.installAbort?.signal,
        env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1' },
      });
      const timer = setTimeout(() => child.kill(), INSTALL_TIMEOUT_MS);
      const onData = (chunk: Buffer) =>
        chunk
          .toString('utf8')
          .split(/\r?\n/)
          .forEach((line) => this.push(line));
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`a step failed (exit ${code})`));
      });
    });
  }

  /** Start the helper and wait until the model is loaded. Safe to call repeatedly. */
  async start(): Promise<boolean> {
    if (this.state === 'ready') return true;
    if (this.state === 'starting' || this.state === 'installing') return this.waitReady();
    if (this.state !== 'stopped' && this.state !== 'error') return false;
    if (!this.hasReference() || !fs.existsSync(venvPython(this.options.root))) return false;

    this.log = [];
    this.set('starting');
    this.token = randomBytes(24).toString('hex');
    const args = [
      path.join(this.options.scriptDir, 'qwen_server.py'),
      '--model',
      MODELS[this.quality],
      '--ref-audio',
      this.referencePath(),
      '--ref-text',
      this.referenceTextPath(),
    ];
    const child = spawn(venvPython(this.options.root), args, {
      windowsHide: true,
      env: {
        ...process.env,
        AIOS_TTS_TOKEN: this.token,
        HF_HOME: path.join(this.options.root, 'hf'),
        HF_HUB_DISABLE_TELEMETRY: '1',
        PYTHONUNBUFFERED: '1',
      },
    });
    this.child = child;
    const onLine = (line: string) => {
      const port = line.match(/^PORT=(\d+)$/);
      if (port) this.port = Number(port[1]);
      else if (line.startsWith('READY')) {
        this.device = line.match(/device=(\S+)/)?.[1];
        this.set('ready', 'Ready.');
      } else if (line.startsWith('ERROR'))
        this.set('error', `The voice model could not start: ${line.slice(6)}`);
      else this.push(line);
    };
    const pipe = (stream: NodeJS.ReadableStream) =>
      stream.on('data', (chunk: Buffer) => chunk.toString('utf8').split(/\r?\n/).forEach(onLine));
    pipe(child.stdout);
    pipe(child.stderr);
    child.on('close', () => {
      if (this.child === child) {
        this.child = null;
        this.port = 0;
        if (this.state === 'ready' || this.state === 'starting') this.set('stopped');
      }
    });
    return this.waitReady();
  }

  private waitReady(): Promise<boolean> {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (this.state === 'ready') return resolve(true);
        if (this.state !== 'starting' || Date.now() - started > START_TIMEOUT_MS)
          return resolve(false);
        setTimeout(tick, 400);
      };
      tick();
    });
  }

  /** Synthesize one short piece of text. Throws when the helper is not ready or too slow. */
  async speak(text: string, signal?: AbortSignal): Promise<TtsAudio> {
    if (!this.enabled) throw new Error('The Qwen voice is switched off.');
    if (this.state !== 'ready' || !this.port) throw new Error('The Qwen voice is not ready.');
    const response = await fetch(`http://127.0.0.1:${this.port}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-token': this.token },
      body: JSON.stringify({ text: text.slice(0, 700) }),
      signal: signal ?? AbortSignal.timeout(SPEAK_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`The Qwen voice failed (${response.status}).`);
    const rtf = Number(response.headers.get('x-rtf') ?? '0');
    if (Number.isFinite(rtf) && rtf > 0) this.rtf = rtf;
    return { wav: new Uint8Array(await response.arrayBuffer()), rtf: this.rtf ?? 0 };
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.port = 0;
    child?.kill();
    if (this.state === 'ready' || this.state === 'starting') this.set('stopped');
  }
}
