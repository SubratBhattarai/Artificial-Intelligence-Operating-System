# 5. Memory, file index and voice

Status: accepted

## Context

JARVIS needs durable memory, document search/Q&A over user-chosen folders, and voice input/output, without weakening the read-only tool boundary from ADR 0004.

## Decisions

- **Storage:** JSON files in the app data folder (atomic tmp+rename writes, corrupt-file quarantine, flush on quit). No database dependency.
- **Retrieval:** in-memory BM25 keyword search. Embeddings are deferred until keyword search measurably fails.
- **Memory records:** fact, source, created date, confidence, optional expiry, status. Memories are added by the user or approved by the user. The `propose_memory` tool only stages a pending suggestion, which is inert until approved. Per-source deletion, edit, export and delete-all are available in the Memory app.
- **File index:** only folders the user selects in a native dialog. Metadata for all files; text for text/code/Markdown/PDF/DOCX. Duplicates grouped by SHA-1, changes detected by size+mtime, unreadable files reported with a reason. Source files are never modified; Open is blocked for executable types.
- **Document Q&A:** top-k chunks sent as numbered excerpts, answers cite `[n]`, unreadable files are listed, and no model call is made when nothing matches. File contents are treated as untrusted data.
- **Voice:** push-to-talk only. Recording and 16 kHz decoding happen in the renderer; transcription runs offline in a main-process worker thread using Whisper (`@huggingface/transformers`, default `Xenova/whisper-tiny.en`, quantised). No API or key. The model downloads once on first use into the app data folder, and the worker is unloaded after 90 s idle to free memory. Visible MIC LIVE indicator, stop/cancel controls, text fallback, and TTS via `speechSynthesis` with mute/stop.
- **Context access:** opt-in, session-scoped, off at every launch. It exposes app names and window titles only. No screen capture exists.

## Deferred: wake word

Not built. Before adding it: measure false activations on real ambient audio, run detection fully on-device, show a persistent listening indicator, provide a one-click disable, never persist or upload audio before activation, and keep it off by default.
