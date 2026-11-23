import { describe, expect, it } from 'vitest';
import { parseFocusCommand } from '../src/renderer/lib/focusCommand';
import { describeStep, sanitizeSteps } from '../src/shared/scenes';

describe('scenes', () => {
  it('keeps only well-formed steps', () => {
    const steps = sanitizeSteps([
      { kind: 'open_app', name: ' Notepad ' },
      { kind: 'volume', level: 30 },
      { kind: 'volume', level: 300 },
      { kind: 'run_command', command: 'del *' },
      { kind: 'brightness', level: 40.5 },
      'junk',
    ]);
    expect(steps).toEqual([
      { kind: 'open_app', name: 'Notepad' },
      { kind: 'volume', level: 30 },
    ]);
    expect(describeStep(steps[1])).toBe('Set volume to 30%');
  });

  it('never accepts a terminal step', () => {
    expect(sanitizeSteps([{ kind: 'run_command', name: 'x' }])).toEqual([]);
  });
});

describe('focus commands', () => {
  it('parses start, duration and stop', () => {
    expect(parseFocusCommand('Jarvis, focus for 45 minutes')).toEqual({
      kind: 'start',
      minutes: 45,
    });
    expect(parseFocusCommand('start focus mode')).toEqual({ kind: 'start', minutes: 25 });
    expect(parseFocusCommand('stop focus')).toEqual({ kind: 'stop' });
    expect(parseFocusCommand('how do I focus better at night')).toBeNull();
    expect(parseFocusCommand('focus for 999 minutes')).toEqual({ kind: 'start', minutes: 180 });
  });
});
