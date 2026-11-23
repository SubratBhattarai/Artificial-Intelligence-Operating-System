import { useWindows } from '../state/windowStore';
import { WindowFrame } from './WindowFrame';

/**
 * Renders open windows in focus order. Minimized windows are skipped, and each frame
 * receives a z-index derived from its position in the focus stack.
 */
export function WindowLayer() {
  const order = useWindows((state) => state.order);
  const windows = useWindows((state) => state.windows);
  const focusedId = useWindows((state) => state.focusedId);

  const frames = order.map((id, index) => {
    const win = windows[id];
    if (!win || win.state === 'minimized') return null;
    return <WindowFrame key={id} win={win} active={id === focusedId} zIndex={10 + index} />;
  });

  return <div className="window-layer">{frames}</div>;
}
