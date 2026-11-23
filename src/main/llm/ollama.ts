import type { ModelAdapter, StreamParams, StreamOutcome, LlmToolCall } from './adapter';
import { safeBody } from './adapter';

/** Ollama can answer slowly while loading or generating; a short timeout reads as a false outage. */
const PING_TIMEOUT_MS = 4000;

interface OllamaConfig {
  baseUrl: string;
  model: string;
}

/** Streaming NDJSON reader shared by the Ollama adapter. */
async function readNdjson(response: Response, onObject: (obj: any) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          onObject(JSON.parse(line));
        } catch {
          // Ignore partially malformed frames.
        }
      }
      newline = buffer.indexOf('\n');
    }
  }
}

export function createOllamaAdapter(cfg: OllamaConfig): ModelAdapter {
  return {
    id: 'ollama',
    model: cfg.model,
    configured: cfg.baseUrl.length > 0,

    async ping() {
      try {
        const response = await fetch(`${cfg.baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(PING_TIMEOUT_MS),
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    async warmUp() {
      try {
        await fetch(`${cfg.baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: cfg.model, prompt: '', keep_alive: '30m', stream: false }),
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        // Ollama not running yet: the first real question will load it.
      }
    },

    async stream({ messages, tools, signal, onText }: StreamParams): Promise<StreamOutcome> {
      const send = (think: boolean) =>
        fetch(`${cfg.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: cfg.model,
            messages,
            tools: tools.length > 0 ? tools : undefined,
            stream: true,
            // Reasoning models ("thinking") spend many seconds before the first word: switch that off.
            ...(think ? {} : { think: false }),
            // Keep the model loaded between questions, cap context and length: the main speed levers.
            keep_alive: '30m',
            options: { temperature: 0.4, num_ctx: 4096, num_predict: 400 },
          }),
          signal,
        });
      let response = await send(false);
      // Older Ollama versions do not know the `think` field: ask again without it.
      if (response.status === 400) response = await send(true);

      if (!response.ok) {
        throw new Error(`Ollama request failed (${response.status}): ${await safeBody(response)}`);
      }

      const toolCalls: LlmToolCall[] = [];
      let finishReason = 'stop';

      await readNdjson(response, (obj) => {
        const message = obj?.message;
        if (typeof message?.content === 'string' && message.content.length > 0) {
          onText(message.content);
        }
        if (Array.isArray(message?.tool_calls)) {
          for (const call of message.tool_calls) {
            const args = call?.function?.arguments;
            toolCalls.push({
              id: `call_${toolCalls.length + 1}`,
              name: call?.function?.name ?? '',
              arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
            });
          }
        }
        if (obj?.done) {
          finishReason = obj.done_reason ?? 'stop';
        }
      });

      return { finishReason, toolCalls };
    },
  };
}
