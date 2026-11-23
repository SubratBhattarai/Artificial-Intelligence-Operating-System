import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { OrbCanvas } from './OrbCanvas';
import { useChat } from '../state/chatStore';
import { speechActivity, useVoice } from '../state/voiceStore';
import { useWake, wakeActivity } from '../state/wakeStore';

export type OrbMode = 'idle' | 'listening' | 'thinking' | 'speaking' | 'processing';

interface JarvisOrbProps {
  size?: number;
  /** Follow the live voice/chat state. Static orbs only breathe. */
  reactive?: boolean;
}

/* One shared animation frame loop for every visible orb; it stops when none is animating. */
type LevelSource = () => number;
const activeOrbs = new Map<HTMLElement, LevelSource>();
let frameId: number | null = null;
const smoothedLevels = new WeakMap<HTMLElement, number>();

function tick(now: number): void {
  for (const [element, source] of activeOrbs) {
    const previous = smoothedLevels.get(element) ?? 0;
    const target = source();
    // Fast attack, slower release: reads as a living pulse rather than jitter.
    const next = previous + (target - previous) * (target > previous ? 0.45 : 0.12);
    smoothedLevels.set(element, next);
    element.style.setProperty('--lvl', next.toFixed(3));
  }
  frameId = activeOrbs.size > 0 ? requestAnimationFrame(tick) : null;
  void now;
}

function registerOrb(element: HTMLElement, source: LevelSource): () => void {
  activeOrbs.set(element, source);
  if (frameId === null) frameId = requestAnimationFrame(tick);
  return () => {
    activeOrbs.delete(element);
    smoothedLevels.delete(element);
    element.style.setProperty('--lvl', '0');
  };
}

function levelFor(mode: OrbMode): number {
  const now = performance.now();
  if (mode === 'listening') return Math.max(useVoice.getState().level, wakeActivity.level);
  if (mode === 'speaking') {
    const kick = Math.max(0, 1 - (now - speechActivity.lastBoundaryAt) / 220);
    const wobble = 0.5 + 0.5 * Math.sin(now / 95) * Math.sin(now / 410);
    return Math.min(1, 0.18 + wobble * 0.3 + kick * 0.55);
  }
  if (mode === 'thinking' || mode === 'processing') return 0.22 + 0.12 * Math.sin(now / 380);
  return 0;
}

export function useOrbMode(): OrbMode {
  const phase = useVoice((state) => state.phase);
  const speaking = useVoice((state) => state.speaking);
  const streaming = useChat((state) => state.status === 'streaming');
  const toolRunning = useChat((state) => {
    const last = state.messages[state.messages.length - 1];
    return (
      state.status === 'streaming' &&
      Boolean(last?.tools?.some((tool) => tool.status === 'running'))
    );
  });
  const wake = useWake((state) => state.status);
  if (phase === 'recording' || wake === 'hearing' || wake === 'awake') return 'listening';
  if (speaking) return 'speaking';
  if (toolRunning) return 'processing';
  if (phase === 'transcribing' || phase === 'requesting' || streaming || wake === 'transcribing') {
    return 'thinking';
  }
  return 'idle';
}

export function JarvisOrb({ size = 24, reactive = false }: JarvisOrbProps) {
  const liveMode = useOrbMode();
  const mode: OrbMode = reactive ? liveMode : 'idle';
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || mode === 'idle') return undefined;
    if (document.hidden) return undefined;
    return registerOrb(element, () => levelFor(mode));
  }, [mode]);

  const style: CSSProperties = { width: size, height: size };
  if (size >= 200) {
    // The large desktop orb: a 3D-looking glass sphere with particle rings and energy waves.
    return (
      <span ref={ref} className={`orb orb-3d ${mode}`} style={style} aria-hidden>
        <OrbCanvas size={size} mode={mode} level={() => levelFor(mode)} />
      </span>
    );
  }
  return (
    <span
      ref={ref}
      className={`orb orb-mini ${mode} ${size <= 40 ? 'compact' : ''}`}
      style={style}
      aria-hidden
    >
      <span className="orb-sphere" />
    </span>
  );
}
