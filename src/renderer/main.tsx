import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import App from './App';
import './styles.css';
import './hud.css';
import './orb.css';
import './depth.css';
import './lunar.css';
import './scale.css';
import './voice.css';
import './light.css';
import './motion.css';
import './aura.css';
import { initDisplay } from './state/displayStore';

initDisplay();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

// Diagnostics ring buffers (read by the smoke self-check): what keys/pointer events actually occur.
function pushTrace(key: '__keyTrace' | '__ptrTrace', entry: unknown): void {
  const list = ((window as any)[key] ??= []);
  list.push(entry);
  if (list.length > 30) list.shift();
}

window.addEventListener('keydown', (event) => {
  pushTrace('__keyTrace', {
    key: event.key,
    code: event.code,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    detail: (event as any).detail,
    t: Date.now(),
  });
});
window.addEventListener('pointerup', (event) => {
  const target = event.target as HTMLElement | null;
  pushTrace('__ptrTrace', {
    kind: 'up',
    x: event.clientX,
    y: event.clientY,
    detail: (event as any).detail,
    cls: target?.className?.toString().slice(0, 40) ?? '',
    t: Date.now(),
  });
});

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
