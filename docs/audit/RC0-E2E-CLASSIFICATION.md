<!-- SPDX-License-Identifier: MIT -->
# RC-0 E2E failure classification (2026-10-02)

## The measurement this section is based on

Re-measured by lane A (card A3) on a **clean clone of `origin/dev`**, not a worktree:

```
clone:  https://github.com/Rwanbt/unifia.git, branch dev, single-branch, no worktrees
SHA:    a71cd08d2  test(voice): refuse a tampered model artifact, and close four integrity gaps (#305)
host:   Windows 11, Chromium 141 (Playwright 1.57.0), Bun 1.3.14
config: PLAYWRIGHT_WORKERS=1, PLAYWRIGHT_RETRIES=0, real backend, terminal specs enabled
```

One full run, no retries, one worker:

```
247 passed   52 failed   5 did not run     1.3h
```

That is a real drop against the three recorded baselines in `RC0-E2E-CLASSIFICATION.md` and
`EXECUTION-LOG.md`, all of which are superseded by it:

| baseline | SHA | pass | fail |
|---|---|---|---|
| `RC0-E2E-BASELINE-20261003.md` | `fixed9f69f9c` | 203 | 98 |
| full run | `8777452c46` | 240 | 59 |
| full run | `e849922c98` | 247 | 51 |
| **this run** | **`a71cd08d2`** | **247** | **52** |

The failure count has flattened around 50 for the last two runs. It is not going down on its own, and the
composition below is why.

## How to reproduce

```bash
git clone --branch dev --single-branch https://github.com/Rwanbt/unifia.git unifia-a3
cd unifia-a3 && bun install --frozen-lockfile
cd packages/app
PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_RETRIES=0 npx playwright test --reporter=line
```

One worker and zero retries are the point: the card requires a failure to be reproducible to be classifiable,
and CI's own `e2e (linux)` job is not a usable signal today (see "Why the CI job cannot be trusted" below).

## Groups by cause

Ordered largest cluster first. Every row is one of **STALE-SPEC**, **PRODUCT-BUG**, or **HARNESS**, and every
row is backed by the error signature counted in this run.

### G1 — design-visual, 8 failures. STALE-SPEC. Owner: lane A. Decided by owner (D14).

```
design-visual.spec.ts:132  V13 matches the committed baseline
  light 375x812, light 768x1024, light 1280x800, light 1440x900,
  dark  375x812, dark  768x1024, dark 1280x800, dark 1440x900
```

`expect(page).toHaveScreenshot(expected)` failed — **all 8 failures in this group are this one line**, the largest single
cluster in the suite. Measured ratios are 0.81-0.90 of all image pixels different, which is a different page,
not anti-aliasing.

This is a known, already-diagnosed cluster (`EXECUTION-LOG.md` 2026-10-04 21:00, and
`docs/audit/RC0-DESIGN-VISUAL-BASELINES.md`): the committed baselines are from 2026-09-29, and
`f0b3dd481c feat(brand) refresh the generated stylesheet` replaced the palette wholesale — `surface-canvas
#f1f1f2` and `text-primary #17171a` are gone in favour of the `unifia void #010308` ramp — so a full palette
change changes essentially every pixel. Independently, the capture **bakes in this machine**: the shot paints
the live project path, so a baseline regenerated here fails on any other machine, clone or branch. D14 settles
the approach: fix the project identity to a fixed fixture, then regenerate. Not started — it needs a backend
fixture change plus a regenerated baseline set, which is a bigger lot than a PR, and regenerating first would
bake this clone's path into eight files.

### G2 — canvas interaction cluster, 8 failures. PRODUCT-BUG, needs a failing unit test. Owner: lane B.

```
canvas-comments.spec.ts:44    comment tool, pins and panel drive the canonical comment commands
canvas-multiselect.spec.ts:47 modifier clicks, marquee and group drag commit one multi-move
canvas-native.spec.ts:77      native design canvas renders and persists drag, resize and rotation
canvas-native.spec.ts:153     dragging a sibling snaps to its edge and one undo restores the gesture
canvas-path-curve.spec.ts:45  dragging a pull handle rewrites the canonical curve and survives a reload
canvas-path-edit.spec.ts:45   dragging a path anchor rewrites the canonical path data
canvas-pen-curve.spec.ts:29   pen drag draws curves and clicking the first anchor closes the path
canvas-vector.spec.ts:28      vector tools draw canonical ellipse, line and pen nodes on the canvas
```

Not one of these fails on a missing element. Each fails on a **product invariant after the gesture**, and the
suite names the invariant in the error: `publishing must commit one addComment`, `the drag must persist a
canonical transform`, `the dragged pen point must become a cubic segment`, `the sibling edge must snap`. The
UI renders, the pointer drag lands, and the document is not updated. That is a defect in the canvas
commit/serialise path, not in the spec — the specs are asserting exactly what `canvas.design.json` is supposed
to hold.

This is the largest PRODUCT-BUG group and it needs a failing unit test in `packages/unifia`, which is outside
lane A's scope. Handed over as NEEDS-OWNER; see `docs/autonomy/rc0/journal-A.md`.

### G3 — v110 responsive family, 5 failures. STALE-SPEC. Owner: lane A.

```
a3-responsive.spec.ts:137     memory pane keeps the triptych/single-pane contract across viewport modes
a4-responsive.spec.ts:29      code surface keeps the terminal-closed default and reachable toggle across families
a6-responsive.spec.ts:31      design split follows the v110 family classification across viewports
automate-responsive.spec.ts:46 automate studio keeps the canvas and moves the library into a sheet on overlay families
settings-responsive.spec.ts:30 settings dialog keeps the tabs/drill-down contract across viewport families
```

Signature: 3 of the 5 are `toHaveAttribute(expected)` and the rest `toBeVisible`; the family-classification
contract is a viewport classification the specs assert and the product does not reproduce at every width.
`a3-responsive:137` in particular is the memory-pane attribute timeout recorded as un-diagnosed in the
2026-10-04 23:40 log entry and still un-diagnosed here. Specs to fix, one PR per file, largest first.

### G4 — projects/sidebar navigation, 5 failures. STALE-SPEC. Owner: lane A.

```
projects-close.spec.ts:13        closing active project navigates to another open project
projects-switch.spec.ts:16       can switch between projects from the sidebar
projects-switch.spec.ts:38       reopening a project from the sidebar returns to its workspace session
workspace-new-session.spec.ts:60 new sessions from sidebar workspace actions stay in selected workspace
workspaces.spec.ts:75            can create a workspace
```

Signature: `toBeVisible` and a 60 s click timeout on the sidebar project row. These specs were previously fixed
by moving to the sidebar row and then **regressed** — recorded as passing in `RC0-E2E-CLASSIFICATION.md`
("projects-switch (2), projects-close | passed after the change"). So the locator they were moved to is gone
again, which makes this a stale locator rather than a product defect, but it needs one confirming probe per
file before the spec is rewritten.

### G5 — modes / web-bridge family, 5 failures. MIXED. Owner: lane A (spec) + lane B (bridge).

```
design-mode.spec.ts:33        design mode in web is terminal and non-retryable (F-03 closure)
mock-bridge-smoke.spec.ts:10  mock bridge connects the Work surface without a reactive update loop
mode-navigation.spec.ts:61    workbench surfaces fail closed when the web bridge is unavailable
mode-reload-stability.spec.ts:48 10 reload cycles under session load do not grow event streams
mode-switch-latency.spec.ts:96   C4a latence de bascule de mode par le rail, T-LAT-3 bascules chaudes
```

These three concerns share one surface. `design-mode:33` and `mode-navigation:61` assert the **fail-closed**
behaviour that ADR-041 mandates when `UNIFIA_SERVER_PASSWORD` is unset, and ADR-041's consequence is that the
bridge route 404s and the banner is fail-closed. The 2026-10-04 23:40 entry fixed `design-mode` in product
code; these are the sibling assertions that were not covered by it. Needs a probe to separate "spec asserts the
wrong phase" from "bridge still reachable". `mode-switch-latency` and `mode-reload-stability` are timing and
leak assertions and are listed here unclassified — a 1-worker run is the only honest way to measure them and
that is what this run is.

### G6 — prompt / shell family, 4 failures. STALE-SPEC. Owner: lane A.

```
context.spec.ts:72            context panel can open file picker from context actions
prompt-shell.spec.ts:13       shell mode runs a command in the project directory
prompt-shell.spec.ts:58       shell mode unmounts model and variant controls
prompt-slash-terminal.spec.ts:5 /terminal toggles the terminal panel
```

Signature: `element(s) not found` (7 occurrences of that signature across the whole run, 4 of them here) and a
click timeout. Stale selectors on shell-mode chrome.

### G7 — session model persistence, 3 failures. STALE-SPEC. Owner: lane A.

```
session-model-persistence.spec.ts:268 session model restore per session without leaking into new sessions
session-model-persistence.spec.ts:301 session model restore across workspaces
session-model-persistence.spec.ts:343 variant preserved when switching agent modes
```

Three assertions in one file, all about model/variant restore. `toHaveCount` and `toEqual` deep-equality
signatures. One spec file, one PR.

### G8 — sidebar popover, 3 failures. STALE-SPEC. Owner: lane A.

```
sidebar-popover-actions.spec.ts:14 collapsed sidebar popover stays open when archiving a session
sidebar-popover-actions.spec.ts:50 opening another project disclosure leaves the active route unchanged
sidebar-popover-actions.spec.ts:75 project disclosure opens with keyboard activation
```

One file, previously worked (2 of 3 fixed earlier), so the third is the known-open
"collapsed sidebar popover" case plus two regressions.

### G9 — single-file and unclassified, 11 failures.

```
design-a11y.spec.ts:45          Design surface WCAG 2.1 AA, surface has no violations
session-child-navigation.spec.ts:6  task tool child-session link does not trigger stale show errors
session-composer-dock.spec.ts:291  auto-accept toggle works before first submit
session-composer-dock.spec.ts:590  todo dock transitions and collapse behavior
settings-keybinds.spec.ts:195      changing new session keybind works
terminal-tabs.spec.ts:40           inactive terminal tab buffers persist across tab switches
home-replay.spec.ts:50             home mode pill text content stays stable across the matrix
motion.spec.ts:58                  motion contract selectors carry a transition property
v110-shell-gate.spec.ts:86         M3 shell gate (Phase 3), desktop-large inspector tabs are reachable
settings-behavior.spec.ts:110      plugins tab adds and removes a real MCP server
work-board-reload.spec.ts:15       a human-moved Team task stays in its Kanban column after reload
```

`design-a11y:45` is `axe found no element for its include selector` — the gate is measuring nothing, which is
worse than a failure because it reports green coverage of nothing. `terminal-tabs:40` is the third attempt on
that file and is left measured rather than guessed, per the programme's own rule.
`settings-behavior:110` is the MCP-server removal question that has been open since 2026-10-04 10:00.

## Tally

| Class | Failures | Owner |
|---|---|---|
| STALE-SPEC | 25 | lane A (one group per PR) |
| PRODUCT-BUG | 8 | lane B (G2, canvas commit/serialise) |
| MIXED — needs a probe to split | 5 | lane A + lane B |
| Unclassified, needs its own probe | 11 | lane A |

## Why the CI job cannot be trusted

`e2e (linux)` is not a required check, and it is not currently a signal either. `EXECUTION-LOG.md`
2026-10-04 16:20 measured it hitting the 110-minute ceiling with 5 `port-gate` retries still pending; those were
fixed by #271, and this run shows `port-gate` is gone from the failure list entirely, which confirms it. But
the job still does not finish inside the ceiling, and until it does, "CI agrees" is not available as a
cross-check for anything in this document. Every classification above therefore rests on the local run, which
is also why one worker and zero retries were used: a number that moves when you change the worker count is not
a measurement.

## What this does not establish

- Windows-only. Linux CI may differ; nothing here has been cross-checked against a finished `e2e (linux)`.
- Physical devices, native transport and screen readers are not covered.
- G5 and G9 are grouped by surface, not by proven cause. They are labelled unclassified on purpose: calling
  them flaky without five repeated runs would be the one thing this document exists to prevent.

---

## Superseded sections below (kept for the record)

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
