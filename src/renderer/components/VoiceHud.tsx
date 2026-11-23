import { useEffect, useMemo, useRef, useState } from 'react';
import { useSystemVoices, sortVoices } from '../lib/voices';
import { useChat } from '../state/chatStore';
import { usePermissions } from '../state/permissionStore';
import { useUi } from '../state/uiStore';
import { useVoice } from '../state/voiceStore';
import { useWake, type WakeStatus } from '../state/wakeStore';
import { ApprovalCard } from './ApprovalCard';
import { MicIcon, SendIcon, StopIcon } from './Icons';

const STATUS_TEXT: Record<WakeStatus, string> = {
  off: 'Voice is off',
  starting: 'Starting the microphone…',
  listening: 'Say “Jarvis” to begin',
  hearing: 'Listening…',
  transcribing: 'Understanding…',
  awake: 'Yes? I’m listening…',
  error: 'Voice unavailable',
};

/**
 * The voice-first control strip over the orb: what JARVIS hears, what it answers, approval cards,
 * a voice picker, and an optional typing line. Hidden while the full JARVIS panel is open.
 */
export function VoiceHud() {
  const jarvisOpen = useUi((state) => state.jarvisOpen);
  const openJarvis = useUi((state) => state.openJarvis);
  const { status, error, enabled, enable, disable } = useWake();
  const pending = useWake((state) => state.pending);
  const takePending = useWake((state) => state.takePending);
  const reviewBeforeSend = useWake((state) => state.reviewBeforeSend);
  const setReviewBeforeSend = useWake((state) => state.setReviewBeforeSend);
  const allowInterrupt = useWake((state) => state.allowInterrupt);
  const setAllowInterrupt = useWake((state) => state.setAllowInterrupt);
  const speak = useVoice((state) => state.speak);
  const micPermission = usePermissions((state) => state.levels.microphone);
  const setPermission = usePermissions((state) => state.set);
  const chatStatus = useChat((state) => state.status);
  const messages = useChat((state) => state.messages);
  const approvals = useChat((state) => state.approvals);
  const send = useChat((state) => state.send);
  const cancelChat = useChat((state) => state.cancel);
  const speaking = useVoice((state) => state.speaking);
  const prefs = useVoice((state) => state.prefs);
  const setPref = useVoice((state) => state.setPref);
  const stopSpeaking = useVoice((state) => state.stopSpeaking);
  const previewVoice = useVoice((state) => state.previewVoice);
  const modelProgress = useVoice((state) => state.modelProgress);
  const systemVoices = useSystemVoices();
  const voices = useMemo(() => sortVoices(systemVoices), [systemVoices]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [dismissedAt, setDismissedAt] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing]);

  // A spoken request waiting for review lands in the same editable box as typed text.
  useEffect(() => {
    if (pending === null) return;
    setDraft(pending);
    setTyping(true);
    takePending();
  }, [pending, takePending]);

  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const reply = lastAssistant && lastAssistant.createdAt > dismissedAt ? lastAssistant : null;
  const busy = chatStatus === 'streaming';

  if (jarvisOpen) return null;

  const turnOn = async () => {
    if (micPermission !== 'write') await setPermission('microphone', 'write'); // the click is the user's consent
    await enable();
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void send(text);
  };

  const headline = busy
    ? 'Thinking…'
    : speaking
      ? 'Speaking…'
      : modelProgress
        ? `Loading the speech model${modelProgress.percent != null ? ` ${Math.round(modelProgress.percent)}%` : '…'}`
        : STATUS_TEXT[status];

  return (
    <section className="voice-hud" aria-label="Voice assistant">
      {approvals.map((approval) => (
        <ApprovalCard key={approval.id} approval={approval} />
      ))}

      {reply && (
        <div className="hud-reply" role="status">
          {lastUser && <div className="hud-you">{lastUser.content}</div>}
          <div className="hud-answer">{reply.content || '…'}</div>
          <button
            type="button"
            className="hud-x hud-reread"
            onClick={() => speak(reply.content)}
            aria-label="Read this reply again"
            title="Read this reply again"
          >
            ↻
          </button>
          <button
            type="button"
            className="hud-x"
            onClick={() => setDismissedAt(Date.now())}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div className={`hud-bar ${status}`}>
        <span className={`hud-dot ${status}`} aria-hidden />
        <span className="hud-status">{headline}</span>
        {error && <span className="hud-error">{error}</span>}

        <span className="hud-spacer" />

        {(busy || speaking) && (
          <button
            type="button"
            className="btn hud-btn"
            onClick={() => {
              void cancelChat();
              stopSpeaking();
            }}
          >
            <StopIcon size={14} /> Stop
          </button>
        )}

        {enabled && status !== 'off' ? (
          <button
            type="button"
            className="btn hud-btn"
            onClick={disable}
            title="Turn the microphone off"
          >
            <MicIcon size={14} /> Mic off
          </button>
        ) : (
          <button type="button" className="btn primary hud-btn" onClick={() => void turnOn()}>
            <MicIcon size={14} /> {micPermission === 'write' ? 'Turn on voice' : 'Allow microphone'}
          </button>
        )}

        <select
          className="input compact hud-voice"
          value={prefs.voiceUri ?? ''}
          onChange={(event) => setPref('voiceUri', event.target.value || null)}
          aria-label="JARVIS voice"
          title="Choose JARVIS’s voice"
        >
          <option value="">Best match (female, US English)</option>
          {voices.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn hud-btn"
          onClick={previewVoice}
          title="Hear this voice"
        >
          ▶
        </button>
        <button
          type="button"
          className={`btn hud-btn ${prefs.muted ? 'on' : ''}`}
          onClick={() => setPref('muted', !prefs.muted)}
          title={prefs.muted ? 'Unmute replies' : 'Mute replies'}
        >
          {prefs.muted ? '🔇' : '🔊'}
        </button>
        <button
          type="button"
          className="btn hud-btn"
          onClick={() => setTyping((open) => !open)}
          title="Type instead"
        >
          ⌨
        </button>
        <button
          type="button"
          className="btn hud-btn"
          onClick={openJarvis}
          title="Open the full JARVIS panel"
        >
          ⤢
        </button>
      </div>

      {typing && (
        <form
          className="hud-type hud-compose"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <textarea
            ref={inputRef}
            className="input grow"
            rows={2}
            placeholder="Type to JARVIS, or edit what you said…"
            value={draft}
            maxLength={2000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="hud-compose-actions">
            <button type="submit" className="btn primary hud-btn" disabled={!draft.trim()}>
              <SendIcon size={14} /> Send
            </button>
            <button
              type="button"
              className="btn hud-btn"
              disabled={!draft.trim()}
              onClick={() => speak(draft)}
              title="Read this text aloud"
            >
              Reread
            </button>
            <button
              type="button"
              className="btn hud-btn"
              disabled={!draft}
              onClick={() => {
                setDraft('');
                inputRef.current?.focus();
              }}
              title="Empty the box and start again"
            >
              Clear
            </button>
            <button
              type="button"
              className="btn hud-btn"
              onClick={() => {
                setDraft('');
                setTyping(false);
                stopSpeaking();
              }}
              title="Discard this text and close the box"
            >
              Delete
            </button>
            <label className="check hud-review">
              <input
                type="checkbox"
                checked={reviewBeforeSend}
                onChange={(event) => setReviewBeforeSend(event.target.checked)}
              />
              <span>Review my voice before sending</span>
            </label>
            <label className="check hud-review">
              <input
                type="checkbox"
                checked={allowInterrupt}
                onChange={(event) => setAllowInterrupt(event.target.checked)}
              />
              <span>Let me interrupt by speaking (headphones work best)</span>
            </label>
          </div>
        </form>
      )}
    </section>
  );
}
