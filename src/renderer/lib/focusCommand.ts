/** "Jarvis, focus for 25 minutes" / "stop focus": handled by ordinary code, not the language model. */
export type FocusCommand = { kind: 'start'; minutes: number } | { kind: 'stop' } | null;

const START =
  /^\s*(?:jarvis[\s,]*)?(?:please\s+)?(?:start|begin|enter|turn on)?\s*(?:a\s+)?(?:focus|pomodoro)(?:\s+(?:mode|session|timer))?(?:\s+for\s+(\d{1,3})\s*(?:minutes?|mins?))?\s*[.!?]*\s*$/i;
const STOP =
  /^\s*(?:jarvis[\s,]*)?(?:please\s+)?(?:stop|end|cancel|exit|turn off)\s+(?:the\s+)?(?:focus|pomodoro)(?:\s+(?:mode|session|timer))?\s*[.!?]*\s*$/i;

export function parseFocusCommand(text: string): FocusCommand {
  if (STOP.test(text)) return { kind: 'stop' };
  const match = text.match(START);
  if (!match) return null;
  const minutes = match[1] ? Number(match[1]) : 25;
  return { kind: 'start', minutes: Math.min(180, Math.max(1, minutes)) };
}
