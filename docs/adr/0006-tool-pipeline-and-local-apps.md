# ADR 0006: Tool pipeline and local apps (Phase 6 and 7)

## Status
Accepted.

## Tool pipeline
The model only *proposes* tool calls. Everything after that is deterministic code:

1. **Registry** – each tool declares name, description, JSON schema, permissions, risk tier
   (`read` / `low`; `medium` / `high` are reserved), timeout and optional preview, verify and rollback hooks.
   A tool above `read` cannot be registered without `preview` and `verify`.
2. **Planner** (`planner.ts`) – pure validation: unknown or user-disabled tool, unparseable arguments,
   schema violations, more than 3 changing calls or a duplicate change in one turn, or more than 6 calls
   are rejected before anything runs.
3. **Approval** (`approvals.ts`) – every changing call shows a preview card; only a click in the app
   (`tools:decide`) approves. Requests expire after 5 minutes, and cancelling the turn denies them.
4. **Execution** (`executor.ts`) – runs under a hard timeout and an abort signal.
5. **Verification** – the tool reads the real state back. Only `completed` (read) and `verified`
   (change confirmed) are success. A change that fails verification is rolled back (`rolled_back`) or,
   when it cannot be undone, reported as `not_verified`.
6. **Reporting** – the model receives `{status, result, note}` plus a `batch` summary naming how many
   actions really succeeded, and the system prompt forbids claiming success otherwise.
7. **Audit** – every call (including rejected and denied ones) is stored in `audit.json` with its
   stages, approval, outcome and duration; viewable and clearable in the Activity app.

Tools: read-only `app_status`, `list_folder`, `search_memory`, `search_files`, `read_document`,
`list_tasks`, `list_events`, `system_metrics`; `propose_memory` (stages a suggestion only);
reversible changes `create_task`, `complete_task`, `create_event`, `create_note`.
There is intentionally no finance tool: JARVIS cannot add entries or move money.

## Local apps
Tasks, Calendar, Finance, Monitor and Activity are independent windows over local JSON stores with
shared contracts in `src/shared/apps.ts`; each works with no model running. Notes and Memory already
cover Notes/Knowledge. Calendar uses `.ics` import/export; Finance uses manual entry and CSV
import/export with integer cents, and never connects to a bank, moves money or trades.

## Deferred
OAuth calendar/email integrations (one at a time, scoped, with a disconnect control) and
app-to-app workflows are not built; they should follow once the data models have settled.
