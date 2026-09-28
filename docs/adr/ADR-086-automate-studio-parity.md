<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-086 — Automate opens on the flow studio, ported from the reference

**Status:** accepted — 2026-09-28

## Context

The reference's Automate editor (`.a60-studio`, V5 prototype) is a flow
studio. It has four parts:

- **Header, 44 px.** Workflow name with a dirty dot and a version line, an
  environment select, the save state, then undo, redo, Versions, Import,
  Export and Publish.
- **Node library, 232 px.** Searchable, with categories drawn as a 2-column
  grid of 105×52 cards.
- **Flow canvas.** A floating run bar (Validate, Test, Run, Stop, fixture,
  status, → Work), a minimap at the top right and a zoom pill (−, %, +, Fit)
  at the bottom right. Its nodes are 174×76 cards chained left to right.
- **Debug panel.** Runs, Data, Logs, Tests and Problems tabs. It can be
  collapsed.

On phones, the header folds its actions into "•••", and the bottom pill adds
Debug and Nodes buttons that open a debug sheet and a library sheet.

The app showed a v0 document page: node families as raw chips, a list of
definitions, "Recent runs". The studio pieces it already had (canvas,
library, inspector, run bar, minimap, environment drawer) appeared only
after clicking "Inspect" on a definition, stacked in bordered cards, with
nodes laid out top to bottom.

## Decision

1. **The studio is the surface.** The first workflow file of
   `.unifia/workflows` opens by default. The header's title menu switches
   between files and creates a new one. "New workflow" writes a real
   `{id, version: 1, steps: []}` file.
2. **Layout.** Nodes are chained left to right at the reference's 174×76,
   with the existing 64 px gap. Cards render as HTML inside the SVG
   (`foreignObject`), so the reference's CSS applies unchanged. Ports, edges
   and drag behaviour are unchanged. On first load the canvas fits the graph,
   never above 100 %.
3. **Real wiring for every enabled control.**

   | Control | Wired to |
   |---|---|
   | Validate | dry run and graph checks |
   | Run | `startWorkflow` |
   | Stop | cancels the pending approval |
   | Allow / Deny | shown while an approval is pending |
   | Publish | append-only publish |
   | Versions | the published `.draft-*` files of the workflow, plus the canonical v2 save |
   | Import | a JSON file validated, then written to the workspace |
   | Export | downloads the draft |
   | Undo / Redo | local history of positions, edges and added nodes |
   | Environment | opens the existing grants/approvals/runs drawer |
   | Debug · Runs | durable run list |
   | Debug · Data | the editable local draft |
   | Debug · Logs | this session's run events |
   | Debug · Problems | the validation report |

4. **Controls without an engine** stay visible, disabled and labelled
   "coming soon":
   - Test and the fixture select, because there is no fixture runtime;
   - Debug · Tests;
   - → Work, because there is no handoff runtime.
5. **Library content** stays the runtime's `NodeFamilySchema`, not the
   reference's demo nodes (Slack, GitHub, SQL…). Only real families can be
   added.
6. **The node inspector** keeps its current content. It moves from the
   bordered grid into the studio's right edge, as an overlay column opened
   by selecting a node.

## Rejected alternatives

- **Keep the definition list above the studio.** It is not in the reference,
  and it pushes the canvas below the fold.
- **Show the reference's demo node families.** They would be buttons that
  add nodes the runtime cannot execute.

## Consequences

- `automate-graph-layout.ts` lays out horizontally. Its tests assert the new
  axis.
- `AutomateStudioStepList`, the narrow-screen fallback, is removed: phones
  use the canvas like the reference.
- Labels live under `automate.studio.*`. French keeps the reference's
  English action words: Validate, Run, Publish, and the other buttons.
