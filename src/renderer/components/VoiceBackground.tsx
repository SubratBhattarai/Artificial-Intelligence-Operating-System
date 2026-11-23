import { useEffect, useState } from 'react';
import { JarvisOrb, useOrbMode } from './JarvisOrb';
import type { OrbMode } from './JarvisOrb';

const STATE_LINE: Record<OrbMode, string> = {
  idle: 'Say “Jarvis”, or press Alt+Space',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  processing: 'Working on it',
};

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 5_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function orbSize(): number {
  const base = Math.min(window.innerWidth, window.innerHeight * 1.05) * 0.56;
  return Math.round(Math.min(720, Math.max(260, base)));
}

/**
 * The home screen: one calm orb at the centre, a quiet clock beneath it and a single line saying
 * what JARVIS is doing. The orb breathes at rest, listens, thinks, speaks and works.
 */
export function VoiceBackground() {
  const [size, setSize] = useState(orbSize);
  const now = useClock();
  const mode = useOrbMode();
  useEffect(() => {
    const onResize = () => setSize(orbSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return (
    <div className="voice-bg" aria-hidden="true">
      <JarvisOrb size={size} reactive />
      <div className="stage-clock">
        <div className="stage-time">
          {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </div>
        <div className="stage-date">
          {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
        <div className={`stage-state ${mode}`}>{STATE_LINE[mode]}</div>
      </div>
    </div>
  );
}
