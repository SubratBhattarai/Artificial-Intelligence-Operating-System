import { useEffect, useRef } from 'react';

const MAGNETIC_SELECTOR =
  '.dock-item, .dock-search, .desktop-icon, .btn, .wc, .jarvis-pill, .tab, .side-item, .list-row, .chip, .toggle';
const GLOW_SIZE = 260;
const PULL_RADIUS = 90;

/**
 * "Magnetic glow": a soft light follows the pointer with a little lag. Over a control it tightens
 * and drifts toward the control's centre, and the control itself leans slightly toward the pointer.
 * The animation loop runs only while the glow is still moving.
 */
export function CursorGlow() {
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const glow = glowRef.current;
    if (!glow) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      glow.style.display = 'none';
      return undefined;
    }

    const pointer = { x: -400, y: -400 };
    const current = { x: -400, y: -400, scale: 1 };
    let targetScale = 1;
    let pulled: HTMLElement | null = null;
    let frame = 0;

    const release = () => {
      if (pulled) {
        pulled.style.translate = '';
        pulled = null;
      }
      targetScale = 1;
    };

    const step = () => {
      frame = 0;
      current.x += (pointer.x - current.x) * 0.2;
      current.y += (pointer.y - current.y) * 0.2;
      current.scale += (targetScale - current.scale) * 0.18;
      glow.style.transform = `translate3d(${(current.x - GLOW_SIZE / 2).toFixed(1)}px, ${(current.y - GLOW_SIZE / 2).toFixed(1)}px, 0) scale(${current.scale.toFixed(3)})`;
      const settled =
        Math.abs(pointer.x - current.x) < 0.3 &&
        Math.abs(pointer.y - current.y) < 0.3 &&
        Math.abs(targetScale - current.scale) < 0.003;
      if (!settled) frame = requestAnimationFrame(step);
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };

    const onMove = (event: PointerEvent) => {
      glow.style.opacity = '1';
      const target = (event.target as Element | null)?.closest<HTMLElement>(MAGNETIC_SELECTOR);
      if (target && !target.hasAttribute('disabled')) {
        const rect = target.getBoundingClientRect();
        const centreX = rect.left + rect.width / 2;
        const centreY = rect.top + rect.height / 2;
        const dx = event.clientX - centreX;
        const dy = event.clientY - centreY;
        const distance = Math.hypot(dx, dy);
        const strength = Math.max(
          0,
          1 - distance / (PULL_RADIUS + Math.max(rect.width, rect.height) / 2),
        );
        pointer.x = event.clientX + (centreX - event.clientX) * 0.45;
        pointer.y = event.clientY + (centreY - event.clientY) * 0.45;
        targetScale = 0.55;
        if (pulled && pulled !== target) pulled.style.translate = '';
        pulled = target;
        target.style.translate = `${(dx * 0.1 * strength).toFixed(1)}px ${(dy * 0.1 * strength).toFixed(1)}px`;
      } else {
        release();
        pointer.x = event.clientX;
        pointer.y = event.clientY;
      }
      wake();
    };
    const onLeave = () => {
      release();
      glow.style.opacity = '0';
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      release();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={glowRef} className="cursor-glow" aria-hidden />;
}
