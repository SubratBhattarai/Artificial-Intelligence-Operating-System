/**
 * A macOS-style genie: the window is squeezed into a funnel (its bottom pinches first) and slides into
 * the dock icon; restoring plays the same thing backwards. Built as many small keyframes of a clip-path
 * polygon plus a transform, so it works with plain Web Animations and needs no extra libraries.
 */
export interface GenieGeometry {
  /** Window size in px. */
  width: number;
  height: number;
  /** Where the dock icon's centre is, relative to the window's top-left corner. */
  targetX: number;
  targetY: number;
  /** Dock icon width in px (the funnel narrows to about this). */
  iconWidth: number;
}

const FRAMES = 18;
const SLICES = 12;

const smoothstep = (value: number): number => value * value * (3 - 2 * value);
const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** The window's outline at progress p (0 = full window, 1 = pinched into the icon). */
export function funnelPolygon(p: number, iconFraction: number): string {
  const left: string[] = [];
  const right: string[] = [];
  for (let slice = 0; slice <= SLICES; slice += 1) {
    const y = slice / SLICES;
    // The lower the slice, the more it is pinched, with an S-curve so the sides bend like fabric.
    const pinch = p * (1 - iconFraction) * smoothstep(Math.pow(y, 1.15));
    const half = 0.5 * (1 - pinch);
    left.push(`${((0.5 - half) * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`);
    right.unshift(`${((0.5 + half) * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`);
  }
  return `polygon(${[...left, ...right].join(', ')})`;
}

export function genieKeyframes(geometry: GenieGeometry, reverse = false): Keyframe[] {
  const { width, height, targetX, targetY, iconWidth } = geometry;
  const iconFraction = Math.max(0.04, Math.min(0.5, iconWidth / Math.max(width, 1)));
  const frames: Keyframe[] = [];
  for (let index = 0; index <= FRAMES; index += 1) {
    const raw = index / FRAMES;
    const p = easeInOut(raw);
    // Move so the bottom edge lands on the icon; shrink vertically so it reads as pulled in.
    const dx = (targetX - width / 2) * p;
    const dy = (targetY - height) * p;
    const scaleY = 1 - 0.9 * p;
    const scaleX = 1 - 0.35 * p;
    frames.push({
      offset: raw,
      transformOrigin: '50% 100%',
      transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`,
      clipPath: funnelPolygon(p, iconFraction),
      opacity: p > 0.9 ? 1 - (p - 0.9) * 8 : 1,
    });
  }
  return reverse ? frames.map((_, i) => ({ ...frames[FRAMES - i], offset: i / FRAMES })) : frames;
}

export const GENIE_MS = 520;

/** Run the genie on an element. `toDock` minimizes; otherwise the window grows back out of the dock. */
export function playGenie(
  element: HTMLElement,
  dockIcon: Element | null,
  toDock: boolean,
): Animation | null {
  if (typeof element.animate !== 'function') return null;
  const box = element.getBoundingClientRect();
  const icon = dockIcon?.getBoundingClientRect();
  const targetX = (icon ? icon.left + icon.width / 2 : window.innerWidth / 2) - box.left;
  const targetY = (icon ? icon.top + icon.height / 2 : window.innerHeight - 40) - box.top;
  return element.animate(
    genieKeyframes(
      { width: box.width, height: box.height, targetX, targetY, iconWidth: icon?.width ?? 44 },
      !toDock,
    ),
    { duration: GENIE_MS, easing: 'linear', fill: toDock ? 'forwards' : 'none' },
  );
}
