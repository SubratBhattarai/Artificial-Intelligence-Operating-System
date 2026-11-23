# ADR 0010: Mission Control, Engineering Lab and environmental awareness

Status: accepted

## Context
The user wants JARVIS to carry out whole objectives, build software, and understand its surroundings, while staying local, free and permission-gated. The LLM must never be the authorization system.

## Decisions
**Mission Control.** A mission is `planning → awaiting_approval → running ⇄ paused → succeeded | failed | cancelled`. The model only proposes a plan; `parsePlan` treats its output as untrusted (titles and details only, capped). One approval starts the plan, but every step runs as an ordinary agent, so the tool pipeline, permissions and per-action approvals are unchanged. Steps run sequentially; a failed step fails the mission; pause takes effect between steps; stop cancels the running agent. Missions persist in `missions.json`; after a restart running missions become cancelled because agents do not survive a restart.

**Engineering Lab.** Local only, by choice: no accounts, tokens or deployment. Projects live under `Documents/AI OS Projects` and every path is checked against the allowed roots. The model never supplies command text: `lab_run` takes an enum of fixed commands (`LAB_COMMANDS`) and is high risk, approved every time, 5-minute limit, output capped and flagged untrusted. Previews are a read-only static server bound to `127.0.0.1` on a random port, with traversal and symlink checks. Opening the preview in a browser is a user click limited to that loopback URL.

**Environmental awareness.** Four separate signals, each its own switch and off by default: `activity` (foreground app and title, untrusted), `system` (battery, network, load, time), `clipboard` (new; on request only, approved each read, never watched), `camera` (existing switch). Camera description: main asks the visible renderer for one frame through the same camera store, so the CAMERA indicator shows and the camera is released straight after; the frame goes only to a local Ollama vision model (`AIOS_VISION_MODEL`, default `moondream`) and is never saved. No model is downloaded automatically; a missing model produces an `ollama pull` instruction. New tool permission strings map to permissions in `requirementFor`; unknown strings still fail closed.

## Consequences
Plans can be wrong, so the approval and per-step gates matter more than plan quality. The Lab cannot publish anything online. Awareness quality depends on the local vision model. None of this has been run on real hardware yet.
