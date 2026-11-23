import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { errorText } from '../../lib/format';
import { useTts } from '../../state/ttsStore';
import { useVoice } from '../../state/voiceStore';

/** The optional Qwen3-TTS voice: set up once, pick a reference clip, see whether it is fast enough. */
export function TtsPanel(): ReactElement {
  const status = useTts((state) => state.status);
  const prefs = useVoice((state) => state.prefs);
  const setPref = useVoice((state) => state.setPref);
  const voiceNote = useVoice((state) => state.voiceNote);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const api = window.aios;

  useEffect(() => {
    void useTts.getState().refresh();
  }, []);

  if (!api || !status)
    return (
      <section className="card">
        <h3>Natural voice (Qwen3-TTS)</h3>
        <p className="hint">Loading…</p>
      </section>
    );

  const run = (action: () => Promise<unknown>) => {
    setError(null);
    action().catch((err: unknown) => setError(errorText(err)));
  };
  const busy = status.state === 'installing' || status.state === 'starting';
  const slow = status.rtf !== undefined && status.rtf > 1;

  return (
    <section className="card">
      <h3>Natural voice (Qwen3-TTS)</h3>
      <p className="hint">
        An optional, free voice that runs only on this computer, copying a voice clip you choose.
        Until it is ready, or whenever it is too slow, the Windows voice speaks instead.
      </p>
      <p>
        Status: <strong>{status.message}</strong>
        {status.state === 'ready' && status.device
          ? ` · running on ${status.device === 'cpu' ? 'CPU' : 'GPU'}`
          : ''}
        {status.rtf !== undefined
          ? ` · ${status.rtf.toFixed(2)}× compute per second of speech`
          : ''}
      </p>
      {slow && (
        <div className="banner">
          This computer needs more than one second to make one second of speech, so longer answers
          will pause. Try “Fast” quality, or turn this voice off.
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      {busy && status.log.length > 0 && <pre className="mail-body">{status.log.join('\n')}</pre>}
      <div className="row">
        {status.state === 'not_installed' || status.state === 'error' ? (
          <button
            type="button"
            className="btn primary"
            onClick={() => run(() => api.tts.install())}
          >
            {status.state === 'error' ? 'Try setup again' : 'Set up (one-time download)'}
          </button>
        ) : null}
        {status.state === 'installing' && (
          <button type="button" className="btn" onClick={() => run(() => api.tts.cancelInstall())}>
            Cancel setup
          </button>
        )}
      </div>
      {status.state !== 'not_installed' && status.state !== 'installing' && (
        <>
          <div className="form-row">
            <label>
              Reference voice clip (5–10 seconds, clear, one speaker, a voice you have the right to
              use)
            </label>
            <textarea
              rows={2}
              value={transcript}
              placeholder="Optional: type exactly what is said in the clip. It improves quality."
              onChange={(event) => setTranscript(event.target.value)}
            />
          </div>
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={() => run(() => api.tts.setReference(transcript))}
            >
              {status.hasReference ? 'Replace reference clip…' : 'Choose reference clip…'}
            </button>
            <span className="hint">{status.hasReference ? 'A clip is set.' : 'No clip yet.'}</span>
          </div>
          <div className="perm-row">
            <div className="perm-text">
              <strong>Quality</strong>
              <span className="hint">
                “Fast” (smaller model) suits CPU-only computers. “Best” needs a strong NVIDIA GPU.
              </span>
            </div>
            <div className="seg" role="radiogroup" aria-label="Voice quality">
              {(['fast', 'best'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={status.quality === id}
                  className={`seg-btn ${status.quality === id ? 'active' : ''}`}
                  onClick={() => run(() => api.tts.configure({ quality: id }))}
                >
                  {id === 'fast' ? 'Fast' : 'Best'}
                </button>
              ))}
            </div>
          </div>
          <label>
            <input
              type="checkbox"
              checked={status.enabled}
              onChange={(event) => run(() => api.tts.configure({ enabled: event.target.checked }))}
            />{' '}
            Use this voice
          </label>
          <label>
            <input
              type="checkbox"
              checked={prefs.waitForNaturalVoice}
              onChange={(event) => setPref('waitForNaturalVoice', event.target.checked)}
            />{' '}
            Wait for this voice instead of switching to the Windows voice when it is slow
          </label>
          {voiceNote && <p className="hint">Last reply: {voiceNote}</p>}
        </>
      )}
    </section>
  );
}
