import { describe, expect, it } from 'vitest';
import { isPhantomTranscript, prepareSpeech } from '../src/shared/audioPrep';

function tone(seconds: number, amplitude: number, offset = 0): Float32Array {
  const samples = new Float32Array(Math.round(seconds * 16_000));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * 220 * index) / 16_000) + offset;
  }
  return samples;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe('prepareSpeech', () => {
  it('flags silence and tiny blips as too quiet', () => {
    expect(prepareSpeech(new Float32Array(16_000)).tooQuiet).toBe(true);
    expect(prepareSpeech(new Float32Array(0)).tooQuiet).toBe(true);
    const blip = concat(new Float32Array(16_000), tone(0.05, 0.5), new Float32Array(16_000));
    expect(prepareSpeech(blip).tooQuiet).toBe(true);
  });

  it('trims silence, normalises level and pads the tail', () => {
    const silence = new Float32Array(32_000);
    const input = concat(silence, tone(1, 0.1), silence);
    const prepared = prepareSpeech(input);
    expect(prepared.tooQuiet).toBe(false);
    // 1 s of speech + two 250 ms margins + 400 ms tail, far shorter than the 5 s input.
    expect(prepared.samples.length).toBeLessThan(input.length / 2);
    let peak = 0;
    for (const sample of prepared.samples) peak = Math.max(peak, Math.abs(sample));
    expect(peak).toBeGreaterThan(0.8);
    expect(peak).toBeLessThanOrEqual(0.91);
  });

  it('removes a DC offset', () => {
    const prepared = prepareSpeech(concat(new Float32Array(8_000), tone(1, 0.2, 0.3)));
    const middle = prepared.samples.subarray(8_000, 24_000);
    let mean = 0;
    for (const sample of middle) mean += sample;
    expect(Math.abs(mean / middle.length)).toBeLessThan(0.05);
  });
});

describe('isPhantomTranscript', () => {
  it('recognises common hallucinations only', () => {
    expect(isPhantomTranscript(' Thank you. ')).toBe(true);
    expect(isPhantomTranscript('schedule a meeting')).toBe(false);
  });
});
