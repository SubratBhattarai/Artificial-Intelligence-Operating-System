import { describe, expect, it } from 'vitest';
import { SegmentDetector } from '../src/shared/vad';
import { isStopCommand, parseWake } from '../src/shared/wake';

const RATE = 16_000;
const CHUNK = 4096;

function tone(amplitude: number, length = CHUNK): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = amplitude * Math.sin((i / 16) * Math.PI * 2);
  return out;
}

function noise(amplitude: number, length = CHUNK): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1)
    out[i] = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * amplitude;
  return out;
}

describe('parseWake', () => {
  it('finds the name at the start and returns the command', () => {
    expect(parseWake('Jarvis, prepare me for tomorrow.')).toEqual({
      woke: true,
      command: 'prepare me for tomorrow.',
    });
    expect(parseWake('Hey Jarvis what is 12 times 9').command).toBe('what is 12 times 9');
    expect(parseWake('jarvis').command).toBe('');
  });

  it('accepts common mis-hearings and a short lead-in', () => {
    expect(parseWake('Okay, Jarvus open calendar').woke).toBe(true);
    expect(parseWake('um, jarvis list my tasks').command).toBe('list my tasks');
  });

  it('ignores ordinary speech that merely contains similar text', () => {
    expect(
      parseWake('the weather is nice and I was talking about the travis county fair').woke,
    ).toBe(false);
    expect(parseWake('open the calendar').woke).toBe(false);
  });

  it('recognises stop commands only as the whole utterance', () => {
    expect(isStopCommand('Stop.')).toBe(true);
    expect(isStopCommand('never mind')).toBe(true);
    expect(isStopCommand('stop the music and add a task')).toBe(false);
  });
});

describe('SegmentDetector', () => {
  it('returns one segment after speech followed by silence', () => {
    const detector = new SegmentDetector({ sampleRate: RATE });
    const found: Float32Array[] = [];
    const feed = (chunk: Float32Array) => {
      const segment = detector.push(chunk);
      if (segment) found.push(segment);
    };
    for (let i = 0; i < 6; i += 1) feed(noise(0.002));
    for (let i = 0; i < 4; i += 1) feed(tone(0.2));
    expect(detector.hearing).toBe(true);
    for (let i = 0; i < 6; i += 1) feed(noise(0.002));
    expect(found).toHaveLength(1);
    expect(found[0].length).toBeGreaterThan(CHUNK * 4);
    expect(detector.hearing).toBe(false);
  });

  it('ignores a blip that is too short and steady background noise', () => {
    const detector = new SegmentDetector({ sampleRate: RATE, minSpeechMs: 400 });
    const found: Float32Array[] = [];
    const feed = (chunk: Float32Array) => {
      const segment = detector.push(chunk);
      if (segment) found.push(segment);
    };
    for (let i = 0; i < 20; i += 1) feed(noise(0.004));
    feed(tone(0.2, 1024)); // 64 ms click
    for (let i = 0; i < 8; i += 1) feed(noise(0.004));
    expect(found).toHaveLength(0);
  });

  it('cuts very long speech at the maximum length', () => {
    const detector = new SegmentDetector({ sampleRate: RATE, maxSegmentMs: 2000 });
    let count = 0;
    for (let i = 0; i < 20; i += 1) {
      if (detector.push(tone(0.2))) count += 1;
    }
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
