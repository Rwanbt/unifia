<!-- SPDX-License-Identifier: MIT -->
# ADR-099 — Design surface: split presentation and stream wiring out of the tab files

**Status:** DECIDED (mini-ADR, CLAUDE.md "Design Review — Step 0")
**Date:** 2026-11-03

## Context

The Design mode audit found three files over the 500 LOC target: `design-surface.tsx` (842), `design-files-tab.tsx` (639) and `design-artifact-tab.tsx` (625). Each one mixed state, side effects and pure rendering.

## Decision

Extract, without changing behaviour, only the parts with a single responsibility and one-way dependencies:

- `design-files-rows.tsx`: `FileRow` and `TreeRow`, pure rows with no queries or mutations.
- `design-artifact-header.tsx`: the artifact header and its action row. State stays in the tab, and the header only renders and calls back.
- `design-artifact-stream-sync.ts`: opening artifact tabs from the stream, parsing assistant messages incrementally, and the e2e stream hook.
- `design-composer-attach.ts`: attaching a Design comment to the shared chat composer.

Each new module imports downward only (UI kit, `workbench-shell`, `artifact-render`). None imports a tab or the surface, so no cycle is possible. `design-surface.tsx` (~780 LOC) stays above the target as a coordinator, the same exception as ADR-0002.
