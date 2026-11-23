import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Conversation, ConversationMessage, ConversationSummary } from '../../shared/protocol';
import { JsonFile } from '../store/jsonFile';

const MAX_SESSIONS = 300;
const MAX_MESSAGES_PER_SESSION = 400;
const MAX_MESSAGE_LENGTH = 20_000;
const SESSION_ID_PATTERN = /^[\w-]{1,64}$/;

interface ConversationData {
  version: 1;
  conversations: Conversation[];
}

export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

function clip(text: string, length: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1).trimEnd()}…` : flat;
}

function firstSentence(text: string, length: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const match = flat.match(/^(.+?[.!?])(\s|$)/);
  return clip(match ? match[1] : flat, length);
}

/**
 * A cheap, deterministic summary (no model call): what the conversation started with and where
 * it ended. Good enough to find a conversation again; the full transcript is always kept.
 */
export function summarizeConversation(messages: ConversationMessage[]): string {
  const users = messages.filter((message) => message.role === 'user');
  const assistants = messages.filter((message) => message.role === 'assistant');
  if (users.length === 0) return '';
  const opening = `Asked: ${clip(users[0].content, 140)}`;
  if (users.length === 1 && assistants.length === 0) return opening;
  const lastUser = users[users.length - 1];
  const lastAssistant = assistants[assistants.length - 1];
  const parts = [opening];
  if (users.length > 1) parts.push(`Latest: ${clip(lastUser.content, 110)}`);
  if (lastAssistant) parts.push(`Answer: ${firstSentence(lastAssistant.content, 150)}`);
  return parts.join(' · ');
}

function toSummary(conversation: Conversation): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    summary: conversation.summary,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
  };
}

/** Conversations stored locally with session ids and per-message timestamps. */
export class ConversationStore {
  private readonly file: JsonFile<ConversationData>;

  constructor(dataDir: string) {
    this.file = new JsonFile<ConversationData>(
      path.join(dataDir, 'conversations.json'),
      () => ({ version: 1, conversations: [] }),
      (raw) => {
        const data = raw as Partial<ConversationData> | null;
        if (!data || !Array.isArray(data.conversations)) return null;
        return {
          version: 1,
          conversations: data.conversations.filter(
            (entry): entry is Conversation =>
              !!entry && typeof entry.id === 'string' && Array.isArray(entry.messages),
          ),
        };
      },
    );
  }

  private get conversations(): Conversation[] {
    return this.file.value.conversations;
  }

  list(): ConversationSummary[] {
    return [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(toSummary);
  }

  get(id: string): Conversation | null {
    const conversation = this.conversations.find((entry) => entry.id === id);
    return conversation
      ? { ...conversation, messages: conversation.messages.map((message) => ({ ...message })) }
      : null;
  }

  /** All conversations with full transcripts (for search and export). */
  all(): Conversation[] {
    return this.conversations;
  }

  /** Append one finished user/assistant exchange to a session, creating the session if needed. */
  recordTurn(
    sessionId: string,
    userText: string,
    assistantText: string,
    now = Date.now(),
  ): Conversation {
    if (!isValidSessionId(sessionId)) throw new Error('Invalid session id.');
    let conversation = this.conversations.find((entry) => entry.id === sessionId);
    if (!conversation) {
      if (this.conversations.length >= MAX_SESSIONS) this.dropOldest();
      conversation = {
        id: sessionId,
        title: '',
        summary: '',
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        messages: [],
      };
      this.conversations.push(conversation);
    }

    const push = (role: 'user' | 'assistant', content: string, at: number) => {
      const text = content.slice(0, MAX_MESSAGE_LENGTH);
      if (text.trim().length === 0) return;
      conversation!.messages.push({ id: randomUUID(), role, content: text, createdAt: at });
    };
    push('user', userText, now);
    push('assistant', assistantText, now + 1);

    if (conversation.messages.length > MAX_MESSAGES_PER_SESSION) {
      conversation.messages = conversation.messages.slice(-MAX_MESSAGES_PER_SESSION);
    }
    const firstUser = conversation.messages.find((message) => message.role === 'user');
    conversation.title = firstUser ? clip(firstUser.content, 60) : 'Conversation';
    conversation.summary = summarizeConversation(conversation.messages);
    conversation.updatedAt = now;
    conversation.messageCount = conversation.messages.length;
    this.file.touch();
    return conversation;
  }

  remove(id: string): boolean {
    const index = this.conversations.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    this.conversations.splice(index, 1);
    this.file.touch();
    return true;
  }

  clearAll(): number {
    const removed = this.conversations.length;
    this.file.value.conversations = [];
    this.file.touch();
    return removed;
  }

  countOlderThan(cutoff: number): number {
    return this.conversations.filter((entry) => entry.updatedAt < cutoff).length;
  }

  /** Delete conversations not touched since `cutoff` (epoch ms). Returns how many were removed. */
  pruneOlderThan(cutoff: number): number {
    const before = this.conversations.length;
    this.file.value.conversations = this.conversations.filter((entry) => entry.updatedAt >= cutoff);
    const removed = before - this.file.value.conversations.length;
    if (removed > 0) this.file.touch();
    return removed;
  }

  private dropOldest(): void {
    const oldest = [...this.conversations].sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (oldest) this.remove(oldest.id);
  }

  flush(): void {
    this.file.flushSync();
  }
}
