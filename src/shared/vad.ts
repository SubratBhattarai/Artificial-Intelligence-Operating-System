/**
 * Splits a continuous microphone stream into spoken segments, entirely in the app (no audio
 * leaves the computer, and nothing is transcribed unless someone is actually speaking).
 */

export interface SegmentDetectorOptions {
  sampleRate?: number;
  /** Speech must be at least this much louder than the background. */
  noiseRatio?: number;
  /** Never trigger below this level (0..1 RMS). */
  minLevel?: number;
  /** Silence that ends a segment. */
  hangoverMs?: number;
  /** Speech shorter than this is ignored. */
  minSpeechMs?: number;
  /** A segment never grows beyond this. */
  maxSegmentMs?: number;
  /** Audio kept from just before speech was noticed, so the first syllable is not clipped. */
  preRollMs?: number;
}

export function rms(chunk: Float32Array): number {
  if (chunk.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < chunk.length; index += 1) sum += chunk[index] * chunk[index];
  return Math.sqrt(sum / chunk.length);
}

export class SegmentDetector {
  private readonly sampleRate: number;
  private readonly noiseRatio: number;
  private readonly minLevel: number;
  private readonly hangoverMs: number;
  private readonly minSpeechMs: number;
  private readonly maxSegmentMs: number;
  private readonly preRollMs: number;

  private noiseFloor = 0.004;
  private preRoll: Float32Array[] = [];
  private preRollDuration = 0;
  private segment: Float32Array[] = [];
  private segmentMs = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private active = false;

  constructor(options: SegmentDetectorOptions = {}) {
    this.sampleRate = options.sampleRate ?? 16_000;
    this.noiseRatio = options.noiseRatio ?? 3;
    this.minLevel = options.minLevel ?? 0.012;
    this.hangoverMs = options.hangoverMs ?? 800;
    this.minSpeechMs = options.minSpeechMs ?? 250;
    this.maxSegmentMs = options.maxSegmentMs ?? 12_000;
    this.preRollMs = options.preRollMs ?? 500;
  }

  /** True while a segment is being collected (someone is speaking). */
  get hearing(): boolean {
    return this.active;
  }

  reset(): void {
    this.preRoll = [];
    this.preRollDuration = 0;
    this.segment = [];
    this.segmentMs = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.active = false;
  }

  /** Feed one chunk of 16 kHz samples; returns a finished segment when one just ended. */
  push(chunk: Float32Array): Float32Array | null {
    const duration = (chunk.length / this.sampleRate) * 1000;
    const level = rms(chunk);
    const threshold = Math.max(this.minLevel, this.noiseFloor * this.noiseRatio);
    const loud = level >= threshold;

    if (!this.active) {
      if (!loud) {
        // Only quiet audio teaches the noise floor, and slowly, so speech never raises it.
        this.noiseFloor += (level - this.noiseFloor) * 0.05;
        this.preRoll.push(chunk);
        this.preRollDuration += duration;
        while (this.preRollDuration > this.preRollMs && this.preRoll.length > 1) {
          const dropped = this.preRoll.shift() as Float32Array;
          this.preRollDuration -= (dropped.length / this.sampleRate) * 1000;
        }
        return null;
      }
      this.active = true;
      this.segment = [...this.preRoll, chunk];
      this.segmentMs = this.preRollDuration + duration;
      this.speechMs = duration;
      this.silenceMs = 0;
      this.preRoll = [];
      this.preRollDuration = 0;
      return null;
    }

    this.segment.push(chunk);
    this.segmentMs += duration;
    if (loud) {
      this.speechMs += duration;
      this.silenceMs = 0;
    } else {
      this.silenceMs += duration;
    }

    if (this.silenceMs >= this.hangoverMs || this.segmentMs >= this.maxSegmentMs) {
      const enough = this.speechMs >= this.minSpeechMs;
      const samples = enough ? concat(this.segment) : null;
      this.reset();
      return samples;
    }
    return null;
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
