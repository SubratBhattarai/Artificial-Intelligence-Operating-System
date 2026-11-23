import { describe, expect, it } from 'vitest';
import { buildWebTarget } from '../src/main/tools/webTarget';
import { pickPreferredVoice } from '../src/renderer/lib/voices';
import { requirementFor } from '../src/shared/permissions';

describe('buildWebTarget', () => {
  it('turns a phrase into an encoded search', () => {
    const target = buildWebTarget({ query: 'best study music & focus' });
    expect(target.ok).toBe(true);
    expect(target.url).toBe('https://duckduckgo.com/?q=best%20study%20music%20%26%20focus');
  });
  it('accepts plain https addresses only', () => {
    expect(buildWebTarget({ url: 'https://www.loras.edu/' }).ok).toBe(true);
    expect(buildWebTarget({ url: 'http://example.com' }).ok).toBe(false);
    expect(buildWebTarget({ url: 'file:///C:/Windows/System32' }).ok).toBe(false);
    expect(buildWebTarget({ url: 'javascript:alert(1)' }).ok).toBe(false);
    expect(buildWebTarget({ url: 'https://user:pw@example.com' }).ok).toBe(false);
  });
  it('blocks local and private addresses', () => {
    for (const url of [
      'https://localhost/admin',
      'https://127.0.0.1/',
      'https://192.168.1.1/',
      'https://10.0.0.5/',
      'https://intranet/',
      'https://[::1]/',
    ]) {
      expect(buildWebTarget({ url }).ok).toBe(false);
    }
  });
  it('needs exactly one of url or query', () => {
    expect(buildWebTarget({}).ok).toBe(false);
    expect(buildWebTarget({ url: 'https://example.com', query: 'x' }).ok).toBe(false);
  });
});

describe('internet permission', () => {
  it('maps the browser tool to the Internet switch', () => {
    expect(requirementFor('web:open')).toEqual({ id: 'internet', level: 'write' });
  });
});

describe('pickPreferredVoice', () => {
  const voice = (name: string, lang: string) =>
    ({ name, lang, voiceURI: name }) as SpeechSynthesisVoice;
  it('prefers a natural female US English voice', () => {
    const picked = pickPreferredVoice([
      voice('Microsoft David Desktop - English (United States)', 'en-US'),
      voice('Microsoft Zira Desktop - English (United States)', 'en-US'),
      voice('Microsoft Aria Online (Natural) - English (United States)', 'en-US'),
      voice('Microsoft Hazel - English (United Kingdom)', 'en-GB'),
    ]);
    expect(picked?.name).toContain('Aria');
  });
  it('never picks a male or non-English voice when nothing suitable exists', () => {
    expect(
      pickPreferredVoice([voice('Microsoft David Desktop', 'en-US'), voice('Hortense', 'fr-FR')]),
    ).toBeUndefined();
  });
});
