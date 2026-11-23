# ADR 0002: Single Electron window; the shell and its windows are renderer UI

**Status:** Accepted · 2026-11-20

## Context

An OS-like desktop needs windows with drag, resize, focus order, minimize/maximize and persisted
positions. Two options:

1. **Native child `BrowserWindow`s** managed by the main process (one web contents per window).
2. **One `BrowserWindow`** hosting the whole desktop; "windows" are positioned DOM elements
   managed by a renderer store.

Option 1 gives true OS windows but multiplies memory (a Chromium instance per app), complicates
z-order/focus coordination across processes, makes drag/resize feel detached from the wallpaper,
and forces every state mutation through IPC. Option 2 matches how web desktops (and the browser
itself) model windows, keeps interactions in one render loop, and makes persistence trivial.

## Decision

Ship **one** Electron window (`frameless-ish` chrome is still OS-native; in-shell chrome is drawn
by the app). The desktop, dock, launcher, and all "windows" are React components driven by
`windowStore` (zustand). Focus order is an id array; z-index derives from it. Positions persist to
`localStorage` and are re-validated on load.

The seam between shell and apps is a typed **`ShellApp` contract**
(`src/renderer/apps/types.ts`): metadata + one component. The shell owns placement, chrome,
z-order, and persistence; apps own only their content area.

## Consequences

- ✅ Fast, cohesive window interactions; simple, testable pure geometry in `lib/layout.ts`.
- ✅ Persisting/restoring layout is a validated `localStorage` read (untrusted-input rules tested).
- ⚠️ "Windows" are not OS-level: no native taskbar integration, no Alt+Tab previews per app window.
  Acceptable for the MVP scope; revisiting native windows would be a new ADR.
- ⚠️ A renderer crash loses the whole desktop, not one app (mitigated by contextIsolation +
  defensive persistence).
