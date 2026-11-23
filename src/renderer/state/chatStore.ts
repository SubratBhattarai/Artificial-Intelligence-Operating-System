import { create } from 'zustand';
import { BRIEFING_COMMAND, briefingToText, useBriefing } from './briefingStore';
import { parseFocusCommand } from '../lib/focusCommand';
import { useFocus } from './focusStore';
import { useVoice } from './voiceStore';
import type {
  ApprovalInfo,
  ToolStatus,
  ChatMessage,
  Conversation,
  JarvisEvent,
  OutgoingChatMessage,
} from '../../shared/protocol';

export interface ToolActivity {
  name: string;
  status: 'running' | 'ok' | 'error';
  preview?: string;
  /** Final pipeline status; only completed/verified mean it really happened. */
  outcome?: ToolStatus;
  detail?: string;
}

export interface UiChatMessage extends ChatMessage {
  tools?: ToolActivity[];
}

export type ChatStatus = 'idle' | 'streaming' | 'error';

const HISTORY_KEY = 'aios.chat.v1';
const SESSION_KEY = 'aios.chat.session.v1';
const MAX_STORED_MESSAGES = 40;
const SESSION_ID_PATTERN = /^[\w-]{1,64}$/;

function newSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function persistSessionId(id: string): void {
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch {
    // Best-effort.
  }
}

function loadSessionId(): string {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored && SESSION_ID_PATTERN.test(stored)) return stored;
  } catch {
    // Fall through to a fresh id.
  }
  const id = newSessionId();
  persistSessionId(id);
  return id;
}

function uid(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadHistory(): UiChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry) => entry && typeof entry.content === 'string' && typeof entry.role === 'string',
      )
      .slice(-MAX_STORED_MESSAGES);
  } catch {
    return [];
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(messages: UiChatMessage[]): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
    } catch {
      // History persistence is best-effort.
    }
  }, 300);
}

interface ChatStoreState {
  messages: UiChatMessage[];
  sessionId: string;
  status: ChatStatus;
  error: string | null;
  requestId: string | null;
  streamTargetId: string | null;
  /** Changing actions waiting for the user's decision. */
  approvals: ApprovalInfo[];
  decide: (approvalId: string, approve: boolean) => Promise<void>;
  send: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
  clear: () => void;
  resume: (conversation: Conversation) => void;
}

function handleEvent(event: JarvisEvent): void {
  const store = useChat.getState();
  if (event.requestId !== store.requestId) return;

  const patchMessage = (id: string, patch: (message: UiChatMessage) => UiChatMessage) =>
    useChat.setState((state) => ({
      messages: state.messages.map((message) => (message.id === id ? patch(message) : message)),
    }));

  switch (event.type) {
    case 'start':
      return;

    case 'text': {
      const target = store.streamTargetId;
      if (!target) return;
      patchMessage(target, (message) => ({ ...message, content: message.content + event.text }));
      return;
    }

    case 'tool_call': {
      const target = store.streamTargetId;
      if (!target) return;
      patchMessage(target, (message) => ({
        ...message,
        tools: [...(message.tools ?? []), { name: event.call.name, status: 'running' as const }],
      }));
      return;
    }

    case 'tool_result': {
      const target = store.streamTargetId;
      if (!target) return;
      patchMessage(target, (message) => {
        const tools = [...(message.tools ?? [])];
        const slot = tools.findIndex(
          (activity) => activity.status === 'running' && activity.name === event.call.name,
        );
        if (slot >= 0) {
          tools[slot] = {
            ...tools[slot],
            status: event.ok ? 'ok' : 'error',
            preview: event.preview,
            outcome: event.status,
            detail: event.detail,
          };
        }
        return { ...message, tools };
      });
      return;
    }

    case 'approval_request': {
      useChat.setState((state) => ({
        approvals: [
          ...state.approvals.filter((entry) => entry.id !== event.approval.id),
          event.approval,
        ],
      }));
      return;
    }

    case 'approval_resolved': {
      useChat.setState((state) => ({
        approvals: state.approvals.filter((entry) => entry.id !== event.approvalId),
      }));
      return;
    }

    case 'done': {
      const target = store.streamTargetId;
      useChat.setState((state) => {
        const messages = state.messages.map((message) =>
          message.id === target && message.content.length === 0
            ? { ...message, content: '(no content in response)' }
            : message,
        );
        schedulePersist(messages);
        return {
          messages,
          status: 'idle',
          error: null,
          requestId: null,
          streamTargetId: null,
          approvals: [],
        };
      });
      return;
    }

    case 'cancelled': {
      const target = store.streamTargetId;
      useChat.setState((state) => {
        const messages = state.messages.map((message) =>
          message.id === target
            ? { ...message, content: message.content + (message.content ? ' ⏹' : '(stopped)') }
            : message,
        );
        schedulePersist(messages);
        return { messages, status: 'idle', requestId: null, streamTargetId: null, approvals: [] };
      });
      return;
    }

    case 'error': {
      const target = store.streamTargetId;
      useChat.setState((state) => ({
        messages: state.messages.map((message) =>
          message.id === target
            ? { ...message, error: true, content: message.content || event.message }
            : message,
        ),
        status: 'error',
        error: event.message,
        requestId: null,
        streamTargetId: null,
      }));
      return;
    }
  }
}

let eventsBound = false;
function bindEvents(): void {
  if (eventsBound) return;
  eventsBound = true;
  window.aios?.chat.onEvent(handleEvent);
}

export const useChat = create<ChatStoreState>((set, get) => ({
  messages: loadHistory(),
  sessionId: loadSessionId(),
  status: 'idle',
  error: null,
  requestId: null,
  streamTargetId: null,
  approvals: [],

  async decide(approvalId, approve) {
    try {
      await window.aios?.tools.decide(approvalId, approve);
    } catch {
      // The approval may already have expired; the resolved event updates the card.
    }
    set((state) => ({ approvals: state.approvals.filter((entry) => entry.id !== approvalId) }));
  },

  async send(text: string) {
    const content = text.trim();
    if (!content) return;
    // Interruptible: a new request cancels the one in progress and stops any speech.
    if (get().status === 'streaming') {
      useVoice.getState().stopSpeaking();
      await get().cancel();
      for (let wait = 0; wait < 40 && get().status === 'streaming'; wait += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (get().status === 'streaming') return;
    } else useVoice.getState().stopSpeaking();
    bindEvents();

    // "Jarvis, focus for 25 minutes" starts a quiet timer; handled by code, not the model.
    const focus = parseFocusCommand(content);
    if (focus) {
      const asked: UiChatMessage = { id: uid(), role: 'user', content, createdAt: Date.now() };
      if (focus.kind === 'start') useFocus.getState().start(focus.minutes);
      else useFocus.getState().stop();
      const answer: UiChatMessage = {
        id: uid(),
        role: 'assistant',
        content:
          focus.kind === 'start'
            ? `Focus mode is on for ${focus.minutes} minutes.`
            : 'Focus mode is off.',
        createdAt: Date.now(),
      };
      set((state) => ({ messages: [...state.messages, asked, answer] }));
      schedulePersist(get().messages);
      return;
    }

    // "Jarvis, briefing" is answered by ordinary code from local data, not by the language model.
    if (BRIEFING_COMMAND.test(content)) {
      const asked: UiChatMessage = { id: uid(), role: 'user', content, createdAt: Date.now() };
      set({ status: 'streaming', error: null });
      const briefing = await useBriefing.getState().load();
      const answer: UiChatMessage = {
        id: uid(),
        role: 'assistant',
        content: briefing
          ? briefingToText(briefing)
          : 'I could not put the briefing together just now.',
        createdAt: Date.now(),
        error: !briefing,
      };
      set((state) => ({ messages: [...state.messages, asked, answer], status: 'idle' }));
      schedulePersist(get().messages);
      if (briefing) useVoice.getState().speak(answer.content);
      return;
    }

    const api = window.aios;
    const userMessage: UiChatMessage = { id: uid(), role: 'user', content, createdAt: Date.now() };
    const assistantId = uid();
    const assistantMessage: UiChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };

    const history = [...get().messages, userMessage];
    const outgoing: OutgoingChatMessage[] = history
      .filter(
        (message): message is UiChatMessage & { role: 'user' | 'assistant' } =>
          !message.error && (message.role === 'user' || message.role === 'assistant'),
      )
      .slice(-40)
      .map((message) => ({ role: message.role, content: message.content }));

    const requestId = uid();
    set({
      messages: [...history, assistantMessage],
      status: 'streaming',
      error: null,
      requestId,
      streamTargetId: assistantId,
    });
    schedulePersist([...history, assistantMessage]);

    if (!api) {
      set({
        status: 'error',
        error:
          'Backend bridge unavailable — run the app through Electron (npm run dev), not a plain browser.',
        requestId: null,
        streamTargetId: null,
      });
      return;
    }

    try {
      await api.chat.start({ requestId, sessionId: get().sessionId, messages: outgoing });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        requestId: null,
        streamTargetId: null,
      });
    }
  },

  async cancel() {
    const { requestId } = get();
    if (!requestId) return;
    try {
      await window.aios?.chat.cancel(requestId);
    } catch {
      // Ignore cancel races; the 'cancelled' event finalizes state.
    }
  },

  clear() {
    const sessionId = newSessionId();
    persistSessionId(sessionId);
    set({
      messages: [],
      sessionId,
      status: 'idle',
      error: null,
      requestId: null,
      streamTargetId: null,
    });
    schedulePersist([]);
  },

  resume(conversation: Conversation) {
    if (get().status === 'streaming') return;
    const sessionId = SESSION_ID_PATTERN.test(conversation.id) ? conversation.id : newSessionId();
    persistSessionId(sessionId);
    const messages: UiChatMessage[] = conversation.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    }));
    set({
      messages,
      sessionId,
      status: 'idle',
      error: null,
      requestId: null,
      streamTargetId: null,
    });
    schedulePersist(messages);
  },
}));

// Pre-bind in the Electron renderer so early events are never dropped.
if (typeof window !== 'undefined' && window.aios) {
  bindEvents();
}
