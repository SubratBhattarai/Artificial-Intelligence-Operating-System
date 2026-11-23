import { describe, expect, it } from 'vitest';
import { BargeInDetector } from '../src/shared/bargeIn';

describe('barge-in detection', () => {
  it('ignores a short noise but fires on sustained speech', () => {
    const detector = new BargeInDetector();
    expect(detector.push(0.2, 100)).toBe(false);
    expect(detector.push(0.01, 200)).toBe(false); // gap resets the count
    let fired = false;
    for (let i = 0; i < 5; i += 1) fired = detector.push(0.2, 100) || fired;
    expect(fired).toBe(true);
  });

  it('ignores quiet speaker bleed', () => {
    const detector = new BargeInDetector();
    let fired = false;
    for (let i = 0; i < 50; i += 1) fired = detector.push(0.03, 100) || fired;
    expect(fired).toBe(false);
  });
});
