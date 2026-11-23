/** Pure audio clean-up applied before speech recognition (16 kHz mono float samples). */

export const PREP_SAMPLE_RATE = 16_000;
const FRAME_MS = 20;
const MARGIN_MS = 250;
const TAIL_SILENCE_MS = 400;
const MAX_GAIN = 12;
const DC_BLOCK_POLE = 0.995;
const TARGET_PEAK = 0.9;
/** Speech shorter than this is treated as "nothing was said". */
export const MIN_VOICED_MS = 250;

export interface PreparedAudio {
  samples: Float32Array;
  /** Milliseconds of audio that looked like speech. */
  voicedMs: number;
  /** True when there is not enough speech to bother transcribing. */
  tooQuiet: boolean;
}

function frameEnergies(samples: Float32Array, frameSize: number): number[] {
  const energies: number[] = [];
  for (let start = 0; start + frameSize <= samples.length; start += frameSize) {
    let sum = 0;
    for (let index = start; index < start + frameSize; index += 1) {
      sum += samples[index] * samples[index];
    }
    energies.push(Math.sqrt(sum / frameSize));
  }
  return energies;
}

/**
 * Remove DC offset (high-pass), trim leading/trailing silence (keeping a short margin), normalise loudness,
 * and append a little silence — Whisper is noticeably more accurate on clean, level audio.
 */
export function prepareSpeech(input: Float32Array, sampleRate = PREP_SAMPLE_RATE): PreparedAudio {
  if (input.length === 0) return { samples: new Float32Array(0), voicedMs: 0, tooQuiet: true };

  // First-order DC blocker (about 13 Hz corner): removes a constant or slowly drifting mic offset
  // without touching speech, and copes with offsets that do not span the whole recording.
  const centred = new Float32Array(input.length);
  let previousIn = 0;
  let previousOut = 0;
  for (let index = 0; index < input.length; index += 1) {
    const out = input[index] - previousIn + DC_BLOCK_POLE * previousOut;
    previousIn = input[index];
    previousOut = out;
    centred[index] = out;
  }

  const frameSize = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const energies = frameEnergies(centred, frameSize);
  if (energies.length === 0) return { samples: centred, voicedMs: 0, tooQuiet: true };

  const sorted = [...energies].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const loud = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  // Voice must clearly stand out from the noise floor and above an absolute minimum.
  const threshold = Math.max(0.006, noiseFloor * 3, loud * 0.12);

  let first = -1;
  let last = -1;
  let voicedFrames = 0;
  energies.forEach((energy, index) => {
    if (energy < threshold) return;
    voicedFrames += 1;
    if (first < 0) first = index;
    last = index;
  });
  const voicedMs = voicedFrames * FRAME_MS;
  if (first < 0 || voicedMs < MIN_VOICED_MS) {
    return { samples: centred, voicedMs, tooQuiet: true };
  }

  const margin = Math.round((sampleRate * MARGIN_MS) / 1000);
  const start = Math.max(0, first * frameSize - margin);
  const end = Math.min(centred.length, (last + 1) * frameSize + margin);
  const trimmed = centred.subarray(start, end);

  let peak = 0;
  for (const sample of trimmed) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 0 ? Math.min(MAX_GAIN, TARGET_PEAK / peak) : 1;

  const tail = Math.round((sampleRate * TAIL_SILENCE_MS) / 1000);
  const output = new Float32Array(trimmed.length + tail);
  for (let index = 0; index < trimmed.length; index += 1) output[index] = trimmed[index] * gain;
  return { samples: output, voicedMs, tooQuiet: false };
}

/** Whisper's well-known phantom outputs on near-silence. */
const PHANTOM_PHRASES = new Set([
  'you',
  'thank you',
  'thank you.',
  'thanks for watching',
  'thanks for watching!',
  'bye',
  'bye.',
  '.',
]);

export function isPhantomTranscript(text: string): boolean {
  return PHANTOM_PHRASES.has(text.trim().toLowerCase());
}
