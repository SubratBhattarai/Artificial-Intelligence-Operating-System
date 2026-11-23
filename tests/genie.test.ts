import { describe, expect, it } from 'vitest';
import { funnelPolygon, genieKeyframes } from '../src/renderer/lib/genie';

describe('genie effect', () => {
  it('starts as the full window and ends pinched into the icon', () => {
    const frames = genieKeyframes({
      width: 800,
      height: 600,
      targetX: 500,
      targetY: 900,
      iconWidth: 44,
    });
    expect(frames[0].transform).toContain('translate(0.0px, 0.0px)');
    expect(frames[0].clipPath).toBe(funnelPolygon(0, 44 / 800));
    const last = frames[frames.length - 1];
    expect(last.transform).toContain('translate(100.0px, 300.0px)');
    expect(Number(last.opacity)).toBeLessThan(0.25);
  });

  it('plays backwards when restoring', () => {
    const geometry = { width: 400, height: 300, targetX: 200, targetY: 500, iconWidth: 44 };
    const out = genieKeyframes(geometry);
    const back = genieKeyframes(geometry, true);
    expect(back[0].transform).toBe(out[out.length - 1].transform);
    expect(back[back.length - 1].transform).toBe(out[0].transform);
    expect(back.map((f) => f.offset)).toEqual(out.map((f) => f.offset));
  });
});
