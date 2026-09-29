<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-085 — Design opens on the canvas studio, ported from the reference

**Status:** accepted — 2026-09-28

## Context

The reference's Design editor (`#designWorkbench`, V5 prototype) is a canvas
studio. It has three parts:

- **Left panel, 240 px, "Outils design":** three rows of icon tools, a
  Structure / Design System switch, "Créer un élément", Pages, and a
  searchable layer tree with rename, visibility and lock actions.
- **Canvas:** a floating tool dock on top and, at the bottom, Présenter, a
  change bar (Saved, undo, redo, Revert, Checkpoint) and a zoom pill.
- **Comments panel:** 260 px, on the right.

The app opened Design on a row of raw tabs (GitHub, Canvas, Terminal,
Navigateur, Spec, Fichiers) landing on the file explorer. Its native canvas
(ADR-039) sat behind the "Canvas" button with an unstyled toolbar.

## Decision

1. **Default tab.** The Design workshop is seeded with a non-closable
   **Canvas** tab, and that tab is active. Spec and Fichiers stay seeded.
2. **Canvas tab layout.** It renders the reference's studio at the measured
   values (`styles/v110-design.css`). Every control is wired to the canonical
   document (ADR-039):
   - the drawing tools;
   - undo and redo;
   - layers: search, rename, visibility, lock;
   - comments panel and its count;
   - zoom;
   - Checkpoint and Revert, a local restore point for the document;
   - Présenter, which puts the canvas in fullscreen;
   - Refresh, which reloads from the repository;
   - Source, which shows the document JSON read-only;
   - Export, which downloads that JSON;
   - Design System, which lists the workspace's design-system catalogues.
3. **Controls without an engine** are shown disabled, with a "Coming soon"
   tooltip, never faked: device format, capture to chat, inspect, annotate,
   modify, vector, version history, share, audit, node editing, pencil, page
   actions and new page. The Snap badge reports that snapping is always on.
4. **Atelier menu.** The other workshop tabs (Spec, Fichiers, Terminal,
   Navigateur, artifacts, GitHub state) move to an "Atelier" menu in the
   panel head. The head uses the slot where the reference has "→ Work", which
   has no handoff runtime in the app. The tab bar is shown only while a
   non-canvas tab is active, so there is always a way back to the canvas.
5. **Phones.** The panel becomes a drawer opened by the bottom bar's
   "Layers" button. The dock shows icons only, at 36 px.

## Rejected alternatives

- **Keep the tab bar above the studio.** It is not in the reference, and it
  costs 36 px of canvas.
- **Hide the engine-less controls.** That breaks the reference layout.
  Disabled and labelled keeps parity without lying about capability.

## Consequences

- The e2e canvas specs no longer click `[data-design-open-canvas]`, because
  the canvas is already open. `mode-navigation` reaches Spec through the
  Atelier menu.
- Not ported:
  - Assets, the AI policy pill and the viewport-width bar: the canvas model
    has no asset library, no AI-policy state and no artboard width.
  - Multiple pages: the document is a single page, so the Pages list shows
    only that one.
