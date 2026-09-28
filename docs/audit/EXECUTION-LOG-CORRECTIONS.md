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
