<!-- SPDX-License-Identifier: MIT -->
# RC-0 E2E failure classification (2026-10-02)

Scope: the `e2e (linux)` job of the `test` workflow, which is not a required check. It has not completed since the Home/Design/tabs work: it hits the 110 minute ceiling. This note classifies the failures with evidence instead of calling them flakes.

## Why the job times out
Every stale spec waits its full expect/test timeout (30-90s) before failing, and a failing test retries twice in CI. About 30 deterministic failures therefore consume most of the 110 minutes before the 300 tests can finish. Run `37037239033` (head `670a533`) stopped around the first 30 failures. A project-edit failure (`Timeout 30000ms ... predicate`) appeared in CI only; it passes locally (see below), so it is slowness under CI load or a CI-only cause, not classified further.

## Method (reproducible locally)
Playwright was run on Linux, 1 worker, 0 retries, with Chromium 141, from `packages/app`. Environment adaptations, none committed:
- a stub `ghostty-web` package in the local `node_modules` (the Git dependency is refused by the Cloud proxy); terminal specs are not supported with it;
- a copy of `script/e2e-local.ts` whose `freePort()` listens on `127.0.0.1` (the original listens on `::`, unavailable here);
- a browser directory aliasing the installed Chromium build to the layout Playwright 1.5x expects.

Classes used: **reproduced, stale selector** (fails locally and CI on a locator the current UI no longer renders); **reproduced, cause not diagnosed**; **fixed** (fix proven locally); **CI only** (fails in CI, passes locally).

## Results
| Spec | Local result | Class | Evidence |
|---|---|---|---|
| projects-switch (2), projects-close | passed after the change | fixed | Home recents are unreachable while projects are open (`/` redirects to a project); the specs now use the sidebar row. Closing the active project re-opened it: fixed in `layout.tsx` |
| server-default | passed | fixed | status marker now read from the Servers tab row |
| sidebar-popover-actions (2 of 3) | passed | fixed | row locator scoped to the desktop sidebar (unscoped matched 2 elements) |
| sidebar-popover-actions "collapsed sidebar popover" | failed | reproduced, cause not diagnosed | the project row is not rendered in a collapsed sidebar |
| titlebar-history (3) | failed | reproduced, cause not diagnosed | sessions created through the SDK do not appear in the sidebar `Sessions` group of the seeded project (`Sessions 0`) |
| files/file-tree, v110/a3-responsive "Inspector tabs" | failed | reproduced, stale selector | button `Toggle file tree` is gone |
| files/file-open | failed | reproduced, stale selector | `[data-slot="tabs-trigger"]` not rendered |
| files/file-viewer (3), session/session-review (2) | failed | reproduced, stale selector | tab roles (`package.json`, `Review`) not found |
| prompt/context (3) | failed | reproduced, stale selector | button wrapping `progress-circle` not found |
| settings/settings-models (2) | failed | reproduced, stale selector | placeholder `Search models` not found |
| modes/design-mode (4) | failed | reproduced, cause not diagnosed | `data-design-connection`, `data-design-split-kind`, `data-design-surface-switcher` not present |
| modes/mock-bridge-smoke | failed | reproduced, cause not diagnosed | `data-workbench-connection="ready"` not reached |
| projects/workspaces "non-git" | failed | reproduced, stale selector | button `Create Git repository` not found |
| session/session-child-navigation | failed | reproduced, stale selector | `a.subagent-link` not found |
| v110/a3-responsive (2 more) | failed | reproduced, cause not diagnosed | context-meter in the phone footer; memory pane attribute timeout |
| design/design-a11y | failed | reproduced, cause not diagnosed | axe found no element for its include selector |
| projects/project-edit | passed | CI only | `Timeout 30000ms` poll in CI, passes locally |
| modes/mode-switch-latency, modes/mode-reload-stability | not run locally | unclassified | CI: a mode switch took 507ms; reload stability could not find its anchor |

Local totals for the 24 tests of the second batch: 16 failed, 1 skipped, 7 passed. The failures are deterministic (they fail the same way in CI and locally), so they are not flakes. "Stale selector" means the locator targets markup the current UI does not render; whether the UI or the spec is right was not decided here, and no spec was rewritten blindly.

## What this does not establish
- No complete suite run (300 tests) was obtained, locally or in CI.
- The local environment differs from CI (stubbed terminal dependency, local Chromium build, Bun 1.3.14 vs 1.3.11); terminal specs were not run.
- Physical devices, native transport and screen readers are not covered.

## Full local run (added 2026-10-02, `dev` at `5d6a6fd`, before #221 and #222)
Command: `script/e2e-local` copy, 2 workers, 0 retries, expect timeout 15s, test timeout 45s, terminal specs excluded as in CI. It finished in 36.8 minutes, so the suite itself completes; the 110 minute CI ceiling comes from slower runners, 2 retries per failure and 30-90s waits.

Totals (294 tests): **189 passed, 86 failed, 15 skipped, 4 did not run.** The failures by kind: 42 locator not found, 25 assertion, 19 timeout. By directory: v110 57, modes 6, settings 5, root 4, app 3, prompt 3, session 3, sidebar 2, design 1, files 1, projects 1.

Already fixed after this baseline (merged in #221 and #222): `prompt/context` (2 of 3), `settings-models` (2), `workspaces` non-git (1). Still failing and deliberately untouched: `context` "Open file" (action no longer exists, product decision).

New findings from the full run:
- `files/file-open` fails in the full run although it passes alone: order or load dependent, cause not diagnosed.
- `sidebar/sidebar-session-links` fails like `titlebar-history`: sessions created through the SDK do not show in the sidebar `Sessions` group, so four tests share one unexplained cause.
- `v110-shell-gate` reports 12px overflow offenders at three viewports and `settings-keybinds` fails on keybind persistence; both unclassified.
- 57 of the 86 failures are in `v110/*` (Home, canvas, memory, shell, responsive, settings): not examined individually.

First failure per spec file (full list in the run log, not committed):

| Spec | Failures | Kind | First anchor or error |
|---|---|---|---|
| `app/titlebar-history.spec.ts` | 3 | locator-not-found | `locator('[data-session-id="ses_f017117c6ffelQxug3eYpvLLT1"] a').first()` |
| `design/design-a11y.spec.ts` | 1 | locator-not-found | `locator('button[data-mode="automate"]')` |
| `files/file-open.spec.ts` | 1 | locator-not-found | `getByRole('tab', { name: 'package.json' }).first()` |
| `modes/design-mode.spec.ts` | 3 | locator-not-found | `locator('[data-design-split-kind]')` |
| `modes/mock-bridge-smoke.spec.ts` | 1 | locator-not-found | `locator('[data-workbench-connection="ready"]')` |
| `modes/mode-reload-stability.spec.ts` | 1 | locator-not-found | `locator('[data-workbench-connection="ready"]')` |
| `modes/mode-switch-latency.spec.ts` | 1 | assertion | `Error: la bascule vers code a pris 622 ms` |
| `prompt/context.spec.ts` | 3 | locator-not-found | `locator('[data-component="button"]').filter({ has: locator('[data-component="progress-circ` |
| `projects/workspaces.spec.ts` | 1 | locator-not-found | `getByRole('button', { name: 'Create Git repository' })` |
| `session/session-child-navigation.spec.ts` | 1 | locator-not-found | `locator('a.subagent-link').filter({ hasText: /open child session/i }).first()` |
| `session/session-composer-dock.spec.ts` | 2 | locator-not-found | `locator('[data-action="prompt-permissions"]').first()` |
| `settings/settings-keybinds.spec.ts` | 3 | locator-not-found | `getByRole('dialog')` |
| `settings/settings-models.spec.ts` | 2 | locator-not-found | `locator('[data-v110="settings-frame"]').first().getByPlaceholder('Search models')` |
| `sidebar/sidebar-popover-actions.spec.ts` | 1 | locator-not-found | `locator('[data-component="sidebar-nav-desktop"] [data-v68-project="L2hvbWUvdXNlci91bmlmaWE` |
| `sidebar/sidebar-session-links.spec.ts` | 1 | locator-not-found | `locator('[data-session-id="ses_f0164ae27ffeQZngG4IGxLJdhg"] a').first()` |
| `v110/a3-responsive.spec.ts` | 3 | locator-not-found | `locator('button[aria-label*="context" i]').first()` |
| `v110/a3-shell-mobile.spec.ts` | 1 | assertion | `Error: tablet: rail drawer must be off-canvas` |
| `v110/a6-responsive.spec.ts` | 1 | locator-not-found | `locator('[data-design-split-kind]')` |
| `v110/canvas-comments.spec.ts` | 1 | assertion | `Error: publishing must commit one addComment` |
| `v110/automate-responsive.spec.ts` | 1 | timeout | `Test timeout of 45000ms exceeded.` |
| `v110/canvas-import.spec.ts` | 1 | assertion | `Error: the imported nodes must persist canonically` |
| `v110/canvas-layers.spec.ts` | 1 | timeout | `Test timeout of 45000ms exceeded.` |
| `v110/canvas-multiselect.spec.ts` | 1 | locator-not-found | `locator('[data-design-canvas-tab]')` |
| `v110/canvas-native.spec.ts` | 2 | assertion | `Error: the drag must persist a canonical transform` |
| `v110/canvas-path-curve.spec.ts` | 1 | timeout | `Test timeout of 45000ms exceeded.` |
| `v110/canvas-pen-curve.spec.ts` | 1 | assertion | `Error: the dragged pen point must become a cubic segment` |
| `v110/canvas-path-edit.spec.ts` | 1 | timeout | `Test timeout of 45000ms exceeded.` |
| `v110/canvas-vector.spec.ts` | 1 | assertion | `Error: expect(received).toMatchObject(expected)` |
| `v110/chat.spec.ts` | 2 | locator-not-found | `locator('[data-parity="session.chat"]')` |
| `v110/code.spec.ts` | 2 | locator-not-found | `locator('[data-parity="code.editor"]')` |
| `v110/editor-search.spec.ts` | 1 | timeout | `Test timeout of 45000ms exceeded.` |
| `v110/home-glance.spec.ts` | 3 | locator-not-found | `locator('[data-v110="home-glance-cell"]')` |
| `v110/home-replay.spec.ts` | 1 | assertion | `Error: expect(received).toEqual(expected) // deep equality` |
| `v110/home-states.spec.ts` | 2 | locator-not-found | `locator('[data-v110="home-empty"]').first()` |
| `v110/home.spec.ts` | 3 | timeout | `Test timeout of 45000ms exceeded.` |
| `v110/memory-graph-filters.spec.ts` | 1 | timeout | `Test timeout of 45000ms exceeded.` |
| `v110/memory-graph-pan-zoom.spec.ts` | 1 | timeout | `Test timeout of 45000ms exceeded.` |
| `v110/memory-note-actions.spec.ts` | 1 | timeout | `Test timeout of 45000ms exceeded.` |
| `v110/memory-note-autosave.spec.ts` | 1 | timeout | `Test timeout of 45000ms exceeded.` |
| `v110/motion.spec.ts` | 1 | assertion | `Error: expect(received).toMatch(expected)` |
| `v110/memory-vault-dnd.spec.ts` | 1 | timeout | `Test timeout of 45000ms exceeded.` |
| `v110/port-gate.spec.ts` | 5 | locator-not-found | `getByRole('button', { name: 'Toggle menu', exact: true }).or(getByRole('button', { name: '` |
| `v110/responsive.spec.ts` | 1 | locator-not-found | `locator('[data-parity="shell.workspace-tabs"]')` |
| `v110/settings-behavior.spec.ts` | 3 | assertion | `Error: expect(received).toMatchObject(expected)` |
| `v110/shell.spec.ts` | 4 | locator-not-found | `locator('[data-parity="shell.workspace-tabs"]')` |
| `v110/settings-responsive.spec.ts` | 1 | timeout | `Test timeout of 45000ms exceeded.` |
| `v110/surfaces.spec.ts` | 3 | locator-not-found | `locator('[data-parity="memory.panel"]').first()` |
| `v110/work-board-reload.spec.ts` | 1 | assertion | `Error: TestLLMServer still has 1 queued response(s) after the test finished` |
| `v110/work-team-panels.spec.ts` | 2 | locator-not-found | `locator('[data-v110="work-plan-panel"]').getByText(/no tasks\|aucune tâche/i)` |
| `v110/work-responsive.spec.ts` | 1 | timeout | `Test timeout of 45000ms exceeded.` |
| `v110-shell-gate.spec.ts` | 4 | assertion | `Error: desktopLarge: offenders [{"selector":"div","overflow":12}]` |

Still not established: which of these are stale specs and which are product regressions; the `v110/*` group is the largest and has not been reviewed.
