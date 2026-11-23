# ADR 0004: Typed, read-only tool interface with an allowlisted filesystem view

**Status:** Accepted · 2026-11-20

## Context

Phase 2 requires one read-only tool so the model can ground answers in the real desktop
("which apps are open?", "what's in my Documents?"). Tools touch privileged surfaces (shell
state, disk), and the model decides their arguments — so the interface must be typed, minimal,
and impossible to misuse for mutation in the MVP.

## Decision

- **Typed contract** (`src/main/tools/types.ts`): a `Tool` declares `name` (strict
  `^[a-z][a-z0-9_]*$`), `description`, a JSON-Schema `parameters` block, and `execute()`.
  `ToolRegistry` converts tools to provider schemas, rejects duplicates/malformed names, and
  **never throws** on execution — failures become `{ok:false}` payloads the model can explain.
- **Read-only by construction.** MVP ships exactly two tools: `app_status` (reads a snapshot the
  renderer pushes over IPC) and `list_folder` (reads disk). No write/delete tools exist to be
  prompted into misuse.
- **Filesystem allowlist** (`src/main/fs/allowed.ts`): only configured roots (default Documents /
  Desktop / Downloads, extend via `AIOS_ALLOWED_FOLDERS`). Paths are resolved and rejected unless
  `path.relative(root, target)` stays inside the root — `..` traversal and absolute escapes fail.
  The Files app reuses the same gate for its UI.
- **Bounded rounds**: the chat loop executes at most `config.toolRounds` (4) tool rounds per user
  message, truncating tool output before it re-enters the model context.

## Consequences

- ✅ A model (or a poisoned prompt) can only _observe_: shell state and allowlisted folders.
- ✅ One allowlist implementation serves both the tool and the Files app — no drift.
- ⚠️ Listing large folders is capped (200 dir entries, 50 reported per result).
- ⚠️ Future write tools (e.g. "create a note") will need per-tool consent — out of MVP scope and
  will require a new ADR.
