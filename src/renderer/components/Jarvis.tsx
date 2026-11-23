import { useCallback, useEffect, useRef, useState } from 'react';
import type { Health, ToolStatus } from '../../shared/protocol';
import { formatDuration } from '../lib/format';
import { fetchHealth } from '../lib/health';
import { useChat, type UiChatMessage } from '../state/chatStore';
import { useContextGrant } from '../state/contextStore';
import { useUi } from '../state/uiStore';
import { useVoice } from '../state/voiceStore';
import { MicIcon, SendIcon, ShieldIcon, SpeakerIcon, StopIcon } from './Icons';
import { ApprovalCard } from './ApprovalCard';
import { JarvisOrb } from './JarvisOrb';

const SUGGESTIONS = [
  'What apps are open right now?',
  'What do my saved notes say about deadlines?',
  'Find the budget in my documents',
];

/** Hold this key while JARVIS is open to talk. */
const PUSH_TO_TALK_KEY = 'F8';

const OUTCOME_LABEL: Record<ToolStatus, string> = {
  completed: 'done',
  verified: 'verified',
  not_verified: 'not confirmed',
  failed: 'failed',
  rolled_back: 'undone',
  denied: 'not approved',
  rejected: 'blocked',
  cancelled: 'cancelled',
};

function ToolStrip({ message }: { message: UiChatMessage }) {
  if (!message.tools || message.tools.length === 0) return null;
  return (
    <div className="tool-strip">
      {message.tools.map((tool, index) => (
        <span key={`${tool.name}-${index}`} className={`tool-chip ${tool.status}`}>
          <span className="tool-glyph">
            {tool.status === 'running' ? '⟳' : tool.status === 'ok' ? '✓' : '✕'}
          </span>
          {tool.name}
          {tool.outcome && tool.status !== 'running' ? (
            <em className="tool-preview"> {OUTCOME_LABEL[tool.outcome]}</em>
          ) : null}
          {tool.detail && tool.status === 'error' ? (
            <em className="tool-preview"> {tool.detail.slice(0, 90)}</em>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function MessageBubble({
  message,
  streaming,
  onSpeak,
}: {
  message: UiChatMessage;
  streaming: boolean;
  onSpeak: (text: string) => void;
}) {
  return (
    <div className={`msg ${message.role} ${message.error ? 'errored' : ''}`}>
      <div className="msg-role">
        {message.role === 'user' ? 'You' : 'JARVIS'}
        {message.role === 'assistant' && message.content && !streaming && !message.error && (
          <button
            type="button"
            className="msg-speak"
            onClick={() => onSpeak(message.content)}
            title="Read aloud"
          >
            <SpeakerIcon size={13} />
          </button>
        )}
      </div>
      <div className="msg-content">
        {message.role === 'assistant' && <ToolStrip message={message} />}
        {message.content || (streaming ? <span className="caret" /> : null)}
      </div>
    </div>
  );
}

function LevelMeter({ level }: { level: number }) {
  const bars = 14;
  return (
    <span className="level-meter" aria-hidden>
      {Array.from({ length: bars }, (_, index) => {
        const threshold = (index + 1) / bars;
        const on = level >= threshold * 0.9;
        return (
          <span
            key={index}
            className={on ? 'on' : ''}
            style={{ height: `${30 + (index % 5) * 14}%` }}
          />
        );
      })}
    </span>
  );
}

export function Jarvis() {
  const open = useUi((state) => state.jarvisOpen);
  const closeJarvis = useUi((state) => state.closeJarvis);
  const { messages, status, error, requestId, send, cancel, clear, approvals } = useChat();
  const voice = useVoice();
  const context = useContextGrant();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const previousStatus = useRef(status);
  const holdingKey = useRef(false);

  const streaming = status === 'streaming';
  const voiceBusy = voice.phase !== 'idle';
  const sttReady = voice.config?.sttConfigured ?? false;

  const startTalking = useCallback(() => {
    if (!sttReady || useVoice.getState().phase !== 'idle') return;
    // Interruption: talking over JARVIS stops its speech and any answer still being written.
    useVoice.getState().stopSpeaking();
    if (useChat.getState().status === 'streaming') void useChat.getState().cancel();
    void useVoice.getState().start();
  }, [sttReady]);

  const stopTalking = useCallback(() => useVoice.getState().stop(), []);

  /** Press-and-hold with the mouse. The release is watched on `window` because the recording
   *  bar replaces the mic button while it is held. */
  const beginPointerHold = useCallback(() => {
    startTalking();
    const end = () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      useVoice.getState().stop();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }, [startTalking]);

  useEffect(() => {
    if (!open) return;
    void fetchHealth().then(setHealth);
    void useVoice.getState().loadConfig();
    void useContextGrant.getState().refresh();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Closing the panel ends everything audible or recording.
  useEffect(() => {
    if (open) return;
    useVoice.getState().cancel();
    useVoice.getState().stopSpeaking();
  }, [open]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, open]);

  // Spoken transcript → send it, or leave it in the box for review (each transcript is used once).
  const transcriptId = voice.transcript?.id;
  const handledTranscript = useRef(0);
  useEffect(() => {
    const transcript = useVoice.getState().transcript;
    if (!transcript || !open || transcript.id === handledTranscript.current) return;
    handledTranscript.current = transcript.id;
    if (useVoice.getState().prefs.autoSend) void useChat.getState().send(transcript.text);
    else {
      setDraft((current) => `${current}${current ? ' ' : ''}${transcript.text}`);
      inputRef.current?.focus();
    }
  }, [transcriptId, open]);

  // Read the finished answer aloud when "Speak replies" is on.
  useEffect(() => {
    const finished = previousStatus.current === 'streaming' && status === 'idle';
    previousStatus.current = status;
    if (!finished) return;
    const prefs = useVoice.getState().prefs;
    if (!prefs.speakReplies || prefs.muted) return;
    const last = useChat.getState().messages.at(-1);
    if (last && last.role === 'assistant' && last.content && !last.error)
      useVoice.getState().speak(last.content);
  }, [status]);

  // Push-to-talk key (hold) and safety: leaving the window never leaves the mic recording.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== PUSH_TO_TALK_KEY || event.repeat || holdingKey.current) return;
      event.preventDefault();
      holdingKey.current = true;
      startTalking();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== PUSH_TO_TALK_KEY) return;
      holdingKey.current = false;
      stopTalking();
    };
    const onBlur = () => {
      holdingKey.current = false;
      useVoice.getState().cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [open, startTalking, stopTalking]);

  if (!open) return null;

  const submit = () => {
    if (streaming || !draft.trim()) return;
    const text = draft;
    setDraft('');
    void send(text);
  };

  const micLabel = !voice.config
    ? 'Checking voice setup…'
    : sttReady
      ? `Hold to talk (or hold ${PUSH_TO_TALK_KEY})`
      : 'Voice input needs the offline speech engine — run npm install, then restart. You can type instead.';

  return (
    <div className="jarvis-scrim" onMouseDown={closeJarvis}>
      <section
        className={`jarvis ${voice.phase === 'recording' ? 'listening' : ''}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="JARVIS assistant"
      >
        <span className="hud-corner tl" />
        <span className="hud-corner tr" />
        <span className="hud-corner bl" />
        <span className="hud-corner br" />

        <header className="jarvis-head">
          <span className="jarvis-title">
            <JarvisOrb size={34} reactive /> JARVIS
          </span>
          <span className="jarvis-meta muted">
            {health ? (health.status === 'ok' ? 'online' : 'offline') : 'connecting…'}
          </span>
          <button
            type="button"
            className="btn ghost"
            onClick={clear}
            title="Start a new conversation (the old one stays saved)"
          >
            New chat
          </button>
          <button
            type="button"
            className="btn ghost icon-btn"
            onClick={closeJarvis}
            aria-label="Close JARVIS"
            title="Close (Esc)"
          >
            ✕
          </button>
        </header>

        <div className="jarvis-scroll" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="jarvis-empty">
              <JarvisOrb size={110} reactive />
              <p>Ask about your notes, memories and documents — or just talk.</p>
              <div className="suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="chip"
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              streaming={streaming && message.id === messages[messages.length - 1]?.id}
              onSpeak={(text) => useVoice.getState().speak(text)}
            />
          ))}
          {approvals.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} />
          ))}
          {error && status === 'error' && <div className="banner error">{error}</div>}
        </div>

        <div className="jarvis-toolbar">
          <button
            type="button"
            className={`toggle ${context.windows ? 'on' : ''}`}
            onClick={() => void context.setWindows(!context.windows)}
            aria-pressed={context.windows}
            title="Let JARVIS see which windows are open. Off by default; lasts only until you quit AI OS."
          >
            <ShieldIcon size={13} /> Window context: {context.windows ? 'ON (this session)' : 'off'}
          </button>
          <button
            type="button"
            className={`toggle ${voice.prefs.speakReplies && !voice.prefs.muted ? 'on' : ''}`}
            onClick={() => voice.setPref('speakReplies', !voice.prefs.speakReplies)}
            aria-pressed={voice.prefs.speakReplies}
            title="Read JARVIS's answers aloud"
          >
            <SpeakerIcon size={13} /> Speak replies
          </button>
          <button
            type="button"
            className={`toggle ${voice.prefs.muted ? 'warn' : ''}`}
            onClick={() => voice.setPref('muted', !voice.prefs.muted)}
            aria-pressed={voice.prefs.muted}
            title="Silence all spoken output"
          >
            {voice.prefs.muted ? 'Muted' : 'Mute'}
          </button>
          {voice.speaking && (
            <button type="button" className="toggle warn" onClick={() => voice.stopSpeaking()}>
              <StopIcon size={12} /> Stop speaking
            </button>
          )}
        </div>

        {voiceBusy ? (
          <div className={`voice-bar ${voice.phase}`} role="status" aria-live="polite">
            {voice.phase === 'requesting' && (
              <>
                <span className="spinner" />
                <span className="voice-text">Waiting for microphone permission…</span>
              </>
            )}
            {voice.phase === 'recording' && (
              <>
                <span className="rec-dot" />
                <span className="voice-text">
                  <strong>Microphone live</strong> · {formatDuration(voice.elapsedMs)}
                </span>
                <LevelMeter level={voice.level} />
                <button type="button" className="btn primary" onClick={stopTalking}>
                  Done — send
                </button>
              </>
            )}
            {voice.phase === 'transcribing' && (
              <>
                <span className="spinner" />
                <span className="voice-text">
                  Microphone off ·{' '}
                  {voice.config?.modelCached === false
                    ? `downloading speech model${voice.modelProgress?.percent != null ? ` ${voice.modelProgress.percent}%` : ''} (one time, then offline)…`
                    : 'transcribing on this device…'}
                </span>
              </>
            )}
            <button type="button" className="btn danger" onClick={() => voice.cancel()}>
              Cancel
            </button>
          </div>
        ) : (
          <footer className="jarvis-input-row">
            <textarea
              ref={inputRef}
              className="jarvis-input"
              rows={1}
              placeholder={streaming ? 'JARVIS is responding…' : 'Message JARVIS  ·  Alt+Space'}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <button
              type="button"
              className="btn mic"
              disabled={!sttReady}
              title={micLabel}
              aria-label={micLabel}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                beginPointerHold();
              }}
              onKeyDown={(event) => {
                // Keyboard use is a toggle: start here, finish with "Done — send" or F8.
                if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
                  event.preventDefault();
                  startTalking();
                }
              }}
            >
              <MicIcon size={18} />
            </button>
            {streaming ? (
              <button
                type="button"
                className="btn send stop"
                onClick={() => void cancel()}
                title="Stop generating"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="button"
                className="btn send"
                onClick={submit}
                disabled={!draft.trim()}
                title="Send"
              >
                <SendIcon />
              </button>
            )}
          </footer>
        )}

        {voice.error && (
          <div className="banner warn voice-error">
            {voice.error}{' '}
            <button type="button" className="link" onClick={() => voice.clearError()}>
              dismiss
            </button>
          </div>
        )}

        <div className="jarvis-status muted">
          <span className={`mic-state ${voice.phase === 'recording' ? 'live' : ''}`}>
            <MicIcon size={12} /> Mic:{' '}
            {voice.phase === 'recording' || voice.phase === 'requesting' ? 'ON' : 'off'}
          </span>
          {streaming ? (
            <span>
              <span className="spinner" /> streaming · request{' '}
              <span className="mono">{requestId}</span>
            </span>
          ) : (
            <span>
              local-first · Enter send · Shift+Enter newline · hold {PUSH_TO_TALK_KEY} to talk
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
