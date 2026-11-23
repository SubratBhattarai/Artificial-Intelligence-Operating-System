import { useCallback, useEffect, useRef, useState } from 'react';
import type { Health } from '../../shared/protocol';

export async function fetchHealth(): Promise<Health | null> {
  const api = window.aios;
  if (!api) return null;
  try {
    return await api.getHealth();
  } catch {
    return null;
  }
}

/** Polls main-process health so the top-bar status indicator and Status app stay current. */
export function useHealth(intervalMs = 15000): { health: Health | null; refresh: () => void } {
  const [health, setHealth] = useState<Health | null>(null);
  const isMountedRef = useRef(true);
  const isFetchingRef = useRef(false);

  const refresh = useCallback(() => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    void fetchHealth()
      .then((next) => {
        // A transient failed check keeps the last known report instead of flashing "offline".
        if (isMountedRef.current && next) setHealth(next);
      })
      .finally(() => {
        isFetchingRef.current = false;
      });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => {
      isMountedRef.current = false;
      clearInterval(timer);
    };
  }, [intervalMs, refresh]);

  return { health, refresh };
}
