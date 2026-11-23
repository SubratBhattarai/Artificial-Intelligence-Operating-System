import { describe, expect, it } from 'vitest';
import {
  LAYOUT_STORAGE_KEY,
  MIN_HEIGHT,
  MIN_WIDTH,
  TOP_BAR_HEIGHT,
  centerBounds,
  clampPosition,
  clampSize,
  maximizedBounds,
  resizeBounds,
  sanitizePersistedLayout,
} from '../src/renderer/lib/layout';

const viewport = { width: 1440, height: 900 };

describe('clampSize', () => {
  it('enforces minimum dimensions', () => {
    const size = clampSize({ width: 10, height: 20 }, viewport);
    expect(size.width).toBe(MIN_WIDTH);
    expect(size.height).toBe(MIN_HEIGHT);
  });

  it('never exceeds the viewport', () => {
    const size = clampSize({ width: 5000, height: 5000 }, viewport);
    expect(size.width).toBe(viewport.width);
    expect(size.height).toBe(viewport.height - TOP_BAR_HEIGHT);
  });
});

describe('clampPosition', () => {
  it('keeps the title bar below the top bar', () => {
    const { y } = clampPosition({ x: 100, y: -500, width: 600, height: 400 }, viewport);
    expect(y).toBe(TOP_BAR_HEIGHT);
  });

  it('keeps a sliver of the window on screen', () => {
    const { x } = clampPosition({ x: 99999, y: 100, width: 600, height: 400 }, viewport);
    expect(x).toBeLessThanOrEqual(viewport.width - 120);
  });
});

describe('resizeBounds', () => {
  const start = { x: 400, y: 300, width: 600, height: 400 };

  it('anchors the opposite edge when resizing from west/north', () => {
    const next = resizeBounds(start, 'w', 100, 50, viewport);
    expect(next.x).toBe(500);
    expect(next.x + next.width).toBe(start.x + start.width);
    expect(next.y + next.height).toBe(start.y + start.height);
  });

  it('respects minimum size from the east edge', () => {
    const next = resizeBounds(start, 'e', -10_000, 0, viewport);
    expect(next.width).toBe(MIN_WIDTH);
  });

  it('cannot drag the top edge under the top bar', () => {
    const next = resizeBounds(start, 'n', 0, -10_000, viewport);
    expect(next.y).toBeGreaterThanOrEqual(TOP_BAR_HEIGHT);
  });
});

describe('maximizedBounds / centerBounds', () => {
  it('fills the area below the top bar', () => {
    const bounds = maximizedBounds(viewport);
    expect(bounds.y).toBe(TOP_BAR_HEIGHT);
    expect(bounds.height).toBe(viewport.height - TOP_BAR_HEIGHT);
  });

  it('centers inside the viewport', () => {
    const bounds = centerBounds({ width: 700, height: 500 }, viewport);
    expect(bounds.x).toBeGreaterThan(0);
    expect(bounds.y).toBeGreaterThan(TOP_BAR_HEIGHT);
  });
});

describe('sanitizePersistedLayout (safe position persistence)', () => {
  const validApps = ['status', 'files'];

  it('returns [] for garbage input', () => {
    expect(sanitizePersistedLayout(null, viewport, validApps)).toEqual([]);
    expect(sanitizePersistedLayout('not json', viewport, validApps)).toEqual([]);
    expect(sanitizePersistedLayout({ windows: 'nope' }, viewport, validApps)).toEqual([]);
  });

  it('drops unknown apps and duplicates', () => {
    const raw = {
      windows: [
        { appId: 'status', bounds: { x: 10, y: 40, width: 600, height: 400 }, state: 'normal' },
        { appId: 'malware', bounds: { x: 10, y: 40, width: 600, height: 400 }, state: 'normal' },
        { appId: 'status', bounds: { x: 99, y: 40, width: 600, height: 400 }, state: 'normal' },
      ],
    };
    const result = sanitizePersistedLayout(raw, viewport, validApps);
    expect(result).toHaveLength(1);
    expect(result[0].appId).toBe('status');
    expect(result[0].bounds.x).toBe(10);
  });

  it('repairs NaN / off-screen coordinates', () => {
    const raw = {
      windows: [
        { appId: 'files', bounds: { x: NaN, y: -9999, width: 800, height: 500 }, state: 'normal' },
      ],
    };
    const result = sanitizePersistedLayout(raw, viewport, validApps);
    expect(result).toHaveLength(1);
    const bounds = result[0].bounds;
    expect(Number.isFinite(bounds.x)).toBe(true);
    expect(bounds.y).toBeGreaterThanOrEqual(TOP_BAR_HEIGHT);
    expect(bounds.width).toBeGreaterThanOrEqual(MIN_WIDTH);
  });

  it('keeps only known window states', () => {
    const raw = {
      windows: [
        { appId: 'status', bounds: { x: 10, y: 40, width: 600, height: 400 }, state: 'exploded' },
      ],
    };
    expect(sanitizePersistedLayout(raw, viewport, validApps)[0].state).toBe('normal');
  });

  it('exposes a stable storage key', () => {
    expect(LAYOUT_STORAGE_KEY).toBe('aios.layout.v1');
  });
});
