import { useEffect, useState } from 'react';

/** The text-to-speech voices installed on this computer, kept current as Windows loads them. */
export function useSystemVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    typeof window !== 'undefined' && window.speechSynthesis
      ? window.speechSynthesis.getVoices()
      : [],
  );
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return undefined;
    const refresh = () => setVoices(synth.getVoices());
    refresh();
    synth.addEventListener('voiceschanged', refresh);
    return () => synth.removeEventListener('voiceschanged', refresh);
  }, []);
  return voices;
}

/** English voices first, then everything else, alphabetically. */
export function sortVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return [...voices].sort((a, b) => {
    const aEnglish = a.lang.toLowerCase().startsWith('en') ? 0 : 1;
    const bEnglish = b.lang.toLowerCase().startsWith('en') ? 0 : 1;
    return aEnglish - bEnglish || a.name.localeCompare(b.name);
  });
}

const FEMALE_NAMES = [
  'jenny',
  'aria',
  'ava',
  'michelle',
  'emma',
  'zira',
  'samantha',
  'allison',
  'susan',
  'jessa',
  'nova',
  'sonia',
];
const MALE_NAMES = [
  'david',
  'mark',
  'guy',
  'ryan',
  'andrew',
  'brian',
  'christopher',
  'eric',
  'roger',
  'steffan',
  'george',
  'james',
  'richard',
];

/**
 * The default JARVIS voice: female, neutral American English, preferring Windows' natural
 * (neural) voices, which sound warm and unhurried. Anything the user picks always wins.
 */
export function pickPreferredVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined {
  const score = (voice: SpeechSynthesisVoice): number => {
    const name = voice.name.toLowerCase();
    let value = 0;
    if (voice.lang.toLowerCase() === 'en-us') value += 30;
    else if (voice.lang.toLowerCase().startsWith('en')) value += 8;
    else return -1;
    if (/natural|online/.test(name)) value += 25;
    if (FEMALE_NAMES.some((n) => name.includes(n))) value += 40;
    if (MALE_NAMES.some((n) => name.includes(n))) value -= 60;
    if (name.includes('jenny')) value += 6;
    else if (name.includes('aria')) value += 5;
    return value;
  };
  let best: SpeechSynthesisVoice | undefined;
  let bestScore = 0;
  for (const voice of voices) {
    const current = score(voice);
    if (current > bestScore) {
      best = voice;
      bestScore = current;
    }
  }
  return best;
}
