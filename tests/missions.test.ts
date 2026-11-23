import { describe, expect, it } from 'vitest';
import { parsePlan } from '../src/main/agents/missionManager';

describe('parsePlan', () => {
  it('extracts steps from JSON wrapped in prose', () => {
    const plan = parsePlan(
      'Sure! {"steps":[{"title":"Research","detail":"Find sources"},{"title":"Write","detail":"Draft"}]} done',
    );
    expect(plan?.map((s) => s.title)).toEqual(['Research', 'Write']);
  });
  it('rejects garbage and empty plans', () => {
    expect(parsePlan('no json')).toBeNull();
    expect(parsePlan('{"steps":[]}')).toBeNull();
    expect(parsePlan('{"steps":[{"detail":"x"}]}')).toBeNull();
  });
  it('caps step count and field lengths', () => {
    const steps = Array.from({ length: 20 }, () => ({
      title: 'x'.repeat(200),
      detail: 'y'.repeat(900),
    }));
    const plan = parsePlan(JSON.stringify({ steps }));
    expect(plan).toHaveLength(8);
    expect(plan?.[0].title).toHaveLength(80);
    expect(plan?.[0].detail).toHaveLength(300);
  });
});
