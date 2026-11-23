import { describe, expect, it } from 'vitest';
import { AMBIENT, AMBIENT_PALETTES, ambientFor, easePalette } from '../src/renderer/lib/ambient';

const base = { cpu: 10, modelOffline: false, securityAlert: false, agentsRunning: 0 };

describe('ambient mode', () => {
  it('picks states by priority', () => {
    expect(ambientFor(base)).toBe('calm');
    expect(ambientFor({ ...base, cpu: 60 })).toBe('busy');
    expect(ambientFor({ ...base, agentsRunning: 1 })).toBe('agents');
    expect(ambientFor({ ...base, cpu: 95, agentsRunning: 1 })).toBe('heavy');
    expect(ambientFor({ ...base, modelOffline: true, cpu: 95 })).toBe('offline');
    expect(ambientFor({ ...base, modelOffline: true, securityAlert: true })).toBe('alert');
  });

  it('eases colours toward the target and settles', () => {
    let steps = 0;
    while (easePalette(AMBIENT_PALETTES.alert) && steps < 500) steps += 1;
    expect(steps).toBeLessThan(500);
    expect(AMBIENT.colors[2]).toEqual(AMBIENT_PALETTES.alert[2]);
  });
});
