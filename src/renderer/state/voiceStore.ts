import { create } from 'zustand';
import { chunkForSpeech } from '../lib/speechChunks';
import { useTts } from './ttsStore';
import { prepareSpeech } from '../../shared/audioPrep';
import type { VoiceConfig, VoiceProgress } from '../../shared/protocol';
import { pickPreferredVoice } from '../lib/voices';

export type VoicePhase = 'idle' | 'requesting' | 'recording' | 'transcribing';

/** A recording shorter than this was an accidental tap and is discarded. */
const MIN_RECORDING_MS = 350;
/** Recording always stops by itself after this long. */
const MAX_RECORDING_MS = 60_000;
const PREFS_KEY = 'aios.voice.v1';
const STYLE_FLAG = 'aios.voice.style.v2';
/** Whisper runs on 16 kHz mono audio. */
const STT_SAMPLE_RATE = 16_000;
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

export interface VoicePrefs {
  /** Send the transcript straight away (otherwise it is placed in the input for review). */
  autoSend: boolean;
  /** Read JARVIS's replies aloud. */
  speakReplies: boolean;
  /** Silence all speech output. */
  muted: boolean;
  /** Chosen system voice (null = the system default). */
  voiceUri: string | null;
  /** Speaking speed, 0.6 to 1.6. */
  rate: number;
  /** Voice pitch, 0.6 to 1.6. */
  pitch: number;
  /** Wait for the natural (Qwen) voice instead of switching to the Windows voice when it is slow. */
  waitForNaturalVoice: boolean;
}

const DEFAULT_PREFS: VoicePrefs = {
  autoSend: true,
  speakReplies: true,
  muted: false,
  voiceUri: null,
  // Warm, composed, a touch low and unhurried.
  rate: 0.97,
  pitch: 0.92,
  waitForNaturalVoice: true,
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function loadPrefs(): VoicePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<VoicePrefs>;
    // One-time move to the new default voice style (rate/pitch/voice); the user's other choices stay.
    if (localStorage.getItem(STYLE_FLAG) !== '1') {
      localStorage.setItem(STYLE_FLAG, '1');
      return {
        ...DEFAULT_PREFS,
        autoSend: parsed.autoSend !== false,
        speakReplies: parsed.speakReplies !== false,
        muted: parsed.muted === true,
      };
    }
    return {
      autoSend: parsed.autoSend !== false,
      speakReplies: parsed.speakReplies !== false,
      muted: parsed.muted === true,
      voiceUri: typeof parsed.voiceUri === 'string' ? parsed.voiceUri : null,
      rate: clampNumber(parsed.rate, 0.6, 1.6, DEFAULT_PREFS.rate),
      pitch: clampNumber(parsed.pitch, 0.6, 1.6, DEFAULT_PREFS.pitch),
      waitForNaturalVoice: parsed.waitForNaturalVoice !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface VoiceState {
  phase: VoicePhase;
  elapsedMs: number;
  /** 0..1 live input level while recording. */
  level: number;
  error: string | null;
  speaking: boolean;
  /** Which voice spoke the last reply, and why the Windows voice was used if it was. */
  voiceNote: string | null;
  config: VoiceConfig | null;
  /** Speech-model download/load progress while it is being fetched. */
  modelProgress: VoiceProgress | null;
  prefs: VoicePrefs;
  /** The latest recognised speech; consumers react to a new `id`. */
  transcript: { id: number; text: string } | null;
  loadConfig: () => Promise<void>;
  setModel: (model: string) => Promise<void>;
  /** Download and load the chosen speech model now, instead of on first use. */
  prepareModel: () => Promise<void>;
  /** Speak a short sample with the current voice settings. */
  previewVoice: () => void;
  start: () => Promise<void>;
  /** Stop recording and transcribe. */
  stop: () => void;
  /** Stop recording and throw the audio away. */
  cancel: () => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  setPref: <K extends keyof VoicePrefs>(key: K, value: VoicePrefs[K]) => void;
  clearError: () => void;
}

/* Recording resources live outside React state so they can never leak into a render. */
let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let recordedMime = 'audio/webm';
let startedAt = 0;
let ticker: ReturnType<typeof setInterval> | null = null;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let discardRecording = false;
let abortPendingStart = false;
let transcribeJob = 0;
let transcriptCounter = 0;
let speechToken = 0;

/** Read by the orb's animation loop; kept outside the store so word pulses cost no re-renders. */
let progressBound = false;
function bindProgressEvents(): void {
  if (progressBound || !window.aios) return;
  progressBound = true;
  window.aios.voice.onProgress((progress) => {
    useVoice.setState({ modelProgress: progress.status === 'ready' ? null : progress });
  });
}

export const speechActivity = { lastBoundaryAt: 0 };

async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const mixed = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const data = decoded.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        mixed[index] += data[index] / decoded.numberOfChannels;
      }
    }
    return mixed;
  } finally {
    void context.close().catch(() => undefined);
  }
}

function releaseMicrophone(): void {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  void audioContext?.close().catch(() => undefined);
  audioContext = null;
  analyser = null;
  recorder = null;
}

function friendlyMicError(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access was blocked. Allow microphone access for AI OS in Windows privacy settings, or type instead.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found. Plug one in, or type instead.';
  }
  if (name === 'NotReadableError') return 'The microphone is in use by another app.';
  return 'Could not start the microphone. You can type instead.';
}

function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code block. ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[(\d+)\]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/[*_#>~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chrome stops long utterances after ~15 s, so speak sentence by sentence. */
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?\n]+[.!?]*/g) ?? [];
  return matches.map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
}

const FIRST_CHUNK_BUDGET_MS = 5000;
const LATER_CHUNK_BUDGET_MS = 9000;
/** When the person chose to wait for the natural voice, give a slow CPU time to produce the first sound. */
const PATIENT_BUDGET_MS = 45_000;

let qwenAudio: HTMLAudioElement | null = null;
let qwenUrl: string | null = null;

function stopQwenAudio(): void {
  qwenAudio?.pause();
  qwenAudio = null;
  if (qwenUrl) URL.revokeObjectURL(qwenUrl);
  qwenUrl = null;
}

/** Play one WAV and resolve when it ends (or is stopped). */
function playQwenAudio(wav: Uint8Array, token: number): Promise<void> {
  return new Promise((resolve) => {
    stopQwenAudio();
    const url = URL.createObjectURL(new Blob([wav as BlobPart], { type: 'audio/wav' }));
    const audio = new Audio(url);
    qwenAudio = audio;
    qwenUrl = url;
    const done = () => {
      if (qwenAudio === audio) stopQwenAudio();
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.onpause = () => {
      if (token !== speechToken) done();
    };
    void audio.play().catch(done);
  });
}

export const useVoice = create<VoiceState>((set, get) => ({
  phase: 'idle',
  elapsedMs: 0,
  level: 0,
  error: null,
  speaking: false,
  voiceNote: null,
  config: null,
  modelProgress: null,
  prefs: loadPrefs(),
  transcript: null,

  async setModel(model: string) {
    try {
      const config = await window.aios?.voice.setModel(model);
      if (config) set({ config, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  async prepareModel() {
    const api = window.aios;
    if (!api) return;
    set({ modelProgress: { percent: null, status: 'downloading' }, error: null });
    try {
      const result = await api.voice.prepare();
      if (!result.ok) set({ error: result.error ?? 'Could not load the speech model.' });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ modelProgress: null });
      void get().loadConfig();
    }
  },

  previewVoice() {
    get().speak('Hello, I am JARVIS. This is how I will sound when I read my replies.');
  },

  async loadConfig() {
    bindProgressEvents();
    try {
      const config = await window.aios?.voice.config();
      if (config) set({ config });
    } catch {
      set({
        config: {
          sttConfigured: false,
          sttModel: '',
          sttLocal: true,
          modelCached: false,
          cacheDir: '',
          keepLoaded: true,
          loaded: false,
          models: [],
        },
      });
    }
  },

  async start() {
    if (get().phase !== 'idle') return;
    const api = window.aios;
    if (!api) {
      set({ error: 'The app bridge is unavailable — run AI OS through Electron.' });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      set({ error: 'Recording is not supported here. Type instead.' });
      return;
    }

    get().stopSpeaking();
    abortPendingStart = false;
    discardRecording = false;
    set({ phase: 'requesting', error: null, elapsedMs: 0, level: 0 });

    let granted: MediaStream;
    try {
      granted = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      set({ phase: 'idle', error: friendlyMicError(error) });
      return;
    }
    if (abortPendingStart) {
      granted.getTracks().forEach((track) => track.stop());
      set({ phase: 'idle' });
      return;
    }

    stream = granted;
    recordedChunks = [];
    recordedMime = MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
    try {
      recorder = recordedMime
        ? new MediaRecorder(granted, { mimeType: recordedMime })
        : new MediaRecorder(granted);
    } catch {
      releaseMicrophone();
      set({ phase: 'idle', error: 'Could not start recording. Type instead.' });
      return;
    }
    recordedMime = recorder.mimeType || recordedMime || 'audio/webm';

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };
    recorder.onstop = () => void finishRecording();

    try {
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      audioContext.createMediaStreamSource(granted).connect(analyser);
    } catch {
      analyser = null; // the level meter is optional
    }

    startedAt = Date.now();
    recorder.start(250);
    set({ phase: 'recording', elapsedMs: 0 });

    const samples = new Uint8Array(512);
    ticker = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      let level = 0;
      if (analyser) {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const centred = (sample - 128) / 128;
          sum += centred * centred;
        }
        level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
      }
      set({ elapsedMs, level });
      if (elapsedMs >= MAX_RECORDING_MS) get().stop();
    }, 100);
  },

  stop() {
    const { phase } = get();
    if (phase === 'requesting') {
      abortPendingStart = true;
      return;
    }
    if (phase === 'recording' && recorder && recorder.state !== 'inactive') recorder.stop();
  },

  cancel() {
    const { phase } = get();
    if (phase === 'requesting') {
      abortPendingStart = true;
      return;
    }
    if (phase === 'recording' && recorder && recorder.state !== 'inactive') {
      discardRecording = true;
      recorder.stop();
      return;
    }
    if (phase === 'transcribing') {
      transcribeJob += 1; // ignore the answer when it arrives
      set({ phase: 'idle' });
    }
  },

  speak(text: string) {
    const { prefs } = get();
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || prefs.muted) return;
    const sentences = splitSentences(stripForSpeech(text)).slice(0, 80);
    if (sentences.length === 0) return;

    speechToken += 1;
    const token = speechToken;
    synth.cancel();
    stopQwenAudio();
    set({ speaking: true });
    const voices = synth.getVoices();
    const chosen =
      (prefs.voiceUri ? voices.find((voice) => voice.voiceURI === prefs.voiceUri) : undefined) ??
      pickPreferredVoice(voices);

    const speakWindows = (sentence: string): Promise<void> =>
      new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(sentence);
        if (chosen) {
          utterance.voice = chosen;
          utterance.lang = chosen.lang;
        } else {
          utterance.lang = 'en-US';
        }
        utterance.rate = prefs.rate;
        utterance.pitch = prefs.pitch;
        utterance.onboundary = () => {
          speechActivity.lastBoundaryAt = performance.now();
        };
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        synth.speak(utterance);
      });

    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const finish = () => {
      if (token === speechToken) set({ speaking: false });
    };

    const qwen = useTts.getState().status;
    const useQwen = qwen?.state === 'ready' && qwen.enabled && Boolean(window.aios?.tts);
    const patient = prefs.waitForNaturalVoice;
    const firstBudget = patient ? PATIENT_BUDGET_MS : FIRST_CHUNK_BUDGET_MS;
    const laterBudget = patient ? PATIENT_BUDGET_MS : LATER_CHUNK_BUDGET_MS;
    if (!useQwen && qwen?.enabled !== false && qwen?.state !== undefined) {
      set({ voiceNote: `Windows voice used: the natural voice is not ready (${qwen.message}).` });
    } else if (!useQwen) {
      set({ voiceNote: 'Windows voice used: the natural voice is not set up or is turned off.' });
    } else {
      set({ voiceNote: 'Preparing the natural voice…' });
    }

    void (async () => {
      if (!useQwen) {
        for (let index = 0; index < sentences.length && token === speechToken; index += 1) {
          await speakWindows(sentences[index]);
          // A short, natural breath between sentences; a little longer after a question.
          await pause(/\?$/.test(sentences[index]) ? 340 : 230);
        }
        finish();
        return;
      }
      const chunks = chunkForSpeech(sentences);
      const fetchAudio = (index: number): Promise<Uint8Array | null> =>
        index < chunks.length
          ? window.aios!.tts.speak(chunks[index]).then(
              (result) => result.wav,
              () => null,
            )
          : Promise.resolve(null);
      const within = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
        Promise.race([promise, pause(ms).then(() => null)]);

      let pending = fetchAudio(0);
      let next = fetchAudio(1);
      for (let index = 0; index < chunks.length && token === speechToken; index += 1) {
        // The first chunk has a short budget: if the voice is too slow on this computer, the whole
        // reply is spoken by the Windows voice instead so the person is never kept waiting.
        const audio = await within(pending, index === 0 ? firstBudget : laterBudget);
        if (token !== speechToken) return;
        if (!audio && index === 0) {
          set({
            voiceNote: `Windows voice used: the natural voice took longer than ${Math.round(firstBudget / 1000)} s to start on this computer.`,
          });
          for (let rest = 0; rest < sentences.length && token === speechToken; rest += 1) {
            await speakWindows(sentences[rest]);
            await pause(230);
          }
          finish();
          return;
        }
        if (audio) {
          if (index === 0) set({ voiceNote: 'Spoken with the natural (Qwen3) voice.' });
          speechActivity.lastBoundaryAt = performance.now();
          await playQwenAudio(audio, token);
        } else {
          await speakWindows(chunks[index]);
        }
        pending = next;
        next = fetchAudio(index + 2);
        await pause(index + 1 < chunks.length && /[.!?]$/.test(chunks[index]) ? 170 : 60);
      }
      finish();
    })();
  },

  stopSpeaking() {
    speechToken += 1;
    window.speechSynthesis?.cancel();
    stopQwenAudio();
    if (get().speaking) set({ speaking: false });
  },

  setPref(key, value) {
    const prefs = { ...get().prefs, [key]: value };
    set({ prefs });
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // preferences are best-effort
    }
    if (key === 'muted' && value === true) get().stopSpeaking();
  },

  clearError() {
    set({ error: null });
  },
}));

async function finishRecording(): Promise<void> {
  const duration = Date.now() - startedAt;
  const chunks = recordedChunks;
  const mime = recordedMime;
  const discard = discardRecording;
  releaseMicrophone(); // the microphone is off from this moment on
  recordedChunks = [];
  discardRecording = false;

  if (discard) {
    useVoice.setState({ phase: 'idle', elapsedMs: 0, level: 0 });
    return;
  }
  if (duration < MIN_RECORDING_MS || chunks.length === 0) {
    useVoice.setState({
      phase: 'idle',
      elapsedMs: 0,
      level: 0,
      error: 'That was too short — hold the mic button while you speak.',
    });
    return;
  }

  transcribeJob += 1;
  const job = transcribeJob;
  useVoice.setState({ phase: 'transcribing', level: 0 });
  try {
    const prepared = prepareSpeech(await decodeToMono16k(new Blob(chunks, { type: mime })));
    if (prepared.tooQuiet) {
      useVoice.setState({
        phase: 'idle',
        elapsedMs: 0,
        error: 'I did not hear any speech. Speak a little closer to the microphone and try again.',
      });
      return;
    }
    const result = await window.aios!.voice.transcribe(prepared.samples);
    if (job !== transcribeJob) return; // cancelled while transcribing
    void useVoice.getState().loadConfig();
    if (result.ok && result.text) {
      transcriptCounter += 1;
      useVoice.setState({
        phase: 'idle',
        elapsedMs: 0,
        transcript: { id: transcriptCounter, text: result.text },
      });
    } else {
      useVoice.setState({
        phase: 'idle',
        elapsedMs: 0,
        error: result.error ?? 'Transcription failed.',
      });
    }
  } catch (error) {
    if (job !== transcribeJob) return;
    useVoice.setState({
      phase: 'idle',
      elapsedMs: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
