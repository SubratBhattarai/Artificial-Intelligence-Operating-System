import { create } from 'zustand';
import { prepareSpeech, isPhantomTranscript } from '../../shared/audioPrep';
import { BargeInDetector } from '../../shared/bargeIn';
import { SegmentDetector, rms } from '../../shared/vad';
import { isStopCommand, parseWake } from '../../shared/wake';
import { useChat } from './chatStore';
import { usePermissions } from './permissionStore';
import { useVoice } from './voiceStore';

export type WakeStatus =
  'off' | 'starting' | 'listening' | 'hearing' | 'transcribing' | 'awake' | 'error';

const PREF_KEY = 'aios.wake.v1';
const REVIEW_KEY = 'aios.wake.review.v1';
const INTERRUPT_KEY = 'aios.wake.interrupt.v1';
const bargeIn = new BargeInDetector();
const SAMPLE_RATE = 16_000;
const BUFFER_SIZE = 4096;
/** After "Jarvis" alone, the next sentence is the command for this long. */
const AWAKE_WINDOW_MS = 5000;
/** Ignore the microphone briefly after JARVIS stops talking so its own voice is not heard. */
const AFTER_SPEECH_MUTE_MS = 700;

/** Read by the orb's animation loop (no re-renders). */
export const wakeActivity = { level: 0 };

interface WakeState {
  /** The user wants "Jarvis" listening on. It only runs while the Microphone permission is on. */
  enabled: boolean;
  status: WakeStatus;
  error: string | null;
  /** What was last recognised. */
  heard: string | null;
  /** The last request sent to JARVIS by voice. */
  lastCommand: string | null;
  enable: () => Promise<void>;
  /** Turn the microphone off immediately. */
  disable: () => void;
  /** Start again at launch when the user left it on and the permission is still granted. */
  resume: () => Promise<void>;
  clearHeard: () => void;
  /** When on, what you say is placed in an editable box instead of being sent at once. */
  reviewBeforeSend: boolean;
  setReviewBeforeSend: (on: boolean) => void;
  /** A transcript waiting for the user to edit, reread, clear, send or delete. */
  pending: string | null;
  /** Talking over JARVIS stops it. Off by default: speakers can trigger it, headphones are best. */
  allowInterrupt: boolean;
  setAllowInterrupt: (on: boolean) => void;
  takePending: () => void;
}

function loadInterrupt(): boolean {
  try {
    return localStorage.getItem(INTERRUPT_KEY) === '1';
  } catch {
    return false;
  }
}

function loadReview(): boolean {
  try {
    return localStorage.getItem(REVIEW_KEY) === '1';
  } catch {
    return false;
  }
}

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

function saveEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    // best-effort
  }
}

/* Audio resources live outside React state. */
let stream: MediaStream | null = null;
let context: AudioContext | null = null;
let processor: ScriptProcessorNode | null = null;
let detector = new SegmentDetector({ sampleRate: SAMPLE_RATE });
let busy = false;
let queued: Float32Array | null = null;
let awakeUntil = 0;
let mutedUntil = 0;
let awakeTimer: ReturnType<typeof setTimeout> | null = null;
let voiceTurnActive = false;
let session = 0;

function friendly(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The microphone was blocked. Check Settings › Permissions and Windows privacy settings.';
  }
  if (name === 'NotFoundError') return 'No microphone was found.';
  if (name === 'NotReadableError') return 'The microphone is in use by another app.';
  return 'Could not start the microphone.';
}

function releaseAudio(): void {
  if (awakeTimer) clearTimeout(awakeTimer);
  awakeTimer = null;
  if (processor) {
    processor.onaudioprocess = null;
    processor.disconnect();
  }
  processor = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  void context?.close().catch(() => undefined);
  context = null;
  detector.reset();
  busy = false;
  queued = null;
  wakeActivity.level = 0;
}

function setAwake(): void {
  awakeUntil = Date.now() + AWAKE_WINDOW_MS;
  useWake.setState({ status: 'awake' });
  if (awakeTimer) clearTimeout(awakeTimer);
  awakeTimer = setTimeout(function expire() {
    const current = useWake.getState().status;
    if (current === 'hearing' || current === 'transcribing') {
      awakeTimer = setTimeout(expire, 700); // someone is mid-sentence: let them finish
      return;
    }
    awakeUntil = 0;
    if (current === 'awake') useWake.setState({ status: 'listening' });
  }, AWAKE_WINDOW_MS);
}

function dispatchCommand(command: string): void {
  if (isStopCommand(command)) {
    void useChat.getState().cancel();
    useVoice.getState().stopSpeaking();
    useWake.setState({ status: 'listening', lastCommand: null });
    return;
  }
  if (useWake.getState().reviewBeforeSend) {
    useWake.setState({ status: 'listening', pending: command });
    return;
  }
  voiceTurnActive = true;
  useWake.setState({ status: 'listening', lastCommand: command });
  void useChat.getState().send(command);
}

async function handleSegment(samples: Float32Array, mySession: number): Promise<void> {
  const api = window.aios;
  if (!api) return;
  busy = true;
  useWake.setState({ status: 'transcribing' });
  try {
    const prepared = prepareSpeech(samples);
    if (prepared.tooQuiet) return;
    const result = await api.voice.transcribe(prepared.samples);
    if (mySession !== session) return; // turned off while transcribing
    if (!result.ok || !result.text || isPhantomTranscript(result.text)) return;

    const parsed = parseWake(result.text);
    const spokenMs = (samples.length / SAMPLE_RATE) * 1000;
    const awake = awakeUntil > 0 && Date.now() < awakeUntil + spokenMs + 1500;
    if (!parsed.woke && !awake) return; // ordinary conversation: heard, forgotten, never stored

    useWake.setState({ heard: result.text });
    awakeUntil = 0;
    if (parsed.command.length >= 2) dispatchCommand(parsed.command);
    else if (parsed.woke) setAwake();
  } catch {
    // a failed transcription just means we keep listening
  } finally {
    busy = false;
    if (mySession === session) {
      const state = useWake.getState();
      if (state.status === 'transcribing') useWake.setState({ status: 'listening' });
      if (queued) {
        const next = queued;
        queued = null;
        void handleSegment(next, mySession);
      }
    }
  }
}

async function start(): Promise<void> {
  const api = window.aios;
  if (!api) {
    useWake.setState({
      status: 'error',
      error: 'The app bridge is unavailable — run AI OS through Electron.',
    });
    return;
  }
  if (!usePermissions.getState().loaded) await usePermissions.getState().refresh();
  if (usePermissions.getState().levels.microphone !== 'write') {
    useWake.setState({
      status: 'off',
      error: 'Microphone is off. Turn it on in Settings › Permissions to use "Jarvis".',
    });
    return;
  }
  if (stream) return;
  session += 1;
  const mySession = session;
  useWake.setState({ status: 'starting', error: null });
  try {
    const granted = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (mySession !== session) {
      granted.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = granted;
    context = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = context.createMediaStreamSource(granted);
    processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1);
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(processor);
    processor.connect(silent);
    silent.connect(context.destination);
    detector = new SegmentDetector({ sampleRate: context.sampleRate });
    processor.onaudioprocess = (event) => {
      const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
      const level = Math.min(1, rms(chunk) * 5);
      const voice = useVoice.getState();
      // Deaf while JARVIS is speaking or the push-to-talk microphone is in use.
      if (voice.speaking && voice.phase === 'idle' && useWake.getState().allowInterrupt) {
        const chunkMs = (chunk.length / SAMPLE_RATE) * 1000;
        if (bargeIn.push(level, chunkMs)) {
          useVoice.getState().stopSpeaking();
          void useChat.getState().cancel();
          detector.reset();
          mutedUntil = 0;
        }
        return;
      }
      bargeIn.reset();
      if (voice.speaking || voice.phase !== 'idle') {
        mutedUntil = performance.now() + AFTER_SPEECH_MUTE_MS;
        detector.reset();
        wakeActivity.level = 0;
        return;
      }
      if (performance.now() < mutedUntil) return;
      wakeActivity.level = level;
      const segment = detector.push(chunk);
      const status = useWake.getState().status;
      if (detector.hearing && status === 'listening') useWake.setState({ status: 'hearing' });
      else if (!detector.hearing && status === 'hearing') useWake.setState({ status: 'listening' });
      if (segment) {
        if (busy) queued = segment;
        else void handleSegment(segment, mySession);
      }
    };
    useWake.setState({ status: 'listening' });
    void api.voice.keepWarm(true);
    if (!useVoice.getState().config?.modelCached) void useVoice.getState().prepareModel();
  } catch (error) {
    releaseAudio();
    useWake.setState({ status: 'error', error: friendly(error) });
  }
}

export const useWake = create<WakeState>((set, get) => ({
  enabled: loadEnabled(),
  status: 'off',
  error: null,
  heard: null,
  lastCommand: null,
  reviewBeforeSend: loadReview(),
  allowInterrupt: loadInterrupt(),
  setAllowInterrupt(on) {
    try {
      localStorage.setItem(INTERRUPT_KEY, on ? '1' : '0');
    } catch {
      // preference just won't persist
    }
    set({ allowInterrupt: on });
  },
  pending: null,

  setReviewBeforeSend(on) {
    try {
      localStorage.setItem(REVIEW_KEY, on ? '1' : '0');
    } catch {
      // preference just won't persist
    }
    set({ reviewBeforeSend: on });
  },

  takePending() {
    set({ pending: null });
  },

  async enable() {
    saveEnabled(true);
    set({ enabled: true, error: null });
    await start();
  },

  disable() {
    saveEnabled(false);
    session += 1;
    releaseAudio();
    void window.aios?.voice.keepWarm(false);
    set({ enabled: false, status: 'off', error: null });
  },

  async resume() {
    if (get().enabled && get().status === 'off') await start();
  },

  clearHeard() {
    set({ heard: null, lastCommand: null });
  },
}));

// Stop listening the instant the Microphone permission is switched off.
usePermissions.subscribe((state) => {
  const wake = useWake.getState();
  if (state.levels.microphone !== 'write' && wake.status !== 'off') {
    session += 1;
    releaseAudio();
    void window.aios?.voice.keepWarm(false);
    useWake.setState({ status: 'off', error: 'Microphone permission was turned off.' });
  }
});

// Read replies aloud when the request was spoken (or when the user always wants replies spoken).
let previousChatStatus = useChat.getState().status;
useChat.subscribe((state) => {
  const finished = previousChatStatus === 'streaming' && state.status === 'idle';
  previousChatStatus = state.status;
  if (!finished) return;
  const speakIt = voiceTurnActive || useVoice.getState().prefs.speakReplies;
  voiceTurnActive = false;
  if (!speakIt) return;
  const last = [...state.messages].reverse().find((message) => message.role === 'assistant');
  if (last && last.content && !last.error) useVoice.getState().speak(last.content);
});

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => releaseAudio());
}
