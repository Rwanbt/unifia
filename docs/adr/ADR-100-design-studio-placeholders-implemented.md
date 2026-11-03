<!-- SPDX-License-Identifier: MIT -->
# ADR-100 — Design studio: the ADR-085 placeholders are implemented

**Status:** DECIDED. Owner directive of 2026-11-03: "implement the 12 unavailable controls". Amends ADR-085.
**Date:** 2026-11-03

## Context

ADR-085 kept the studio controls with no engine visible, but disabled and labelled "unavailable". These were format, capture, inspect, annotate, modify, vector, history, share and audit, page actions, new page, and the Node and Pencil tools.

## Decision

Every one of them is now a working control, built on the canonical document and its typed commands:

- **Format**: device presets for the selected page, or a new page at that size.
- **Pages**: top-level frames, i.e. artboards. The document format has no page concept, and adding one would break older readers.
  - **New page** adds a frame.
  - **Page actions** rename, duplicate and delete it.
- **Capture**: PNG of the content layer.
- **Share**: Web Share of the `.design.json` where available, clipboard otherwise.
- **Inspect and Modify**: a properties panel, read-only or editable, through three new commands: `updateStyle`, `updateText` and `replaceNode`.
- **Vector**: converts a rectangle, ellipse or line into a path in place (`replaceNode`).
- **History**: lists undo steps and restores one through the same undo path.
- **Audit**: checks validity, WCAG text contrast, hidden, unnamed, empty, tiny and off-page elements.
- **Annotate and Pencil**: freehand strokes saved as path nodes. Annotations are drawn in red.
- **Node**: selects without moving and shows path and line anchors.

The logic lives in pure modules (`studio-actions.ts` and `studio-controller.ts`, ADR-0001 factory) with unit tests. The canvas tab only wires them in.
