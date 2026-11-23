import type { Importance, NotificationSource } from '../../shared/agents';

/**
 * Smart filtering is done by plain, explainable rules (not by asking the model), so a
 * notification's importance never depends on text an outside source could have written.
 */
export interface Signal {
  source: NotificationSource;
  /** Hours until something is due. Negative = overdue. */
  hoursUntil?: number;
  /** Mail or page text matched the deadline words. */
  mentionsDeadline?: boolean;
  /** An agent is waiting for an approval click. */
  needsAction?: boolean;
  failed?: boolean;
  securityLevel?: 'low' | 'medium' | 'high';
}

export function scoreImportance(signal: Signal): Importance {
  if (signal.source === 'security') {
    return signal.securityLevel === 'high'
      ? 'urgent'
      : signal.securityLevel === 'medium'
        ? 'important'
        : 'info';
  }
  if (signal.needsAction) return 'urgent';
  if (signal.hoursUntil !== undefined) {
    if (signal.hoursUntil < 0) return 'urgent';
    if (signal.hoursUntil <= 3) return 'urgent';
    if (signal.hoursUntil <= 24) return 'important';
    return 'info';
  }
  if (signal.source === 'mail') return signal.mentionsDeadline ? 'important' : 'info';
  if (signal.source === 'agent') return signal.failed ? 'important' : 'info';
  if (signal.source === 'monitor') return 'important';
  return 'info';
}

/** Words that changed on a page, for the notification text. Never repeats long passages. */
export function summarizeChange(before: string, after: string): string {
  const lines = (text: string) =>
    new Set(
      text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 3),
    );
  const oldLines = lines(before);
  const newLines = lines(after);
  const added = [...newLines].filter((line) => !oldLines.has(line));
  const removed = [...oldLines].filter((line) => !newLines.has(line));
  if (added.length === 0 && removed.length === 0)
    return 'The page changed (formatting or small details).';
  const sample = added
    .slice(0, 2)
    .map((line) => `“${line.slice(0, 90)}”`)
    .join(', ');
  return `${added.length} line${added.length === 1 ? '' : 's'} added, ${removed.length} removed${sample ? `. New: ${sample}` : ''}`;
}
