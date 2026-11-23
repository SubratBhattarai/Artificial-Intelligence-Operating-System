import { describe, expect, it } from 'vitest';
import { parsePythonVersion, venvPython } from '../src/main/voice/qwenTts';
import { chunkForSpeech } from '../src/renderer/lib/speechChunks';

describe('Qwen3-TTS helpers', () => {
  it('accepts Python 3.10–3.12 only', () => {
    expect(parsePythonVersion('Python 3.12.4').ok).toBe(true);
    expect(parsePythonVersion('Python 3.9.1').ok).toBe(false);
    expect(parsePythonVersion('Python 3.13.0').ok).toBe(false);
    expect(parsePythonVersion('nope').ok).toBe(false);
  });

  it('finds the virtual-environment interpreter per platform', () => {
    expect(venvPython('/r', 'win32')).toContain('Scripts');
    expect(venvPython('/r', 'linux')).toContain('bin');
  });

  it('splits long sentences into short speakable chunks', () => {
    const chunks = chunkForSpeech([
      'This is a fairly long sentence, with a comma in the middle, and then it keeps going for quite a while longer.',
    ]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 90)).toBe(true);
    expect(chunkForSpeech(['Short one.'])).toEqual(['Short one.']);
  });
});
