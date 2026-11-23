import { useEffect, useRef } from 'react';
import { AMBIENT } from '../lib/ambient';
import type { OrbMode } from './JarvisOrb';

interface OrbCanvasProps {
  size: number;
  mode: OrbMode;
  /** Returns the current 0..1 voice level for the orb's mode. Read every frame, no re-renders. */
  level: () => number;
}

const TAU = Math.PI * 2;
const RIM_POINTS = 120;

/** Per-state motion. Everything the orb does is derived from these few numbers. */
interface Motion {
  /** Speed of the drifting light inside the sphere. */
  drift: number;
  /** Brightness of the inner glow, 0..1. */
  glow: number;
  /** How far the silhouette ripples with the voice level. */
  ripple: number;
  /** Speed of the surface ripple. */
  rippleSpeed: number;
  /** Opacity of the orbiting processing arc. */
  arc: number;
}

const MOTION: Record<OrbMode, Motion> = {
  idle: { drift: 0.16, glow: 0.38, ripple: 0.004, rippleSpeed: 0.7, arc: 0 },
  listening: { drift: 0.5, glow: 0.62, ripple: 0.05, rippleSpeed: 2.4, arc: 0 },
  thinking: { drift: 0.95, glow: 0.7, ripple: 0.012, rippleSpeed: 1.4, arc: 0 },
  speaking: { drift: 0.4, glow: 0.58, ripple: 0.04, rippleSpeed: 2, arc: 0 },
  processing: { drift: 0.7, glow: 0.52, ripple: 0.008, rippleSpeed: 1.1, arc: 1 },
};

const mix = (from: number, to: number, amount: number): number => from + (to - from) * amount;
const rgba = (c: [number, number, number], a: number): string =>
  `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/**
 * A calm, sculpted glass orb. A softly lit sphere with a luminous core that drifts like liquid,
 * a silhouette that ripples with the voice, and a fine arc that circles it while JARVIS works.
 * Pure 2D canvas, one animation loop that pauses while the window is hidden. It reads the page theme
 * so it looks like pearl on the light theme and like brushed charcoal on the dark one.
 */
export function OrbCanvas({ size, mode, level }: OrbCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const levelRef = useRef(level);
  modeRef.current = mode;
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const dpr = Math.min(size > 520 ? 1.5 : 2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.scale(dpr, dpr);

    // Motion eases between states instead of snapping, so every change feels fluid.
    const current: Motion = { ...MOTION[modeRef.current] };
    let swell = 0;
    let phase = 0;
    let drift = 0;
    let arcAngle = 0;
    let frame = 0;
    let last = performance.now();

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const target = MOTION[modeRef.current];
      const ease = 1 - Math.exp(-dt * 4);
      for (const key of Object.keys(target) as Array<keyof Motion>) {
        current[key] = mix(current[key], target[key], ease);
      }
      const raw = modeRef.current === 'idle' ? 0 : levelRef.current();
      swell += (raw - swell) * (raw > swell ? 0.3 : 0.08);
      const dark = document.documentElement.dataset.theme === 'dark';
      const motionScale = reduced ? 0 : 1;
      phase += dt * current.rippleSpeed * motionScale;
      drift += dt * current.drift * motionScale;
      arcAngle += dt * 1.6 * motionScale;

      const cx = size / 2;
      const cy = size / 2;
      const breathe = Math.sin(t * 0.9) * 0.012 * motionScale;
      const R = size * 0.3 * (1 + breathe + swell * 0.05);
      const accent = AMBIENT.colors[2];
      const silver = AMBIENT.colors[1];
      ctx.clearRect(0, 0, size, size);

      // soft floor shadow (light) or ambient halo (dark)
      if (dark) {
        const halo = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 2.1);
        halo.addColorStop(0, rgba(accent, 0.1 + swell * 0.1));
        halo.addColorStop(1, rgba(accent, 0));
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, size, size);
      } else {
        const shadow = ctx.createRadialGradient(cx, cy + R * 1.18, 0, cx, cy + R * 1.18, R * 0.95);
        shadow.addColorStop(0, `rgba(30,34,42,${0.16 + swell * 0.05})`);
        shadow.addColorStop(1, 'rgba(30,34,42,0)');
        ctx.save();
        ctx.translate(0, 0);
        ctx.scale(1, 1);
        ctx.fillStyle = shadow;
        ctx.beginPath();
        ctx.ellipse(cx, cy + R * 1.18, R * 0.95, R * 0.16, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      // silhouette: a circle that ripples gently with the voice
      ctx.beginPath();
      for (let i = 0; i <= RIM_POINTS; i += 1) {
        const a = (i / RIM_POINTS) * TAU;
        const wobble =
          Math.sin(a * 3 + phase) * 0.55 +
          Math.sin(a * 5 - phase * 1.3) * 0.3 +
          Math.sin(a * 2 + phase * 0.7) * 0.4;
        const r = R * (1 + wobble * (current.ripple * (0.35 + swell * 1.4)));
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      // body: a sphere lit from the upper left
      const body = ctx.createRadialGradient(
        cx - R * 0.4,
        cy - R * 0.45,
        R * 0.08,
        cx,
        cy,
        R * 1.05,
      );
      if (dark) {
        body.addColorStop(0, '#9da2ab');
        body.addColorStop(0.45, '#3a3d44');
        body.addColorStop(1, '#14161a');
      } else {
        body.addColorStop(0, '#ffffff');
        body.addColorStop(0.5, '#e4e7ec');
        body.addColorStop(1, '#a9aeb8');
      }
      ctx.fillStyle = body;
      ctx.fill();

      ctx.save();
      ctx.clip();

      // luminous core: a few soft lights drifting like liquid under the surface
      const lights = [
        { a: drift * 1.0, d: 0.34, r: 0.78, c: accent, w: 1 },
        { a: drift * -0.7 + 2.1, d: 0.42, r: 0.66, c: silver, w: 0.8 },
        { a: drift * 0.5 + 4.2, d: 0.28, r: 0.58, c: accent, w: 0.7 },
      ];
      ctx.globalCompositeOperation = dark ? 'lighter' : 'multiply';
      for (const light of lights) {
        const lx = cx + Math.cos(light.a) * R * light.d;
        const ly = cy + Math.sin(light.a * 1.2) * R * light.d;
        const strength = (current.glow + swell * 0.35) * light.w * (dark ? 0.55 : 0.5);
        const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * light.r);
        g.addColorStop(0, rgba(light.c, strength));
        g.addColorStop(1, rgba(light.c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      }
      ctx.globalCompositeOperation = 'source-over';

      // depth: darken the lower right so it reads as a sphere, not a disc
      const depth = ctx.createRadialGradient(
        cx - R * 0.3,
        cy - R * 0.35,
        R * 0.4,
        cx,
        cy,
        R * 1.05,
      );
      depth.addColorStop(0, 'rgba(0,0,0,0)');
      depth.addColorStop(1, dark ? 'rgba(0,0,0,0.5)' : 'rgba(40,46,58,0.28)');
      ctx.fillStyle = depth;
      ctx.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);

      // specular highlight
      const spec = ctx.createRadialGradient(
        cx - R * 0.42,
        cy - R * 0.5,
        0,
        cx - R * 0.42,
        cy - R * 0.5,
        R * 0.5,
      );
      spec.addColorStop(0, `rgba(255,255,255,${dark ? 0.32 : 0.85})`);
      spec.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = spec;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      ctx.restore();

      // fine rim light
      ctx.lineWidth = 1;
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, R - 0.5, 0, TAU);
      ctx.stroke();

      // processing: a single fine arc circling the orb
      if (current.arc > 0.02) {
        ctx.lineCap = 'round';
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = dark
          ? `rgba(230,233,240,${0.6 * current.arc})`
          : `rgba(40,44,52,${0.55 * current.arc})`;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.16, arcAngle, arcAngle + 1.1);
        ctx.stroke();
        ctx.strokeStyle = dark
          ? `rgba(230,233,240,${0.2 * current.arc})`
          : `rgba(40,44,52,${0.16 * current.arc})`;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.16, arcAngle + 1.1, arcAngle + TAU * 0.8);
        ctx.stroke();
      }

      // listening: soft expanding rings that follow the voice
      if (modeRef.current === 'listening' || modeRef.current === 'speaking') {
        for (let ring = 0; ring < 2; ring += 1) {
          const age = (t * 0.5 + ring * 0.5) % 1;
          ctx.strokeStyle = dark
            ? `rgba(230,233,240,${(1 - age) * (0.12 + swell * 0.25)})`
            : `rgba(40,44,52,${(1 - age) * (0.1 + swell * 0.22)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cx, cy, R * (1.04 + age * 0.5), 0, TAU);
          ctx.stroke();
        }
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      className="orb-canvas"
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
