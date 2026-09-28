<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# Journal d'exécution des corrections

Un bloc par tâche : SHA, écarts, décisions.

## T1 — 20adc6dab3
Run bar returns to idle after completed/denied, Stop works while running (`updateWorkflow(runId,"cancel")`), cancel errors surface.

## T2
- Runtime check: `toIr` (workbench-server/native-workflow-port.ts) executes `steps` only and always links them sequentially; `parseWorkflowDefinition` accepts version 1 only. The old "Save canonical" wrote v2, which made the surface stop parsing its own draft.
- Decision: the draft stays v1; the drawn graph (positions, edges, library nodes) is stored beside `steps` under `ui` (`automate-graph-draft.ts`), written on every edit, reloaded with the file. Run sends `steps` + library nodes as steps. Drawn edges are not executed by the runtime (linear by construction).
- `buildCanonicalFromState`/`serializeCanonical` are now unused by production code: candidates for T23.
- Menu item "Save" now writes the graph to the draft (label changed, warning key removed).

## T3
`validateDefinition(source, t)` now takes the translator; 9 keys `automate.studio.issue.*`. Lesson: `workbench.*` keys must be genuinely translated in all 16 locales (parity test), so new keys use another prefix.

## T4
Generic per-mode registry (`context/mode-registry.ts`, `mode-publication.tsx`), instantiated for inspector cards (`context/mode-inspector.tsx`), mounted above `<Layout>` in `app.tsx` so the same pattern serves the left panel (T11). Fixtures stay as fallback until T10. Actions without `run` render `aria-disabled`.

## T5
Design canvas publishes its selection (`design/runtime/inspector-cards.ts`, keys `design.studio.inspector.*`). NAV check deferred to phase 5.

## T6
Automate publishes the selected node (`automate-inspector-cards.ts`, existing `workbench.automate.inspector.*` keys). Decision: the in-canvas inspector column is kept (it is the studio's own panel); the right Inspector now mirrors the selection, so its "click a node" hint is true.

## T7
Memory publishes the open note (`memory-inspector-cards.ts`, keys `inspector.empty.*`, `inspector.memory.*`). Real values only: tags, link/backlink counts, mtime, attach toggle (the panel's own `toggleAttached`). Note: `bun test` on a subset of `src/pages/session` shows a spurious solid-router "client-only" error in `session-composer-state.test.ts`; the full `bun test` is green (2045 pass), so always run the full suite (6 s).

## T8
Work publishes the active run (`work-inspector-cards.ts`, keys `inspector.work.*`): run id, status, health, progress, next task and its dependency count. The invented "Agent: Designer" row is gone.
