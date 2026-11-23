/** Scenes: named setups ("Study mode") made of simple steps. JARVIS performs them one tool call at a time, each needing approval. */

export type SceneStep =
  | { kind: 'open_app'; name: string }
  | { kind: 'close_app'; name: string }
  | { kind: 'volume'; level: number }
  | { kind: 'brightness'; level: number };

export interface Scene {
  id: string;
  name: string;
  steps: SceneStep[];
}

export const MAX_SCENES = 20;
export const MAX_STEPS = 12;

function clampLevel(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : null;
}

/** Accept only well-formed steps; anything else is dropped rather than guessed at. */
export function sanitizeSteps(raw: unknown): SceneStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: SceneStep[] = [];
  for (const entry of raw.slice(0, MAX_STEPS)) {
    if (!entry || typeof entry !== 'object') continue;
    const step = entry as Record<string, unknown>;
    if ((step.kind === 'open_app' || step.kind === 'close_app') && typeof step.name === 'string') {
      const name = step.name.trim().slice(0, 80);
      if (name) steps.push({ kind: step.kind, name });
    } else if (step.kind === 'volume' || step.kind === 'brightness') {
      const level = clampLevel(step.level);
      if (level !== null) steps.push({ kind: step.kind, level });
    }
  }
  return steps;
}

export function describeStep(step: SceneStep): string {
  switch (step.kind) {
    case 'open_app':
      return `Open ${step.name}`;
    case 'close_app':
      return `Close ${step.name}`;
    case 'volume':
      return `Set volume to ${step.level}%`;
    default:
      return `Set brightness to ${step.level}%`;
  }
}
