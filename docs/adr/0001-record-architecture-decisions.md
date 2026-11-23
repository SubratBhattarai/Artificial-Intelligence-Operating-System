# ADR 0001: Record architecture decisions as ADRs

**Status:** Accepted · 2026-11-20

## Context

The build spans three phases (scaffold → desktop shell → AI overlay) and several risky areas
(window management, secrets, model providers, tool access). A README changes constantly; it is a
poor place to record _why_ a trade-off was made.

## Decision

Keep short, single-topic ADRs in `docs/adr/`, one file per decision, indexed by `README.md` here.
Each records Context → Decision → Consequences. Statuses follow the usual
proposed/accepted/deprecated/superseded vocabulary.

## Consequences

- Trade-offs stay reviewable as the project grows; superseded decisions remain legible.
- Slight overhead per decision — acceptable because decisions here (process model, secrets,
  tool boundaries) are costly to reverse.
