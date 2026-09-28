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

## T9
Browser (window/mode/address of the tab the Browser destination really holds), Settings (section + page) and Account (identity, page, organisation, project count) publish real state. Invented Permissions card, "Sessions: 4" and the settings behaviour rows are gone once T10 removes the fixtures. Cards live next to their owners: `components/settings-inspector-cards.ts`, `components/account/account-inspector-cards.ts`, `pages/workbench/browser-inspector-cards.ts` (components must not import pages).

## T10
Fixtures (`NOTE_CARDS`, `INSPECTOR_CARDS`, `snapshotTime`) removed; a mode with nothing published shows `inspector.empty.*`. The test that read fixture names now asserts their absence.

## T11
`context/mode-navigation.tsx` (same registry as the inspector) mounted above `<Layout>`; the left panel renders published sections for Design/Automate/Browser/Memory, informational rows are `div`s (no dead button). Design/Automate/Memory/Browser panels are empty until T12-T14 publish (consecutive commits).

## T12
Automate publishes its side panel (`automate-nav-sections.ts`): real workflow files (click opens), run/failed tallies (click opens the debugger Runs tab). Limitation: the list fills once the surface is mounted (lazy chunk) and disappears when another mode is active (acceptable; the query lives in the surface).

## T13
Memory side panel: Notes / Graph / Backlinks rows do what the panel already does (`memory-nav-sections.ts`); the Search row is removed (no engine).

## T20 + Browser part of T14
The Browser tab keeps the pages opened in the session (`rememberVisited`, cap 50) and publishes them as its only side-panel section (click reopens). Plan item "restyle with v110 classes" dropped: `styles/v110-browser.css` already styles the `data-design-browser*` family and the open-window message already exists (`nativeHintOpen`). Placeholders Preview/Repository/Docs/Bookmarks/Downloads are gone.

## T14 (Design part)
Design publishes Pages (the edited document) and Design System (manifest catalogues, empty line when none). Demo Landing/Settings/Components and Tokens/Components/Assets rows are gone. Unused `sidebar.nav.{tokens,components,assets,localPreview,repository,documentation,bookmarks,downloads}` keys remain for T22 cleanup.

## T15
Design canvas persists in `.unifia/design/<id>.design.json` through the project file API (`sdk.client.file`, hash compare-and-swap), not the workbench client (its `createFiles` refuses to overwrite and needs the bridge); localStorage stays as safety copy + one-shot migration source (it is not erased). Save errors show "Not saved" in the change bar; a newer-schema file is never overwritten. VERIFIED in the browser: reload with the localStorage cleared restores the rectangle; hiding the layer wrote `"visible":false` to the file. `.unifia/` is gitignored.

## T16
Change bar no longer overlaps the zoom pill: a CSS `@container design-canvas (max-width: 719px)` rule stacks it above the pill (a ResizeObserver first attempt was dropped: the browser pane is hidden during checks, `document.hidden` is true, so observers do not fire; CSS containment does not depend on rendering frames). VERIFIED at 1440x900 with Chat+Inspector (canvas 411 px): bar bottom 820 < zoom top 828. Snap is now a static status span (snapping is always on).

## T17 — no change (audit finding refuted)
The audit (section D, marked "[LU, à confirmer]") said Files/Spec had no direct access. Runtime check in the Design workshop menu: items `spec`, `files`, `terminal`, `browser` are all listed (`seedDesignTabState` plants Spec + Fichiers as non-closable tabs and `DesignWorkshopMenu` lists every non-canvas tab). Nothing to fix; the audit line is corrected in phase 5.

## T18
Home composer card: the static text zone is a real button (`activate("code")`, same action as the folder/new-session buttons); the three invented pills (Build / MiniMax-M3 / Default) and their CSS are removed (Home has no project scope, so no real agent/model exists to show). VERIFIED in the browser: tag BUTTON, 0 pills, action buttons stay right-aligned. Rule 3 ("pastilles du compositeur" are deliberate) concerns the session composer, not these inert Home chips.
