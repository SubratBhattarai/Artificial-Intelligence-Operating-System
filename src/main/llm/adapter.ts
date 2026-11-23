import type { ProviderId } from '../../shared/protocol';
import type { ToolSchema } from '../tools/types';
import { config } from '../config';
import { createOllamaAdapter } from './ollama';
import { createOpenAiAdapter } from './openai';

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LlmMessage {
  role: LlmRole;
  content: string | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
}

export interface StreamParams {
  messages: LlmMessage[];
  tools: ToolSchema[];
  signal: AbortSignal;
  onText: (delta: string) => void;
}

export interface StreamOutcome {
  finishReason: string;
  toolCalls: LlmToolCall[];
}

/**
 * The single seam between JARVIS and a model provider. Every adapter streams text deltas,
 * then reports any tool calls the model wants to make; the chat loop owns tool execution.
 *
 * The product targets a $0 budget: the default adapter talks to a local Ollama server.
 * The OpenAI-compatible adapter is opt-in and also works against free/local endpoints
 * (LM Studio, llama.cpp server, etc.) — no paid service is required anywhere.
 */
export interface ModelAdapter {
  readonly id: ProviderId;
  readonly model: string;
  /** True when the adapter can be used with current environment configuration (e.g. key present). */
  readonly configured: boolean;
  ping(): Promise<boolean>;
  stream(params: StreamParams): Promise<StreamOutcome>;
  /** Optional: load the model into memory now so the first answer is not slow. */
  warmUp?(): Promise<void>;
}

export function createAdapter(): ModelAdapter {
  return config.provider === 'openai'
    ? createOpenAiAdapter(config.openai)
    : createOllamaAdapter(config.ollama);
}

/** Read an error body without letting it throw. */
export async function safeBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '<unreadable body>';
  }
}
