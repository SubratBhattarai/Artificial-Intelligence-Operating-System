import type { ReactElement } from 'react';
import { usePermissions } from '../../state/permissionStore';
import { useWake } from '../../state/wakeStore';

const STATE_TEXT: Record<string, string> = {
  off: 'Off',
  starting: 'Starting…',
  listening: 'Listening for “Jarvis”',
  hearing: 'Hearing speech…',
  transcribing: 'Understanding…',
  awake: 'Waiting for your request',
  error: 'Unavailable',
};

export function WakePanel(): ReactElement {
  const { enabled, status, error, enable, disable } = useWake();
  const mic = usePermissions((state) => state.levels.microphone);
  const setPermission = usePermissions((state) => state.set);
  const live = status !== 'off' && status !== 'error';

  return (
    <section className="card">
      <h3>“Jarvis” voice activation</h3>
      <p>
        Status: <strong>{STATE_TEXT[status]}</strong>
        {enabled && !live && mic !== 'write' ? ' — Microphone permission is off' : ''}
      </p>
      <div className="row">
        {live ? (
          <button type="button" className="btn" onClick={disable}>
            Turn the microphone off
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              void (async () => {
                if (mic !== 'write') await setPermission('microphone', 'write');
                await enable();
              })();
            }}
          >
            Allow microphone &amp; listen for “Jarvis”
          </button>
        )}
      </div>
      {error && <p className="hint">{error}</p>}
      <p className="hint">
        Everything runs on this computer. The microphone is analysed locally; only moments where
        someone is speaking are turned into text, the text is checked for “Jarvis”, and anything
        else is thrown away immediately and never saved. A MIC indicator stays in the top bar while
        it is on. You can also hold F8 for push-to-talk.
      </p>
    </section>
  );
}
