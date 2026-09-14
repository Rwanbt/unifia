<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# MiniMax M3 — Progress Log (2026-09-13)

> **Status** : Phases 0-3 + Vague 4 slices 2-3-4-5-6 + factory tests + v110-test-fix + M3-PROGRESS self-refresh + Phase 8 slices 1-9 (Automate studio canvas + Inspector pane + drag-to-move + port connectors + node library + run bar + canonical IR migration + Save + mobile/responsive + minimap/zoom-to-fit/breadcrumb) **PHASE 8 FERMÉE** (49 commits) + Phase 9 slices 1-2 (environment read-only pane + branch true/false ports + graph validation) + Memory mobile single-pane (campaign Phase 9 partial) + Motion: General > Animations toggle driving data-ui-animations + Phase 9.3 (Memory vault folder tree + DnD notes via the real rename route) + Phase 4.8 (v16 agent mode glyphs + real mode-switch controls) + Phase 9.4 (Memory note autosave 700 ms) + Phase 9.5 (Memory vault context actions) + Phase 9.6 (Memory depth graph filters) + Phase 5.1 (v110 chrome markers mounted) + **#91 fixed (workspace Reset/Delete dialogs re-wired — product regression from the Vague 5 factory stubs)**
> **Branch** : `new-ui` (worktree `_a7-automate-memory`)
> **HEAD** : `ee9f4ac9d9` fix(layout): wire the real workspace reset/delete dialogs (#91)
> **Baseline** : `9aabd75cd` (gélée 2026-09-13 21:12 Europe/Paris)
> **Doc author** : this file is updated on every session boundary. The canonical "current HEAD" pointer lives in `git log origin/new-ui`; this header is a snapshot at the time of the last update.

---

## Why this file exists

The M3 campaign is a multi-week effort that spans many sessions. Each
session lands a slice of work and the vault Session-Recap captures the
turn-by-turn story, but a repo-resident progress log is the durable
source of truth future agents can read without vault access.

**Read order** for a fresh M3 session:
1. `M3-CAMPAIGN-BASELINE.md` — frozen baseline + authority matrix + GO PORTAGE gate
2. `M3-ACCEPTANCE-MATRIX.md` — surfaces × viewports × states × interactions coverage
3. `M3-PROGRESS.md` (this file) — what has shipped and what remains
4. `packages/app/e2e/m3-harness.ts` — test helpers (Phase 2)
5. `packages/app/e2e/v110-shell-gate.spec.ts` — global gate spec (Phase 3)

---

## Shipped phases

| Phase | Sujet | Commit(s) | Statut |
|---|---|---|---|
| 0 | Baseline gelee | `b98b878140` | LIVREE |
| 1 | Acceptance matrix | `cdae98e210` | LIVREE |
| 2 | Harness helpers | `16a0b50eb6` | LIVREE |
| 3 | Shell global gate spec | `fba5c10d69` | LIVREE |
| 4.2 | Vague 4 slice 2 — buildRevertDockProps factory | `0234372d99` | LIVREE |
| 4.3 | Vague 4 slice 3 — buildFollowupDockProps factory | `f2de0db217` | LIVREE |
| 4.4 | Vague 4 slice 4 — DesktopChatSeparator sub-component | `80329ff8f6` | LIVREE |
| 4.5 | Vague 4 slice 5 — integrate SessionSidePanelSection | `527b941a31` | LIVREE |
| 4.6 | Vague 4 slice 6 — SessionArtifactViewerSection | `b62427eeed` | LIVREE |
| 4.7 | Vague 4 factory tests — buildRevertDockProps + buildFollowupDockProps (7 pass / 21 expect) | `044ad07ef1` | LIVREE |
| chore | Silence 9 M3-wrapper biome warnings | `dd6defe949` | LIVREE |
| chore | Use `import type` for type-only imports | `217dd2adc3` | LIVREE |
| chore | Silence 8 remaining biome warnings (repo-wide 13→0) | `2b929565a5` | LIVREE |
| chore | gitignore `.tmp-*.md` agent scratch files | `88cb9ea3fc` | LIVREE |
| **8.1** | **Phase 8 slice 1 — Automate studio canvas (read-only nodes + pan/zoom)** | **`87f3c1ab97`** | **LIVREE** |
| chore | i18n parity coverage for Phase 8 canvas keys (14 locales) | `7db9bab3a2` | LIVREE |
| **8.2** | **Phase 8 slice 2 — Inspector pane wired to canvas selection (controlled API)** | **`607dfc2696`** | **LIVREE** |
| chore | i18n parity coverage for Phase 8 inspector keys (14 locales) | `935adad06e` | LIVREE |
| **8.3** | **Phase 8 slice 3 — Drag-to-move (parent-controlled positions, edges follow)** | **`95f5c77349`** | **LIVREE** |
| chore | i18n parity coverage for Phase 8 coordinates keys (14 locales) | `ceb432a48a` | LIVREE |
| **8.4** | **Phase 8 slice 4 — Port connectors (parent-controlled edges, drag-port-to-port)** | **`d39e91a43c`** | **LIVREE** |
| chore | i18n parity coverage for Phase 8 port + edges keys (14 locales) | `4af063846d` | LIVREE |
| **8.5** | **Phase 8 slice 5 — Node library (parent-controlled extraNodes, 15 NodeFamily grouped)** | **`a4aba02736`** | **LIVREE** |
| chore | i18n parity coverage for Phase 8 library keys (14 locales) | `9dea1e8f8f` | LIVREE |
| **8.6** | **Phase 8 slice 6 — Run bar (consolidated Start/Approve + Validate dry-run)** | **`ba351e05e1`** | **LIVREE** |
| chore | i18n parity coverage for Phase 8 run bar keys (14 locales) | `8710d754f4` | LIVREE |
| **8.7** | **Phase 8 slice 7 — Canonical IR migration (one-way v1 → v2 + Save button)** | **`69c8a9a853`** | **LIVREE** |
| chore | i18n parity coverage for Phase 8 Save keys (14 locales) | `64216802d4` | LIVREE |
| **8.8** | **Phase 8 slice 8 — Mobile + responsive (step list + accordion library)** | **`a1ff81aecd`** | **LIVREE** |
| **8.9** | **Phase 8 slice 9 — Minimap + zoom-to-fit + breadcrumb (FERME Phase 8)** | **`9700b91630`** | **LIVREE** |
| chore | i18n parity coverage for Phase 8 slice 9 minimap + breadcrumb keys (14 locales) | `4a9839cd6f` | LIVREE |
| **9.1** | **Phase 9 slice 1 — Environment pane (grants + approvals + runs, read-only drawer)** | **`f061fff246`** | **LIVREE** |
| **9.2** | **Phase 9 slice 2 — Branch ports (true/false) + cycle/duplicate graph validation** | **`701306f06a`** | **LIVREE** |
| chore | fix(team): host Team dialog inside TeamProvider (#82) — closes GitHub #82 | `05831355b2` | LIVREE |
| **M9** | **Memory mobile single-pane (triptych → single pane on overlay viewports)** | **`46aa98c9c3`** | **LIVREE** |
| **M13** | **Motion: Settings > General > Animations toggle + `<html data-ui-animations>`** | **`26ab510fbf`** | **LIVREE** |
| fix | **e2e collection restored** — gate spec importait `bun:test` (0 test collecté en CI) ; harness aligné HEAD + 2 findings tracés puis corrigés (#90) | `bf87fc66ba` + `0109c1f795` | LIVREE |
| fix | **#79 root cause** — `\\?\` prefix de `realpathSync.native` sur runner Windows rejetait chaque écriture vault ; strip + tests containment | `5eb46e56d7` | LIVREE |
| fix | **#71 e2e wedge** — `panels()` mesuré via `evaluate`+`getBoundingClientRect` (boundingBox wedgait le renderer) ; console 503 filtrée seulement si tout vient de `/model-intelligence/` | `a019b4ef77` | LIVREE |
| fix | **#91 compact-landscape** — drawer mobile fermé = `invisible pointer-events-none` (left:62px décalait le sliver de 62px au z-50) ; a3-responsive 2/2 toutes familles | `85f6ed05bf` | LIVREE |
| fix | **conformance SPDX** — `workflow-draft.test.ts` sans header SPDX = seul rouge new-ui ; scan local 363/363 fichiers couverts | `0290fdadf2` | LIVREE |
| **9.3** | **Phase 9 slice 3 — Memory vault folder tree + DnD notes (réel `renameFile` `/v1/files/rename`)** | **`b474fe7463`** | **LIVREE** |
| **4.8** | **Phase 4 reste — glyphes de mode agent v16 (chat/plan/debate/build/team/auto) + contrôles réels de bascule (Debate/TeamModelSelector)** | **`853666f8ea`** | **LIVREE** |
| **9.4** | **Phase 9 slice 4 — Memory autosave 700 ms (debounce, flush avant navigation, chip d'état, CAS en place)** | **`f7cf812eb3`** | **LIVREE** |
| **9.5** | **Phase 9 slice 5 — Context actions vault (rename inline, dupliquer, déplacer, exporter, supprimer, nouvelle note/dossier)** | **`b05978e1de`** | **LIVREE** |
| **9.6** | **Phase 9 slice 6 — Graphe depth 1-3 + tags + orphans (dernière ligne Memory de la matrice)** | **`b217f0579d`** | **LIVREE** |
| fix | **#94** — `port-gate` exigeait un rail visible < 900px : la gate ouvre la drawer et asserte les 4 modes ; local 5/5 sans retry | `c561e89c95` | LIVREE |
| **5.1** | **Phase 5 slice 1 — marqueurs v110 dormants montés (editor-pane, workspace-tabs-bar, file-tree) + labels tabs-bar i18n 17 dictionnaires** | **`a7bdea7de8`** | **LIVREE** |
| **5.2** | **Phase 5 slice 2 — vérification Search/Replace éditeur (@codemirror/search réel)** | **`74a3816760`** | **LIVREE** |
| **5.3** | **Phase 5 slice 3 — marqueur canonique `terminal-panel` + preuve de cascade e2e ; matrice Code mise à l'heure (blame/lens ❌, issue #96)** | **`904eeb930e`** | **LIVREE** |
| **12.1** | **Phase 12 slice 1 — contrat responsive du panneau Memory (triptyque/single, 5 familles, zéro overflow)** | **`5129902f4e`** | **LIVREE** |
| fix | **#91 ROOT CAUSE** — la Vague 5 (`886b5a0d6b`) remplaçait les vrais déclencheurs Reset/Delete par `dialog.show(() => null)` : le menu ouvrait un stack vide (overlay seul, Content jamais monté). Re-câblage des deux triggers + suppression des 7 deps fantômes + test de régression | `ee9f4ac9d9` | LIVREE |
| **11a** | **Phase 11 audit — gate de parité Settings (12 onglets desktop : pane + contrôles réels, zéro error boundary) + matrice honnête par dialog ; gaps maquette sans capacité → #98** | **`0fe7bb5b8a`** | **LIVREE** |
| fix | **#95** — 2 aria-labels FR codés en dur (Design browser back, files mode toggle) → `language.t()` × 17 dictionnaires + garde mécanique « aria-label accentué interdit » dans `parity.test.ts` ; reste des libellés FR des mêmes surfaces → #99 | `d491541ad0` | LIVREE |

---

## Extracted wrappers (Vague 4 pattern)

Each wrapper is a thin typed shell around an existing call site in
`packages/app/src/pages/session.tsx` (or `layout.tsx` for layout
factories). The pattern: export a `Props` interface that mirrors the
underlying component's full signature (accessors for memos, plain values
for stable identifiers), then re-export a `<WrapperName>` function that
forwards every prop verbatim.

| Wrapper | File | Phase | Notes |
|---|---|---|---|
| `buildRevertDockProps` | `session/revert-dock-props.ts` | 4.2 | Factory for revert dock props |
| `buildFollowupDockProps` | `session/followup-dock-props.ts` | 4.3 | Factory for followup dock props |
| `DesktopChatSeparator` | `session/desktop-chat-separator.tsx` | 4.4 | Sub-component (4 props) |
| `SessionSidePanelSection` | `session/session-side-panel-section.tsx` | 4.5 | Wraps `SessionSidePanel` (12 props) |
| `SessionArtifactViewerSection` | `session/session-artifact-viewer-section.tsx` | 4.6 | Wraps read-only artifact block |
| `SessionTimelineSection` | `session/session-timeline-section.tsx` | (Vague 3) | Existed before M3, type-safe extraction |
| `SessionMobileTabsSection` | `session/session-mobile-tabs.tsx` | (Vague 1) | Existed before M3, refactored |
| `createWorkspaceSidebarContext` | `layout/layout-contexts.ts` | Vague 5 | Factory |
| `createProjectSidebarContext` | `layout/layout-contexts.ts` | Vague 5 | Factory |
| `createSidebarPanelContext` | `layout/layout-contexts.ts` | Vague 5 | Factory |
| `layoutWorkflowSteps` | `workbench/automate-graph-layout.ts` | 8.1 | Pure layout (nodes + edges + bounding box, sequential flow) |
| `AutomateStudioCanvas` | `workbench/automate-studio-canvas.tsx` | 8.1 | SolidJS SVG pane: pan (pointer + Space), zoom (Ctrl/Cmd + wheel 0.5-2.0), reset, approval badges, SR fallback |
| `AutomateStudioInspector` | `workbench/automate-studio-inspector.tsx` | 8.2 | SolidJS read-only pane: empty state, id/label/position/approval/coordinates/edges metadata, close button |
| `AutomateStudioLibrary` | `workbench/automate-studio-library.tsx` | 8.5 | SolidJS pane: 15 NodeFamily types grouped into 5 categories, search filter, click → onAdd |
| `DEFAULT_LIBRARY_CATEGORIES` | `workbench/automate-studio-library.tsx` | 8.5 | Exported catalog: mirrors the canonical `NodeFamilySchema` enum |
| `AutomateStudioRunBar` | `workbench/automate-studio-run-bar.tsx` | 8.6 | SolidJS action bar: state chip + 5 actions (Validate / Start / Allow / Deny / Cancel) + error/validate panels |
| `validateDefinition` | `workbench/automate-studio-run-bar.tsx` | 8.6 | Pure helper: dry-run re-parse the definition, list shape errors + warnings |
| `migrateLegacyToCanonical` | `workbench/automate-migrate-legacy.ts` | 8.7 | Pure helper: one-way migration from legacy `{steps[]}` to canonical `{nodes, edges}` IR |
| `buildCanonicalFromState` | `workbench/automate-migrate-legacy.ts` | 8.7 | Pure helper: compose legacy + positions + user edges + extra nodes into the canonical shape |
| `serializeCanonical` | `workbench/automate-migrate-legacy.ts` | 8.7 | Pure helper: canonical → stable JSON string (fixed indent for clean diffs) |
| `parseCanonicalWorkflowDefinition` | `workbench/automate-decode.ts` | 8.7 | New parser: accepts BOTH v1 (auto-migrates) and v2 (passes through), returns `{originalVersion}` |
| `AutomateStudioStepList` | `workbench/automate-studio-step-list.tsx` | 8.8 | SolidJS vertical list view: button-per-step with id + label + family + approval chip + drag marker, used on narrow viewports |
| `AutomateStudioMinimap` | `workbench/automate-studio-minimap.tsx` | 8.9 | SolidJS minimap: one rectangle per laid-out node (accent for library-added), viewport indicator tracking pan/zoom, click → onJumpTo |
| `computeZoomToFit` | `workbench/automate-graph-layout.ts` | 8.9 | Pure helper: pan + zoom that centres the graph inside the canvas viewport (default padding 24 CSS px) |
| `edgeEndpoints` | `workbench/automate-graph-layout.ts` | 8.3 | Pure helper: re-derive bezier endpoints from current effective positions (superseded by `mergeEndpoints` in slice 4) |
| `mergeEndpoints` | `workbench/automate-graph-layout.ts` | 8.4 | Pure helper: combine synthetic + user edges, apply position overrides, return one endpoint set per edge |
| `closestInputPortDistance` | `workbench/automate-graph-layout.ts` | 8.4 | Pure helper: Euclidean distance from cursor to closest input port |
| `nearestInputPortId` | `workbench/automate-graph-layout.ts` | 8.4 | Pure helper: id of the nearest input port (for edge commit) |
| `hasEdge` | `workbench/automate-graph-layout.ts` | 8.4 | Pure helper: O(n) membership test on user-edge list |
| `PORT_HIT_RADIUS` / `PORT_RADIUS` | `workbench/automate-graph-layout.ts` | 8.4 | Constants: hit zone = 12 graph units, rendered circle = 6 graph units |

session.tsx LOC reduction: **1011 → 948 LOC** (-63 net across Vagues 1-4 slices 2-3-4-5-6).

---

## Repo health (M3 gates)

| Check | Result | Evidence |
|---|---|---|
| `bunx biome check` (1821 files) | 0 warnings | `Checked 1821 files in 1.97s. No fixes applied.` |
| `tsgo -b` (packages/app) | exit 0 | single-package verification |
| `bun turbo typecheck` (47 packages) | 47/47 PASS | pre-push hook gate |
| Working tree | clean | `git status --short` empty |
| Lint warnings in packages/app | 0 | was 9, all silenced in `dd6defe949` |
| Lint warnings repo-wide | 0 | was 22, all silenced across 3 commits |
| `bun test packages/app` | 1413 pass / 21 todo / 0 fail (3.73s) | pre-push hook gate |
| Phase 8 canvas unit tests | 38 / 38 pass (64 expect) | `automate-graph-layout.test.ts` + `automate-migrate-legacy.test.ts` |
| Phase 8 canvas smoke tests | 22 / 22 pass | `automate-studio-canvas.test.ts` |
| Phase 8 inspector smoke tests | 10 / 10 pass | `automate-studio-inspector.test.ts` |
| Phase 8 library smoke tests | 7 / 7 pass | `automate-studio-library.test.ts` |
| Phase 8 run bar smoke tests | 14 / 14 pass | `automate-studio-run-bar.test.ts` |
| Phase 8 step list smoke tests | 7 / 7 pass | `automate-studio-step-list.test.ts` |
| Phase 8 minimap smoke tests | 6 / 6 pass | `automate-studio-minimap.test.ts` |
| Phase 8 migration unit tests | 17 / 17 pass | `automate-migrate-legacy.test.ts` |
| `bun test packages/app` (Phase 9 current) | 1452 pass / 21 todo / 0 fail | full app suite |
| `packages/unifia` knowledge suite | 900 pass / 1 skip / 0 fail | après fix #79 |
| `e2e/v110/port-gate-strict.spec.ts` | 5/5 PASS | ré-vert après #82 |
| `e2e/v110-shell-gate.spec.ts` | 10/10 PASS (1.1 min) | 0 fixme restant |
| `playwright test --list` | 195 tests / 71 fichiers | était 0 (loader `bun:`) |
| Phase 9 graph validation tests | 8 / 8 pass | `automate-graph-validation.test.ts` |
| Phase 9 branch port tests | 7 / 7 pass | `automate-graph-layout.test.ts` (slice 9.2 block) |
| Phase 9.3 memory tree unit tests | 8 / 8 pass (memory-panel-model) | `memory-panel-model.test.ts` (tree shape/counts/collapse/move target) |
| Phase 9.3 memory panel static tests | 10 / 10 pass | `memory-panel.test.ts` (single-pane + tree/DnD/i18n wiring) |
| Phase 9.3 i18n keys | 12 keys × 17 dicts + allowlist | `bun test src/i18n/parity.test.ts` |
| Phase 9.3 e2e | 1/1 PASS (46.6 s) | `e2e/v110/memory-vault-dnd.spec.ts` — rename call asserted on the mock client |
| `bun test src` (Phase 9.3) | 1460 pass / 21 todo / 0 fail | full app suite |
| Phase 4.8 agent-mode mapper tests | 3 / 3 pass | `agent-mode.test.ts` |
| Phase 4.8 e2e | 1/1 PASS (41.9 s) | `e2e/v110/chat-agent-modes.spec.ts` — glyph + Debate/Team control swap |
| `bun test src` (Phase 4.8) | 1463 pass / 21 todo / 0 fail | full app suite |
| Phase 9.4 save-state unit tests | 3 / 3 pass | `memory-panel-model.test.ts` (saved/unsaved/saving/not-loaded) |
| Phase 9.4 static autosave tests | 4 / 4 pass | `memory-panel.test.ts` (700 ms, CAS in place, flush, chip) |
| Phase 9.4 e2e | 1/1 PASS (49.6 s) | `e2e/v110/memory-note-autosave.spec.ts` — real bytes after debounce + immediate switch |
| `bun test src` (Phase 9.4) | 1470 pass / 21 todo / 0 fail | full app suite |
| Phase 9.5 action unit tests | 3 / 3 pass | `memory-panel-model.test.ts` (menu par type, noms uniques, rename) |
| Phase 9.5 static panel tests | 4 / 4 pass | `memory-panel.test.ts` (menu, routes réelles, inline, export/confirm) |
| Phase 9.5 e2e | 1/1 PASS (58.1 s) | `e2e/v110/memory-note-actions.spec.ts` — rename/duplicate/move/delete réels + download + mkdir disque |
| `bun test src` (Phase 9.5) | 1477 pass / 21 todo / 0 fail | full app suite |
| Phase 9.6 graph unit tests | 3 / 3 pass | `memory-panel-model.test.ts` (depth, anneau tags, orphans) |
| Phase 9.6 static panel tests | 3 / 3 pass | `memory-panel.test.ts` (contrôles, rendu, 1 seule requête documents) |
| Phase 9.6 e2e | 2/2 PASS (1.1 + 1.2 min) | `e2e/v110/memory-graph-filters.spec.ts` |
| `bun test src` (Phase 9.6) | 1483 pass / 21 todo / 0 fail | full app suite |
| Phase 5.1 e2e | 2/2 PASS (1.4 min) | `a4-code-chrome` (3 marqueurs visibles) + `file-tree` |
| Phase 5.1 i18n | parity 7/7 | 2 clés × 17 dictionnaires, traductions réelles (pas d'allowlist) |
| #91 fix — e2e local | 7/7 PASS (1.9 min) | `workspaces.spec.ts` complet : reset + reorder (précédemment skip) + delete |
| #91 fix — CI e2e (linux) | **145 pass / 0 fail / 46 skip** (19 min) | run `34821473192` — les 8 tests `workspaces.spec.ts` PASS (reset, reorder, delete inclus) ; issue #91 FERMÉE |
| #91 fix — unit | 2/2 pass | `layout-contexts.test.ts` : forwarding des triggers réels (pas de stub `() => null`) |
| #91 fix — `bun test src` (packages/app) | 1485 pass / 21 todo / 0 fail | après ajout des 2 tests de régression |
| #91 fix — conformance locale | 8/8 PASS | `node scripts/unifia-conformance.mjs` |
| Phase 11a — gate Settings | 1/1 PASS (49.8 s), sans retry | `e2e/v110/settings-parity.spec.ts` — 11 onglets web (Remote access desktop-gated, hors gate) |
| #95 — parity i18n | 9/9 PASS | 2 gardes nouvelles « aria-label accentué » (components + pages) |
| #95 — `bun test src` (packages/app) | 1487 pass / 21 todo / 0 fail | après gardes + clés × 17 dictionnaires |

---

## Remaining M3 phases (priority order from baseline)

| Phase | Sujet | Effort | Faisable en 1 session |
|---|---|---|---|
| **4 reste** | ~~tabs plan/debate/build/auto~~ LIVREES (4.8) ; motion reste (phases 13-16) | - | LIVREE |
| 5 | Code mode (editor + terminal + LSP) | 3-4 h | non |
| 6 | Work mode (Kanban DnD + run details) | 1-2 h | partiel |
| 7 | Design runtime (canvas Sketch integration, rotate, snap) | 4-6 h | non |
| **8** | **Automate P1 (studio node-based) — PRIORITE 1** | **5-8 h** | **non, multi-session** |
| 9 | Memory complet (folders + DnD notes ; mobile single-pane LIVREE) | 2-3 h | partiel |
| 10 | Browser (mobile, takeover, AI Activity) | 2-3 h | non |
| 11 | Settings (11 dialogs) | 3-4 h | non |
| 12 | Responsive exhaustif | 2-3 h | non |
| 13-16 | Motion + A11y + Visual + Audit | 4-6 h | non |
| 17 | Cleanup P1-5 post-parite | 2-3 h | non |
| 18-19 | Gates completes + Audit final | 4-6 h | non |

**Total remaining**: ~27-45 h of work, ~4-6 dedicated sessions.

---

## Where to resume next session

> **Session 4 (2026-09-14)** : `#91` est résolue — cause racine produit
> (stubs `dialog.show(() => null)` hérités de la Vague 5), fix `ee9f4ac9d9`,
> e2e local `workspaces.spec.ts` 7/7. La file restante est :
> **Settings — parité (11 dialogs ⚠️)**, **Work — parité**, **Responsive
> exhaustif (12.2+)**, **#95** (aria-labels FR), **#93** (wikilinks rename),
> **#96** (parité éditeur), **#92** (seed e2e-local).

Phase 9 (Automate continuation) slices 1-2 are shipped:
- 9.1 environment pane (read-only grants/approvals/runs) — `f061fff246`
- 9.2 branch true/false ports + graph validation — `701306f06a`

Recommended entry point for the next session: **Phase 4 remainder**
(plan/debate/build/auto tabs + motion) or **Phase 5 (Code chrome)** —
both have real runtime surfaces to port against. Memory folders + DnD
are done (9.3); the remaining Memory ⚠️ rows (context menu, autosave,
graph filters) are separate slices.

**Phase 7 (Design canvas) is BLOCKED on a product decision**: the repo
has no design-document runtime — `packages/design-sketch` is a ~1 KB
Excalidraw embed and `design-vector-tools.tsx` / `design-layers-panel.tsx`
are orphaned stubs (zero imports outside their own files). Replacing the
Excalidraw iframe with a real editor requires an ADR on the design
document format and runtime; do not fake it with more stubs.

| Slice | Sujet | Effort | Depends on |
|---|---|---|---|
| **8.9** | **Minimap + zoom-to-fit + breadcrumb (DONE — `9700b91630`) — FERME Phase 8** | **1-2 h** | **8.7** |

**Phase 8 is CLOSED** (9 slices delivered, ~22-26 h of work).
The Automate studio is now feature-complete per the Phase 8
acceptance matrix: canvas + zoom/pan + Inspector + drag-to-move
+ ports + connectors + library + run bar + persistence
(canonical IR + Save) + mobile/responsive + minimap/zoom-to-fit.
Only "Environment / branches" remains, which is Phase 9+
scope (a different M3 campaign).

The infrastructure from earlier phases is still ready:
- `M3-ACCEPTANCE-MATRIX.md` surfaces the 6 viewports × 4 modes (Code, Work, Design, Automate) × N states coverage
- `packages/app/e2e/m3-harness.ts` exports `setViewportFamily`, `pickShellMode`, `assertShellOverflow`, `assertFocusVisible`
- `packages/app/e2e/v110-shell-gate.spec.ts` is the global gate spec stub
- 5 session wrappers extracted (Phase 4 slices 2-6) + 9 Automate wrappers (Phase 8 slices 1-9) are isolated test targets
- 0 lint warnings + 47/47 typecheck + 1413/1413 unit tests = no baseline drag

The next M3 checkpoint will be the Phase 8 acceptance-matrix
audit (verify every "❌ MANQUE" line is now ✅ for the
Automate studio, aside from the Phase 9+ "Environment /
branches" line).

---

*Last updated 2026-09-13 (third autonomous session) by OpenCode. Head: `a7bdea7de8` on `new-ui` (pushed). Session 3: conformance SPDX fix `0290fdadf2`; Phase 9.3 - Memory vault folder tree + DnD notes through the real `/v1/files/rename` route (`b474fe7463`); Phase 4.8 - composer agent control now carries the six v16 mode glyphs (chat/plan/debate/build/team/auto, chat fallback) and the e2e `chat-agent-modes.spec.ts` pins the real control swaps (DebateModelSelector, TeamModelSelector, no fabricated Auto tab) (`853666f8ea`); Phase 9.4 - Memory note editor autosaves 700 ms after the last keystroke through the real CAS write route, flushes before note switches, and shows the mockup's Saved/Saving/Unsaved chip (`f7cf812eb3`); Phase 9.5 - the vault context menu ships real workspace actions only (open/inline rename/duplicate/move/export/delete on notes, new note/sub-folder on folders; pin/archive and folder rename are absent, no runtime backs them) with the e2e recording every client call (`b05978e1de`); Phase 9.6 - the graph pane ships the mockup filter set (depth 1-3, tag ring, orphans, note-link summary) and one documents query now feeds both backlinks and the graph (`b217f0579d`); rename wikilink auto-refactor deferred, issue #93. Local gates at HEAD: app suite 1483 pass / 21 todo / 0 fail, typecheck 0, biome 0 on touched files, e2e targeted 5/5 stable. **Memory surface: toutes les lignes de la matrice sont ✅ sauf pan/zoom/fit dans la pane (⚠️ partial)**. CI e2e (linux) state: 141/142 green, run 34792665489 - `port-gate` fixed and #94 closed with CI evidence; the Phase 9.3 mock regression (listFiles) fixed in `0c5276eda1`; the single remaining failure is `workspaces.spec.ts can reset a workspace` (#91): the activation race is fixed by `clickMenuItemWhenEnabled`, the dialog still never opens on CI and the local harness shows a different shape (Kobalte Content not mounted for BOTH workspace dialogs) - full evidence and next steps are on #91. Next session entry point: Phase 5 (Code chrome) - markers v110 now really mounted (5.1); the remaining gaps are the visual refit beyond markers (gutter/diagnostics markers, diff, terminal-panel rule) and the LSP/search-replace rows. Also open: 2 aria-labels still hard-coded French in Design tabs (issue filed). Phase 7 stays blocked on the design-document ADR. Handoff: vault `projects/unifia/sessions/`.*
