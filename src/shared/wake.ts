/** Recognising "Jarvis" in a transcript and pulling out what was asked. */

const NAMES = "(?:jarvis|jarvus|jarvas|jervis|jarvice|javis|jarves|jar\\s?vis|jarvis's)";
const GREETING = '(?:(?:hey|hi|hello|ok|okay|yo)[\\s,]+)?';
const START = new RegExp(`^[\\s"'“]*${GREETING}${NAMES}\\b[\\s,.:;!?\\-–—]*`, 'i');
const EARLY = new RegExp(`^(.{0,24}?)\\b${GREETING}${NAMES}\\b[\\s,.:;!?\\-–—]*`, 'i');

export interface WakeParse {
  /** The name "Jarvis" was heard near the start. */
  woke: boolean;
  /** What followed the name (may be empty). */
  command: string;
}

export function parseWake(transcript: string): WakeParse {
  const text = transcript.trim();
  const direct = START.exec(text);
  if (direct) return { woke: true, command: text.slice(direct[0].length).trim() };
  const early = EARLY.exec(text);
  if (early) return { woke: true, command: text.slice(early[0].length).trim() };
  return { woke: false, command: text };
}

const STOP = /^(?:stop|cancel|never ?mind|be quiet|quiet|silence|shut up)[.!\s]*$/i;

/** "Jarvis, stop" — handled by the app itself, never sent to the model. */
export function isStopCommand(command: string): boolean {
  return STOP.test(command.trim());
}
