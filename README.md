# AI OS

A desktop-shell "operating system" experience for **Windows**, built on Electron + React + TypeScript, with **JARVIS** — a built-in AI assistant overlay — wired to a **local, $0 model stack** by default.

> **$0 by design.** The default provider is a local [Ollama](https://ollama.com) server. No paid
> API key is required anywhere. An OpenAI-_compatible_ endpoint is optional and also works with
> free/local servers (LM Studio, llama.cpp, a key you already have).

## What's inside

**Shell (Phase 1)**

- Wallpaper, top bar (status pill + clock), dock, desktop icons, global app launcher
- Windows: open, close, focus order, drag, 8-way resize, minimize, maximize, restore
- Keyboard navigation and shortcuts (see below)
- Window positions persist locally and are **validated on load** (malformed/off-screen/unknown-app
  entries are repaired or dropped — storage is treated as untrusted)
- A reusable **window contract** (`ShellApp`) so any built-in app plugs into the shell with one
  registry entry: `src/renderer/apps/registry.ts`

**JARVIS (Phase 2)**

- Summonable overlay (**Alt+Space**), conversation history (persisted locally), streaming output,
  cancellation (Stop button), and explicit error states
- Backend **model adapter** interface with two implementations: Ollama (default) and any
  OpenAI-compatible endpoint — all network calls happen in the Electron **main process**
- Provider keys live only in `.env` (gitignored) and are read only by the main process; they never
  enter the renderer bundle or source control
- A **typed tool interface** with read-only tools: `app_status` (open windows/focus) and
  `list_folder` (allowlisted folders only)

**Built-in apps:** Status (live health), Files (read-only browser), Notes (local scratchpad),
Settings (shortcuts, provider info, local data controls).

**Memory, files and voice (Phases 3-5)**

- Memory app: local conversations (session IDs, timestamps), explicit memory records you add or approve, keyword search, export and per-source delete.
- Files app: Finder-style browser, folder indexing (text, code, PDF, DOCX), search with snippets, cited document Q&A, safe read-only preview.
- Voice: push-to-talk (hold the mic button or F8) with a visible MIC LIVE indicator; speech-to-text runs offline on your machine with Whisper (no API; ~40 MB model downloads once on first use); spoken replies via the system voice. The orb animates with your voice level while listening and with the words while speaking.
- Not included: wake word, screen capture. Run `npm install` once to pick up `pdf-parse`, `mammoth` and the Whisper engine.
- See `docs/adr/0005-memory-file-index-and-voice.md`.

## Quick start

Prerequisites: **Node.js 20+** and npm. For the AI features, a free local
[Ollama](https://ollama.com) install (`ollama pull llama3.2` or any chat model you like).

```bash
npm install
npm run dev
```

That's it — `npm run dev` starts the Vite dev server, esbuild for main/preload, and launches
Electron, relaunching automatically when main/preload code changes (renderer uses HMR).

### Configure the model (optional, defaults work)

```bash
cp .env.example .env
# edit .env — provider, model, folders, summon shortcut
```

| Variable                                              | Default                        | Purpose                                                     |
| ----------------------------------------------------- | ------------------------------ | ----------------------------------------------------------- |
| `AIOS_PROVIDER`                                       | `ollama`                       | `ollama` (free/local) or `openai` (any compatible endpoint) |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL`                    | `127.0.0.1:11434` / `llama3.2` | Local Ollama target                                         |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` | —                              | Optional remote/local compatible endpoint                   |
| `AIOS_ALLOWED_FOLDERS`                                | Documents; Desktop; Downloads  | Folders readable by Files app + `list_folder`               |
| `AIOS_SUMMON_SHORTCUT`                                | `Alt+Space`                    | Global JARVIS summon accelerator                            |

## Scripts

| Command                                   | What it does                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`                             | Dev mode: Vite + esbuild watch + Electron with auto-relaunch                         |
| `npm run build`                           | Type-check, then build main/preload (esbuild) + renderer (Vite) → `dist/`            |
| `npm start`                               | Run the production build (`npm run build` first)                                     |
| `npm run typecheck`                       | `tsc --noEmit` over the whole project                                                |
| `npm run lint` / `npm run lint:fix`       | ESLint (flat config, typescript-eslint)                                              |
| `npm run format` / `npm run format:check` | Prettier                                                                             |
| `npm test`                                | Vitest unit tests (layout persistence rules, tool registry, chat input sanitization) |

### Self-check (smoke test)

```bash
npm run build
AIOS_SMOKE=1 npx electron .          # boots, verifies the rendered DOM, prints a report, quits
AIOS_SMOKE=1 AIOS_SMOKE_CHAT=1 npx electron .   # additionally runs one real assistant turn with tool use
```

On Windows PowerShell use `$env:AIOS_SMOKE=1; npx electron .` instead.

## Keyboard shortcuts

| Keys                   | Action                                                              |
| ---------------------- | ------------------------------------------------------------------- |
| `Alt + Space`          | Summon / dismiss JARVIS (global — works when the app isn't focused) |
| `Ctrl + Space`         | Open / close the app launcher (search, ↑↓, Enter)                   |
| `Ctrl + Shift + ← / →` | Cycle window focus                                                  |
| `Ctrl + Shift + ↑`     | Maximize / restore focused window                                   |
| `Ctrl + Shift + M`     | Minimize focused window                                             |
| `Ctrl + Shift + W`     | Close focused window                                                |
| `Ctrl + Shift + J`     | Toggle JARVIS                                                       |
| `Escape`               | Close launcher / JARVIS                                             |

Desktop icons and dock items are plain buttons — fully keyboard reachable (Tab / Enter).

## Architecture

```
┌────────────────────────────── Electron ──────────────────────────────┐
│  Main process (Node)                                                 │
│   ├─ config.ts        reads .env — provider keys never leave here    │
│   ├─ llm/             ModelAdapter: ollama.ts | openai.ts + chat loop│
│   ├─ tools/           typed Tool interface + registry (read-only)    │
│   ├─ fs/allowed.ts    folder allowlist shared by Files app + tool    │
│   └─ ipc/             system:health, fs:list, chat:start/cancel      │
│                       ▲ shell:state (renderer pushes snapshot)       │
│  Preload (contextBridge) ── narrow `window.aios` API, no env/fs-write│
│                                                                       │
│  Renderer (React, sandboxed)                                         │
│   ├─ state/           windowStore (focus/z-order/persist), chatStore │
│   ├─ components/      TopBar, Dock, DesktopIcons, Launcher,          │
│   │                   WindowFrame, WindowLayer, Jarvis               │
│   ├─ apps/            ShellApp contract + registry + built-in apps   │
│   └─ lib/             pure layout/sanitization math (unit-tested)    │
└───────────────────────────────────────────────────────────────────────┘
```

Key decisions are logged in [`docs/adr/`](docs/adr/README.md).

## Security & privacy notes

- Renderer runs with `contextIsolation`, no `nodeIntegration`; the preload exposes a minimal API.
- Renderer input is untrusted: chat history is sanitized (roles/length caps) in the main process
  before it reaches a model; window layouts are validated before touching the window manager.
- File access is **read-only** and restricted to allowlisted roots; `..` traversal is rejected.
- `.env` is gitignored; use `.env.example` as the template.

## Non-goals (MVP)

- No installer/packaging/signing yet (run from source; electron-builder is a later step)
- No third-party/third-party-store distribution, no auto-update
- No write/delete operations for tools or the Files app
- No multi-monitor virtual desktops, tiling, or per-app permissions UI
- No telemetry of any kind

## Troubleshooting

- **App exits with `Cannot read properties of undefined (reading 'whenReady')`** — your shell has
  `ELECTRON_RUN_AS_NODE=1` set (common in VS Code terminals/agent shells). Unset it, or use
  `npm run dev`, which strips it automatically.
- **Top bar shows "model offline"** — Ollama isn't running (`ollama serve`) or the model name in
  `.env` doesn't match (`ollama list`). The shell works fine without it; only JARVIS is degraded.
- **Alt+Space does nothing globally** — the shortcut was taken by another app; set
  `AIOS_SUMMON_SHORTCUT` (e.g. `Alt+J`) and restart. The in-app binding still works either way.


## Tool pipeline and apps (Phase 6–7)

JARVIS proposes tool calls; code validates, previews, asks you, executes, verifies by reading the result
back, and reports the real status. Changing actions (create/complete task, add calendar event, add note)
always show an Approve/Deny card first. Every call is logged in the **Activity** app, where you can also
switch individual tools off. Apps: **Tasks**, **Calendar** (.ics import/export), **Finance** (manual +
CSV; never moves money or trades; JARVIS cannot write to it), **Monitor**, **Activity**. All work without
the AI. Google/Microsoft OAuth integrations are not built yet. See `docs/adr/0006-tool-pipeline-and-local-apps.md`.

## Voice, permissions and storage (v7)
- Say "Jarvis, …" after enabling the microphone in **Settings › Permissions** (everything is off by default). Typing always works.
- Settings tabs: Permissions, Voice, Display (dark/light, interface size), Data & storage (cleanup, free memory, backup/restore, delete all), General.
- New apps: Mail (local only), Calculator, Camera (off until allowed).
- See `docs/adr/0007-voice-first-permissions-and-storage.md`.

## Computer control, agents and intelligence (v8)
All of this is off until you allow it in **Settings › Permissions**, and anything that changes something asks for a click first.

- **Computer control:** open/close approved apps, run terminal commands (each one approved), set volume and brightness, create/move/edit files in allowed folders, read the screen on request (offline text recognition), and read public web pages with the separate **Web access** permission.
- **Agents:** the **Agents** app shows up to three agents working at once (research a topic, complete a task), website monitors, and saved reports. They run only while AI OS is open.
- **Notifications:** the bell filters by importance (urgent / important / FYI) using fixed rules.
- **Daily briefing:** schedule, important mail, weather, news, deadlines, reminders and open tasks. Appears once a day at launch (switch off in the Briefing app) and any time you say "Jarvis, briefing". Set your city there; weather/news need Web access.
- **Documents:** drag PDFs, Word, Excel, PowerPoint, text or images into **Documents** to summarize, extract, ask questions or compare.
- **Second Brain:** one search across notes, memory, conversations and indexed documents, plus quick idea capture.
- **Security Center:** read-only view of running programs, network connections and Windows protection (needs "System info").
- **Ambient mode:** orb and desktop glow follow system state (Settings › Display).
- **Interrupting:** typing or sending a new request stops the current answer; optionally speak over JARVIS (tick "Let me interrupt by speaking", headphones best).

After pulling these changes run `npm install` (adds `jszip` and `tesseract.js`), then `npm run dev`. One-time downloads: speech model (~250 MB) and English text recognition (~15 MB); both are used offline afterwards.

## Natural voice, scenes and focus (v9)
- **Qwen3-TTS voice (optional):** Settings › Voice › *Natural voice*. Press **Set up** once (needs Python 3.10–3.12; about 3 GB of libraries, then the model downloads on first start), choose a 5–10 second reference clip (WAV, MP3, FLAC, OGG or M4A) of a voice you have the right to use, and keep "Fast" on a CPU-only computer. It runs only on this computer. If it is not ready or too slow, the Windows voice speaks, so you are never left waiting. The panel shows how fast it runs on your machine.
- **Focus mode:** "Jarvis, focus for 25 minutes" (or the Focus & Scenes app). Quiet notifications, spoken halfway and finish. "Stop focus" ends it.
- **Scenes:** save a setup such as *Study mode* (open apps, set volume/brightness) and say "Jarvis, study mode". Each step still asks for your approval.
- **Faster answers:** the assistant now sees only the tools relevant to each request, stays loaded in memory and starts warm at launch. A smaller local model (for example `llama3.2:1b` via `OLLAMA_MODEL`) is faster still.

## Mission Control, Engineering Lab and awareness (v10)
Everything is local. New permissions are off by default; anything consequential still asks for a click.

- **Mission Control** (Agents › Missions): type an objective. JARVIS writes a visible plan (2–8 steps); nothing runs until you approve it. Agents then do the steps in order, each one under your normal permissions and approvals. Pause after the current step, or stop at any time. A finished mission saves a report. A step failure stops the mission. If AI OS closes, a running mission is marked stopped.
- **Engineering Lab** (Lab app): projects live in `Documents/AI OS Projects`. Templates: static site, Node script, Python script. JARVIS writes code with the file tools; the Lab runs only a fixed list of commands (npm install/test/build, node, python, pytest), each approved, 5-minute limit. Static sites get a live preview on `127.0.0.1` only. No accounts, tokens or online deploy.
- **Environmental awareness** (Settings › Permissions, each its own switch): *Active app & window*, *System info* (battery, network, load, time of day), *Clipboard* (read on request, approved each time), and *Camera* (describe my surroundings: one photo, described by a local vision model, never saved). For camera descriptions run `ollama pull moondream` once (about 1 GB), or set `AIOS_VISION_MODEL`.

See `docs/adr/0010-mission-control-lab-awareness.md`.

## Aura design system and camera scanning (v11)
- **New look:** a whitesmoke light theme (default) with charcoal and soft silver, and a deep-charcoal dark theme (Settings › Display). One stylesheet, `src/renderer/aura.css`, holds the tokens (colour, depth, radius, motion) and restyles every app, dialog, notification and the assistant panel so the whole system reads as one product.
- **Home:** a calm glass orb with five states (idle, listening, thinking, speaking, working), a quiet clock and one line saying what JARVIS is doing. A floating dock with smooth magnification, a slim menu bar with status and clock, spring-eased window opening, genie minimize and restore, and shimmer skeletons while content loads.
- **Camera scanning:** open **Camera**, press **Scan**, optionally say what to look for. It keeps the sharpest of three frames, uses the best installed local vision model (qwen2.5vl, llava-phi3, moondream, ...), and also reads printed words offline. "Jarvis, scan what I'm holding" does the same. For good results run `ollama pull qwen2.5vl:3b` once (about 3 GB); `moondream` is smaller but rougher. "Open the camera" now opens AI OS's own Camera app.
- **Voice:** the natural voice can wait for a slow computer instead of switching to the Windows voice (Settings › Voice).
