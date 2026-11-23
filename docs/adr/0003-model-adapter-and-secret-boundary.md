# ADR 0003: Model adapters in the main process; secrets in `.env`; $0 default stack

**Status:** Accepted · 2026-11-20

## Context

JARVIS needs a model. Constraints:

- The product must be **$0** — no required paid API.
- Provider keys must not reach the renderer bundle or source control.
- Providers differ (local daemon vs HTTP APIs, NDJSON vs SSE), but the chat loop shouldn't care.
- Streaming, cancellation, and tool calls must survive across processes.

## Decision

- **Adapter seam** (`src/main/llm/adapter.ts`): a `ModelAdapter` streams text deltas via callback
  and returns tool calls + finish reason. Implementations: `ollama.ts` (NDJSON, default,
  free/local) and `openai.ts` (SSE, works with any OpenAI-compatible endpoint, paid _or_ free).
  Selected by `AIOS_PROVIDER`.
- **All model traffic happens in the main process.** The renderer sends sanitized
  user/assistant turns over IPC and receives typed events (`text`, `tool_call`, `tool_result`,
  `done`, `cancelled`, `error`).
- **Secrets** live only in `.env` (gitignored, template in `.env.example`) and are read once by
  `config.ts`. The preload bridge exposes at most `configured: boolean` + model name — never the
  key or `process.env`.
- **Cancellation** is an `AbortController` per request in main, triggered by an IPC cancel call;
  one in-flight turn at a time (a new turn aborts the previous one).

## Consequences

- ✅ Default install works offline with Ollama; swapping providers is config, not code.
- ✅ Renderer compromise cannot exfiltrate keys — they are simply not there.
- ⚠️ No streaming without a backend: opening the renderer in a plain browser shows a clear
  "backend bridge unavailable" error instead of silently failing.
- ⚠️ Tool-call grammar depends on each provider's native function-calling support; adapters must
  normalize argument fragments into JSON strings (both current adapters do).
