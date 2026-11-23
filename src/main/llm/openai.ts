import type { ModelAdapter, StreamParams, StreamOutcome, LlmToolCall } from './adapter';
import { safeBody } from './adapter';

interface OpenAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Parse an SSE body, invoking `onData` for each `data:` payload. */
async function readSse(response: Response, onData: (payload: string) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n');
    buffer = frames.pop() ?? '';
    for (const raw of frames) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload.length > 0) onData(payload);
    }
  }
}

export function createOpenAiAdapter(cfg: OpenAiConfig): ModelAdapter {
  const adapter: ModelAdapter = {
    id: 'openai',
    model: cfg.model,
    configured: cfg.apiKey.length > 0 && cfg.baseUrl.length > 0,

    async ping() {
      if (!adapter.configured) return false;
      try {
        const response = await fetch(`${cfg.baseUrl}/models`, {
          headers: { authorization: `Bearer ${cfg.apiKey}` },
          signal: AbortSignal.timeout(4000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    async stream({ messages, tools, signal, onText }: StreamParams): Promise<StreamOutcome> {
      const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          stream: true,
          temperature: 0.4,
        }),
        signal,
      });

      if (!response.ok) {
        throw new Error(
          `OpenAI-compatible request failed (${response.status}): ${await safeBody(response)}`,
        );
      }

      const pending = new Map<number, PendingToolCall>();
      let finishReason = 'stop';

      await readSse(response, (payload) => {
        if (payload === '[DONE]') return;
        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          return;
        }
        const delta = parsed?.choices?.[0]?.delta;
        if (typeof delta?.content === 'string' && delta.content.length > 0) {
          onText(delta.content);
        }
        if (Array.isArray(delta?.tool_calls)) {
          for (const fragment of delta.tool_calls) {
            const index = typeof fragment.index === 'number' ? fragment.index : 0;
            const entry = pending.get(index) ?? { id: '', name: '', arguments: '' };
            if (fragment.id) entry.id = fragment.id;
            if (fragment.function?.name) entry.name += fragment.function.name;
            if (typeof fragment.function?.arguments === 'string') {
              entry.arguments += fragment.function.arguments;
            }
            pending.set(index, entry);
          }
        }
        if (typeof parsed?.choices?.[0]?.finish_reason === 'string') {
          finishReason = parsed.choices[0].finish_reason;
        }
      });

      const toolCalls: LlmToolCall[] = [...pending.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, entry], position) => ({
          id: entry.id || `call_${position + 1}`,
          name: entry.name,
          arguments: entry.arguments || '{}',
        }));

      return { finishReason, toolCalls };
    },
  };
  return adapter;
}
