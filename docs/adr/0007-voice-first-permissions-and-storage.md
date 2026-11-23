# ADR 0007 — Voice-first shell, permissions, storage controls

## Decisions
- **Voice by default.** An offline Whisper listener runs in the renderer; speech segments are detected locally (energy VAD), transcribed, and only text beginning with "Jarvis" is acted on. Everything else is discarded unsaved. Typing remains available.
- **The model is never the authorization system.** Permissions (`microphone, camera, calendar, tasks, notes, mail, files, memory, calculator, system`; off/read/write) live in `PermissionStore`, default off, and are enforced in the planner, re-checked in the executor after approval, and in Electron's media permission handler. Unknown permission strings fail closed.
- **Permissions are excluded from backups** so a restored file can never switch on the microphone or camera.
- **Untrusted content** (files, calendar text, memory search results, mail) is flagged; results carry a policy note that embedded instructions are data.
- **Action lifecycle** recorded in the audit log: proposed → awaiting approval → executing → succeeded / failed / cancelled, with redacted inputs, approval, result and timestamp. Retried changes are deduplicated by idempotency key. Only verified results are reported as success; partial batches say what did and did not complete.
- **Mail is local.** The Mail app is a private mailbox inside AI OS; no IMAP/OAuth, nothing leaves the app.
- **Storage.** Report, selectable cleanup, free-memory, backup/restore (two-step, safety copy), and delete-all (typed confirmation).
- **Approvals require a click**, never a voice command.

## Known limits
Windows system voices only (Piper later); no screen capture exists; wake-word accuracy depends on Whisper transcripts and runs Whisper on each detected speech segment while listening.
