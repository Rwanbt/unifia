<!-- SPDX-License-Identifier: MIT -->
# RC-0 Work empty-state backend isolation

## Root cause

The worker-scoped E2E backend stores Team runs in a process-wide SQLite
database. Cancelling a run changes its lifecycle, not its persisted history.
The empty-panel spec cancelled previous runs and then asserted no runs/tasks/
events existed. These premises conflict: TeamStore.listRuns retains finished
runs, and Work pickActiveRun deliberately selects the latest finished run
when no run is in flight. A different project directory cannot isolate this
database. The baseline and #228 browser group both failed this empty scenario.

The shared fixture now exposes a worker-scoped backendIsolation option.
Playwright includes worker fixture registrations in its pool digest
(installed playwright/lib/common/fixtures.js); changing this option gives
the empty-panel suite a distinct backend process and data sandbox. Existing
suites keep the shared default. The empty suite asserts a successful real
HTTP response with zero runs before navigation. It neither deletes history
nor changes product selection, skips, timeouts or existing UI assertions.

## Evidence and failure classification

- Repository serial typecheck:47/47 tasks successful,9.196s. App's normal
  typecheck excludes E2E, so a separate temporary tsconfig extends App and
  includes the two changed E2E files explicitly: tsgo exit0.
- Biome's normal includes exclude E2E (zero files, not a lint pass). With
  the same rules and targeted includes:2 files,exit0. Its pre-existing
  noEmptyPattern diagnostic is documented at the required Playwright
  dependency-destructuring callback; no test outcome is suppressed.
- Worktree run at devc8af8709 plus fixture:2 pass/2 fail,2.7min. Empty panels
  and palette pass; Kanban reports an inactive run and Start Run encounters
  a failed dynamic import. These failures remain recorded, not called flakes.
- Normal clone at the same dev plus fixture:3 pass/1 fail,2.3min. Empty panels,
  palette and Kanban pass. Start Run reports the pre-existing localeCompare
  failure addressed by #228. Report preserved in build-temp.
- Normal clone at #228 head8d073c433dbff5b136ee43c505b81a44b123aa3c plus
  these two fixture changes:4 pass/0 fail,1.4min,Chromium,one worker,zero retry.
  The group contains unchanged work-board-reload and work-start-run specs,
  followed by work-team-panels. No model/runtime/browser stub was introduced.

Commands from packages/app: bun run test:e2e:local --
e2e/v110/work-board-reload.spec.ts e2e/v110/work-start-run.spec.ts
e2e/v110/work-team-panels.spec.ts.

Logs:rc0-agent/.build-temp/rc0-work-empty-isolation-20261003.log,
rc0-work-empty-normal-clone-20261003.log,rc0-work-empty-with-team-20261003.log.
Repository search found no second cancel-then-empty fixture. The four-pass
group qualifies the combination with #228, not the complete E2E matrix or
QA12R. Exact-head CI and qualification after delivery remain necessary.
