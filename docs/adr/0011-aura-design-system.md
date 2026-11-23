# ADR 0011: Aura design system

Status: accepted

## Context
Nine stylesheets from earlier themes (dark HUD, Lunar Frost, light) stacked on top of each other, with hard-coded colours and competing rules. The goal is one calm, premium visual language: whitesmoke/charcoal/silver, subtle glass, no neon, applied to every app.

## Decisions
- One layer, `aura.css`, loaded last. It defines tokens (`--au-*`) for light and dark and remaps the legacy variables (`--bg-0`, `--panel`, `--text`, ...) to them, so older rules follow the new palette automatically. Rules use `html[data-theme] body …` so they win over the older theme layers in both themes.
- The shell was rebuilt where markup had to change: menu bar (`TopBar`), floating magnifying `Dock`, home stage (`VoiceBackground`), new `OrbCanvas` (pearl in light, brushed charcoal in dark, five states eased between each other) and a small CSS orb. Everything else (windows, buttons, tabs, cards, lists, dialogs, toasts, assistant panel) is restyled through shared classes, so no app logic changed.
- Motion: spring easing for opening, tabs, buttons and toasts; transform and opacity only; the orb pauses when the window is hidden; `prefers-reduced-motion` turns animation off.
- Existing users open in the light theme once (flag `aios.display.aura.v1`); the choice in Settings still applies afterwards.

## Consequences
The legacy stylesheets are still loaded and now partly unused (the old taskbar `.dock*` rules, `.orb-core` rings, desktop icon rules). They can be deleted in a later cleanup once the new look is confirmed on real screens. The design was built without being able to run the app, so spacing and contrast need a visual pass.
