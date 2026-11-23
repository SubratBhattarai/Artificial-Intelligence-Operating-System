/**
 * Pure geometry + persistence-sanitization helpers.
 * Kept free of DOM/store imports so the rules for safe position persistence are unit-testable.
 */

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const TOP_BAR_HEIGHT = 32;
export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 200;
/** How much of a window must stay on screen for it to remain reachable. */
export const EDGE_MARGIN = 120;

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Keep a window's title bar reachable: below the top bar, mostly inside the viewport. */
export function clampPosition(bounds: Bounds, viewport: Viewport): { x: number; y: number } {
  const x = clamp(bounds.x, -bounds.width + EDGE_MARGIN, viewport.width - EDGE_MARGIN);
  const y = clamp(bounds.y, TOP_BAR_HEIGHT, viewport.height - 48);
  return { x: Math.round(x), y: Math.round(y) };
}

export function clampSize(size: Size, viewport: Viewport): Size {
  return {
    width: Math.round(clamp(size.width, MIN_WIDTH, viewport.width)),
    height: Math.round(clamp(size.height, MIN_HEIGHT, viewport.height - TOP_BAR_HEIGHT)),
  };
}

export function centerBounds(size: Size, viewport: Viewport, cascadeIndex = 0): Bounds {
  const clamped = clampSize(size, viewport);
  const offset = cascadeIndex * 28;
  const x = Math.max(24, (viewport.width - clamped.width) / 2 + offset);
  const y = Math.max(TOP_BAR_HEIGHT + 16, (viewport.height - clamped.height) / 3 + offset);
  return { ...clamped, x: Math.round(x), y: Math.round(y) };
}

export function maximizedBounds(viewport: Viewport): Bounds {
  return {
    x: 0,
    y: TOP_BAR_HEIGHT,
    width: viewport.width,
    height: viewport.height - TOP_BAR_HEIGHT,
  };
}

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Pointer-delta resize. Edges are anchored: the opposite edge never moves. */
export function resizeBounds(
  start: Bounds,
  direction: ResizeDirection,
  dx: number,
  dy: number,
  viewport: Viewport,
  min: Size = { width: MIN_WIDTH, height: MIN_HEIGHT },
): Bounds {
  let { x, y, width, height } = start;

  if (direction.includes('e')) {
    width = clamp(start.width + dx, min.width, viewport.width - start.x);
  }
  if (direction.includes('s')) {
    height = clamp(start.height + dy, min.height, viewport.height - start.y);
  }
  if (direction.includes('w')) {
    const right = start.x + start.width;
    x = clamp(start.x + dx, 0, right - min.width);
    width = right - x;
  }
  if (direction.includes('n')) {
    const bottom = start.y + start.height;
    y = clamp(start.y + dy, TOP_BAR_HEIGHT, bottom - min.height);
    height = bottom - y;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/* ---------------- persistence ---------------- */

export interface PersistedWindow {
  appId: string;
  bounds: Bounds;
  state: 'normal' | 'maximized';
}

export const LAYOUT_STORAGE_KEY = 'aios.layout.v1';
export const LAYOUT_VERSION = 1;

/**
 * Validate anything read back from storage. Storage is untrusted input: malformed JSON,
 * NaN coordinates, unknown apps, duplicates and off-screen rectangles must all be neutralized
 * before they reach the window manager.
 */
export function sanitizePersistedLayout(
  raw: unknown,
  viewport: Viewport,
  validAppIds: string[],
): PersistedWindow[] {
  if (!raw || typeof raw !== 'object') return [];
  const windows = (raw as { windows?: unknown }).windows;
  if (!Array.isArray(windows)) return [];

  const valid = new Set(validAppIds);
  const seen = new Set<string>();
  const out: PersistedWindow[] = [];

  for (const entry of windows) {
    if (!entry || typeof entry !== 'object') continue;
    const { appId, bounds, state } = entry as Partial<PersistedWindow>;
    if (typeof appId !== 'string' || !valid.has(appId) || seen.has(appId)) continue;
    seen.add(appId);

    const size = clampSize(
      {
        width: isFiniteNumber(bounds?.width) ? bounds.width : 0,
        height: isFiniteNumber(bounds?.height) ? bounds.height : 0,
      },
      viewport,
    );
    const fallback = centerBounds(size, viewport, out.length);
    const safeBounds: Bounds =
      isFiniteNumber(bounds?.x) && isFiniteNumber(bounds?.y)
        ? {
            ...size,
            ...clampPosition({ ...size, x: bounds.x, y: bounds.y }, viewport),
          }
        : fallback;

    out.push({
      appId,
      bounds: safeBounds,
      state: state === 'maximized' ? 'maximized' : 'normal',
    });
  }

  return out;
}
