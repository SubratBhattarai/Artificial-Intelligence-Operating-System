# Architecture decision log

ADR = Architecture Decision Record. One file per significant decision: context, choice,
consequences. Newest last.

| #                                                 | Decision                                                                       | Status   |
| ------------------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| [0001](0001-record-architecture-decisions.md)     | Record architecture decisions as ADRs in this folder                           | Accepted |
| [0002](0002-single-window-in-shell-windowing.md)  | One Electron window; the "desktop" and its windows are renderer UI             | Accepted |
| [0003](0003-model-adapter-and-secret-boundary.md) | Model adapters live in main; secrets stay in `.env`; default stack is $0/local | Accepted |
| [0004](0004-read-only-typed-tool-boundary.md)     | Typed, read-only tool interface with an allowlisted filesystem view            | Accepted |
