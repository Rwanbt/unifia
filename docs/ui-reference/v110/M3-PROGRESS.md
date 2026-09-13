<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# MiniMax M3 — Progress Log (2026-09-13)

> **Status** : Phases 0-3 + Vague 4 slices 2-3-4-5-6 + factory tests + v110-test-fix + M3-PROGRESS self-refresh + Phase 8 slice 1 (Automate studio canvas) shipped (21 commits)
> **Branch** : `new-ui` (worktree `_a7-automate-memory`)
> **HEAD** : `7db9bab3a2 chore(i18n): parity coverage for Phase 8 canvas keys across 14 locales`
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

session.tsx LOC reduction: **1011 → 948 LOC** (-63 net across Vagues 1-4 slices 2-3-4-5-6).

---

## Repo health (M3 gates)

| Check | Result | Evidence |
|---|---|---|
| `bunx biome check` (1809 files) | 0 warnings | `Checked 1809 files in 2s. No fixes applied.` |
| `tsgo -b` (packages/app) | exit 0 | single-package verification |
| `bun turbo typecheck` (47 packages) | 47/47 PASS | pre-push hook gate |
| Working tree | clean | `git status --short` empty |
| Lint warnings in packages/app | 0 | was 9, all silenced in `dd6defe949` |
| Lint warnings repo-wide | 0 | was 22, all silenced across 3 commits |
| `bun test packages/app` | 1315 pass / 21 todo / 0 fail (3.92s) | pre-push hook gate |
| Phase 8 canvas unit tests | 4 / 4 pass (16 expect) | `automate-graph-layout.test.ts` |
| Phase 8 canvas smoke tests | 8 / 8 pass | `automate-studio-canvas.test.ts` |

---

## Remaining M3 phases (priority order from baseline)

| Phase | Sujet | Effort | Faisable en 1 session |
|---|---|---|---|
| **4 reste** | plan/debate/build/auto tabs + motion | 2-3 h | partiel |
| 5 | Code mode (editor + terminal + LSP) | 3-4 h | non |
| 6 | Work mode (Kanban DnD + run details) | 1-2 h | partiel |
| 7 | Design runtime (canvas Sketch integration, rotate, snap) | 4-6 h | non |
| **8** | **Automate P1 (studio node-based) — PRIORITE 1** | **5-8 h** | **non, multi-session** |
| 9 | Memory complet (folders, DnD, mobile single-pane) | 3-4 h | non |
| 10 | Browser (mobile, takeover, AI Activity) | 2-3 h | non |
| 11 | Settings (11 dialogs) | 3-4 h | non |
| 12 | Responsive exhaustif | 2-3 h | non |
| 13-16 | Motion + A11y + Visual + Audit | 4-6 h | non |
| 17 | Cleanup P1-5 post-parite | 2-3 h | non |
| 18-19 | Gates completes + Audit final | 4-6 h | non |

**Total remaining**: ~27-45 h of work, ~4-6 dedicated sessions.

---

## Where to resume next session

Recommended entry point: **Phase 8 slice 2 (Automate studio — interaction layer)**.

Slice 1 shipped a read-only canvas (`87f3c1ab97`) that visualises the
current workflow's steps as a node graph with pan/zoom. The remaining
work in Phase 8 — interaction, library, inspector, run bar — is
broken into the following slices. The next session should pick the
one most aligned with the maquette priority.

| Slice | Sujet | Effort | Depends on |
|---|---|---|---|
| 8.2 | Click-to-select propagates to a right-side Inspector pane | 1-2 h | 8.1 |
| 8.3 | Drag-to-move nodes inside the canvas (positions live in component state, not in the on-disk file yet) | 2-3 h | 8.2 |
| 8.4 | Port connectors — click on a port, drag to another port to draw an edge; edge kinds mirror `WorkflowDefinition.edges` (flow / branch-true / branch-false / case-value / branch-N / on-failure) | 3-4 h | 8.3 |
| 8.5 | Node library (left pane) — drag a NodeFamily from `NodeFamilySchema` onto the canvas; on drop, instantiate a node with default `config` per family | 2-3 h | 8.3 |
| 8.6 | Run bar (bottom) — Start / Stop / Validate against the connected runtime, with the existing approval gate flow | 1-2 h | 8.2 |
| 8.7 | Persist positions + edges back to the on-disk file (replace the legacy `steps[]` editor with the canonical `WorkflowDefinition {nodes, edges}` IR) | 4-6 h | 8.4, 8.5 |
| 8.8 | Mobile + responsive — canvas collapses to a step list below tablet-portrait; library + inspector become drawers | 2-3 h | 8.7 |
| 8.9 | Minimap + zoom-to-fit + breadcrumb navigation | 1-2 h | 8.7 |

**Total remaining Phase 8**: ~17-25 h of work, ~3-4 dedicated
sessions. Phase 8.7 is the largest because it crosses from a pure
visual studio into the durable IR — it must include a one-way
migration path for existing `steps[]` files and a parallel-write
safety check (the current `automate-decode.ts` only validates the
legacy shape).

The infrastructure from earlier phases is still ready:
- `M3-ACCEPTANCE-MATRIX.md` surfaces the 6 viewports × 4 modes (Code, Work, Design, Automate) × N states coverage
- `packages/app/e2e/m3-harness.ts` exports `setViewportFamily`, `pickShellMode`, `assertShellOverflow`, `assertFocusVisible`
- `packages/app/e2e/v110-shell-gate.spec.ts` is the global gate spec stub
- 5 session wrappers extracted (Phase 4 slices 2-6) + 2 Automate wrappers (Phase 8 slice 1) are isolated test targets
- 0 lint warnings + 47/47 typecheck + 1315/1315 unit tests = no baseline drag

---

*Last updated 2026-09-13 12:30 Europe/Paris by Mavis root session after Phase 8 slice 1 (Automate studio canvas). Next checkpoint when Phase 8 slice 2 begins.*
