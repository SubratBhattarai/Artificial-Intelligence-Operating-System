# ADR 0008 — Computer control, agents, briefing, security center, document intelligence

## Decisions
- **Same pipeline for everything.** Every new capability is a typed tool going through planner → permission gate → approval → executor (timeout, idempotency, verification, audit). The model proposes; ordinary code authorizes. Approvals need a click, never a voice command.
- **New permissions, all off by default:** `apps`, `terminal`, `devices` (volume/brightness), `screen`, `web` ("Web access", read-only), `agents`, plus existing `system` (read). Unknown permission strings still fail closed. Permissions are not part of backups.
- **Terminal:** every command needs approval, runs through PowerShell with a time limit and output cap, and a blocklist refuses obviously destructive patterns. Volume/brightness use fixed scripts that only embed validated integers.
- **Apps:** open/close only apps on an allowlist (built-ins plus programs the user adds with the file picker); desktop-critical processes can never be closed.
- **Files:** create/move/edit/append go through `safeWrite` (allowed folders only, no overwrite without preview, rollback on failure). Documents the user drags in are readable one file at a time, for the current session only.
- **Web access** is separate from "Open in browser": https only, connection-time DNS check against private addresses, re-validated redirects, size/time caps, text only. Everything fetched is untrusted; only headline titles are taken from feeds.
- **Screen understanding:** a screenshot is taken only on request, read with offline OCR, never saved, with a visible SCREEN indicator.
- **Agents:** max 3 at once, 10 rounds, 10 minutes; they cannot start agents or monitors; all consequential tool calls surface as approval cards in the Agents app; reports are saved locally. They run only while AI OS is open (no start-with-Windows, no background service).
- **Daily briefing** is assembled by code from local data plus two public lookups (Open-Meteo, RSS) when Web access is on; the model never writes it. Sections whose permission is off say so. It is offered once per day at launch and on "Jarvis, briefing".
- **Smart notifications** are scored by explainable rules (`scoreImportance`), not by the model, so outside text cannot raise or lower importance. Urgent items toast; the rest wait in the bell.
- **Security Center** is read-only (processes, netstat, Defender/firewall status) and heuristic: disguised system names, system names outside the Windows folder, programs running from Temp/Downloads. It explains each finding and never closes or changes anything.
- **Ambient Mode** changes orb/desktop tint from simple rules (security alert > model offline > heavy CPU > agents > busy > calm). It can be turned off.
- **Interruptible conversation:** a new typed or spoken request cancels the current one and stops speech. Speaking over JARVIS (barge-in) is opt-in and needs sustained loud speech; headphones work best.
- **Document intelligence:** text from PDF, DOCX, XLSX, PPTX (zip + XML, no macros) and images (offline OCR, on request only). `compare_documents` reports shared and unique passages.

## Known limits
Not exercised on a real Windows machine yet: PowerShell volume/brightness, process listing, taskkill, netstat parsing against real output, desktop capture + OCR, Whisper offline load. Web search is best-effort scraping. Brightness works only on laptop panels. Barge-in can misfire on open speakers. Security heuristics produce suggestions, not verdicts. Agents stop when the app closes.
