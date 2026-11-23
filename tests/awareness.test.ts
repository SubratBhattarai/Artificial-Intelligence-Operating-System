import { describe, expect, it } from 'vitest';
import {
  CameraCapturer,
  describeImage,
  parseActiveWindow,
  parseBattery,
  timeOfDay,
} from '../src/main/awareness/awareness';
import { requirementFor } from '../src/shared/permissions';

describe('awareness parsing', () => {
  it('parses the active window and rejects junk', () => {
    expect(parseActiveWindow('Code|index.ts - AI OS\r\n')).toEqual({
      app: 'Code',
      title: 'index.ts - AI OS',
    });
    expect(parseActiveWindow('|no app')).toBeNull();
    expect(parseActiveWindow('garbage')).toBeNull();
  });
  it('parses battery output', () => {
    expect(parseBattery('80|1')).toEqual({ percent: 80, charging: false });
    expect(parseBattery('55|2')).toEqual({ percent: 55, charging: true });
    expect(parseBattery('none')).toBeNull();
  });
  it('names the time of day', () => {
    expect(timeOfDay(new Date(2026, 0, 1, 9))).toBe('morning');
    expect(timeOfDay(new Date(2026, 0, 1, 14))).toBe('afternoon');
    expect(timeOfDay(new Date(2026, 0, 1, 23))).toBe('night');
  });
  it('each signal needs its own permission switch', () => {
    expect(requirementFor('activity:read')?.id).toBe('activity');
    expect(requirementFor('clipboard:read')?.id).toBe('clipboard');
    expect(requirementFor('camera:capture')).toEqual({ id: 'camera', level: 'write' });
  });
});

describe('camera capture bridge', () => {
  it('resolves with a valid JPEG data URL only', async () => {
    let requested = '';
    const capturer = new CameraCapturer((id) => {
      requested = id;
    });
    const ok = capturer.request();
    capturer.complete(requested, 'data:image/jpeg;base64,AAAA', undefined);
    expect(await ok).toBe('data:image/jpeg;base64,AAAA');
    const bad = capturer.request();
    capturer.complete(requested, 'data:text/html;base64,AAAA', undefined);
    let message = '';
    await bad.catch((e: Error) => {
      message = e.message;
    });
    expect(message).toBe('No picture was captured.');
  });
  it('times out when the renderer never answers', async () => {
    const capturer = new CameraCapturer(() => undefined, 20);
    let message = '';
    await capturer.request().catch((e: Error) => {
      message = e.message;
    });
    expect(message).toBe('The camera did not respond in time.');
  });
});

describe('describeImage', () => {
  const fake = (status: number, body: unknown) =>
    (() =>
      Promise.resolve({
        status,
        ok: status < 400,
        json: () => Promise.resolve(body),
      })) as unknown as typeof fetch;
  it('returns the model text', async () => {
    const text = await describeImage('data:image/jpeg;base64,AAAA', {
      baseUrl: 'http://x',
      model: 'moondream',
      fetchImpl: fake(200, { message: { content: ' A desk. ' } }),
    });
    expect(text).toBe('A desk.');
  });
  it('tells the user how to install a missing model', async () => {
    let message = '';
    await describeImage('data:image/jpeg;base64,AAAA', {
      baseUrl: 'http://x',
      model: 'moondream',
      fetchImpl: fake(404, {}),
    }).catch((e: Error) => {
      message = e.message;
    });
    expect(message.includes('ollama pull moondream')).toBe(true);
  });
});

import { isJpegDataUrl, pickVisionModel } from '../src/main/awareness/awareness';
import { sharpnessOf } from '../src/shared/frameQuality';

describe('vision model choice and frame quality', () => {
  it('prefers the best small model that is installed', () => {
    expect(pickVisionModel(['llama3.2:latest', 'moondream:latest', 'qwen2.5vl:3b'])).toBe(
      'qwen2.5vl:3b',
    );
    expect(pickVisionModel(['llama3.2:latest', 'moondream:latest'])).toBe('moondream:latest');
    expect(pickVisionModel(['llama3.2:latest'])).toBeNull();
    expect(pickVisionModel(['moondream:latest', 'llava:7b'], 'llava')).toBe('llava:7b');
  });
  it('only accepts JPEG data URLs', () => {
    expect(isJpegDataUrl('data:image/jpeg;base64,AAAA')).toBe(true);
    expect(isJpegDataUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isJpegDataUrl(42)).toBe(false);
  });
  it('scores a sharp pattern above a flat one', () => {
    const size = 8;
    const flat = new Uint8ClampedArray(size * size * 4).fill(128);
    const sharp = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i += 1) sharp.fill(i % 2 === 0 ? 255 : 0, i * 4, i * 4 + 4);
    expect(sharpnessOf(sharp, size, size) > sharpnessOf(flat, size, size)).toBe(true);
  });
});
