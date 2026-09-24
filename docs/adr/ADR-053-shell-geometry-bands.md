<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-053 — Shell geometry follows the reference's three width bands

- Status: accepted (owner request 2026-09-24: panel responsive identical in
  every mode and exact against the reference)
- Date: 2026-09-24
- Related: ADR-045 (chat column), ADR-047, tokens/panels.ts, tokens/viewport.ts

## Context

A geometry sweep (rail, context, inspector, chat, main; 4 modes x 5 widths x
4 panel states x 3 layouts, `packages/app/tmp/parity/_panels.mts`) showed the
modes already share one geometry, but that geometry matched the reference
only at 1440 px: no gap between context, chat and main, a 246 px context
panel, 1440 px panel sizes at every width, and no compact or tablet shell.

## Decision

One shell geometry for every mode, measured on the reference:

- **>= 1200 px**: rail 62 px at 20 px; context, chat and main each 10 px
  apart; panel defaults from `tokens/panels.width()` (248/348/300, and
  220/330/280 up to 1360 px) until the user resizes a panel. The focused
  Chat column is `2 x clamp(280, 50vw - rail - context - 42, 540)` on the
  viewport, so side panels float beside it without moving it.
- **900-1199 px**: rail 58 px at 10 px; context (300 px) and inspector
  (320 px) are floating cards 8 px from the edges that push the workspace,
  and only one of them is open at a time.
- **< 900 px portrait**: the same rail and floating cards; Split is not
  offered (`fitLayout`).

A panel's width is the viewport default until the user drags it; the layout
store records `resized` per panel.

A hidden rail keeps the reference's 20px gutter: the workspace starts at
20px, or 10px after the context panel on wide shells (12px on compact
ones). The rail closes and opens with the reference's motion: a 340ms fade
and width change, and a 12px slide on the shell curve. `tokens/panels`
`workspaceLeft` owns the offset.

## Consequences

- Panel widths stored before this change are treated as not resized, so the
  viewport default applies once.
- The Vite dev page pads `#root` by 1 px (`app/index.html`); the desktop
  build does not. Sweeps treat +-1 px as noise.
