<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-040 — The Work view is layout state, shared by the context panel and the Work card

- Status: accepted
- Date: 2026-09-22

## Context

In the frozen v110 maquette, the Work mode's six views (Overview, Tasks, Board,
Timeline, Activity, Runs) are chosen from the left context panel's "Work"
section, not from a tab bar inside the Work card. The app kept the active view
in a signal local to `WorkSurface`, so the context panel (rendered by the root
layout, outside the session tree) could not read or change it.

## Decision

The active Work view moves into the layout context (`layout.work.view()` /
`layout.work.setView()`), next to the inspector tab it already owns. The view
model (`WorkView`, `WORK_VIEWS`, icons and label keys) moves from
`pages/workbench/work-view.ts` to `context/work-view.ts`, so the context layer
never imports from `pages/`. The in-card tab bar is removed; the context panel
is the only switcher, as in the maquette.

## Consequences

- One owner for the active view; both surfaces render from it.
- The view is session-scoped UI state and is not persisted, like the peek state.
- Counts shown next to views in the maquette (Tasks 3, Runs 2) come from Team
  data, which lives under `TeamProvider` below the root layout; they are not
  rendered in the context panel.
