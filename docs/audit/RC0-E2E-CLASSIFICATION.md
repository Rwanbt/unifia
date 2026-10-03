<!-- SPDX-License-Identifier: MIT -->
# RC-0 E2E failure classification (2026-10-02)

## Complete normal-clone baseline — 2026-10-03

The earlier worktree baseline is superseded by
[RC0-E2E-BASELINE-20261003.md](RC0-E2E-BASELINE-20261003.md):
203 pass/98 fail/7 skip/4 not-run on fixed9f69f9c,312 tests,53.5min,
Windows Chromium,2 workers,zero retries,terminal enabled and no ghostty stub.
All failure counts are retained; unknown causes are explicit. Project-edit
now also fails locally, so its earlier CI-only label no longer applies.

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
| titlebar-history (3) | failed in a Git worktree, passed from a normal clone (4 passed with `sidebar-session-links`) | environment artifact | the default project resolves to the main clone while the worktree is the tests' directory, so SDK sessions did not show in the sidebar; not a product or spec defect |
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

## Full local run from a Git worktree (added 2026-10-02) — NOT a reliable baseline
A first complete run (294 tests, 36.8 minutes, 2 workers, 0 retries, `dev` at `5d6a6fd`, terminal specs excluded) gave 189 passed, 86 failed, 15 skipped, 4 did not run. It was started from a Git **worktree** (`/home/user/unifia-e2e`) of a clone whose main checkout is `/home/user/unifia`. The default e2e project is resolved to the repository root, so the sidebar listed the main clone's project while the tests' directory was the worktree: sessions created through the SDK for the default project did not appear in the `Sessions` group. Re-running `app/titlebar-history` (3 tests) and `sidebar/sidebar-session-links` from a normal clone: **4 passed**. The earlier statement in this document and in the journal that these tests share an unexplained cause is therefore withdrawn: it was an artifact of the environment.

Consequence: every failure of that run that uses the default seeded project may be an artifact, and the per-spec numbers are not used here. A clean run from a normal clone is in progress and will replace this section. Failures that were individually reproduced and fixed on temporary projects, with a diagnosed cause, remain valid (project close, context meter, tab/Inspector/Explorer specs, models search field, `networkidle` in `home.spec`).

Valid facts from the first run: the suite completes in about 37 minutes with 2 workers when nothing retries, so the 110 minute CI ceiling comes from slower runners, 2 retries per failure and 30-90s waits.
