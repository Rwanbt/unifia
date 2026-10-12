<!-- SPDX-License-Identifier: MIT -->
# RC-0 Team page ownership: shared mutable empty pages

Source baseline: dev25b3f0bb583514f30bb80cbc9a721e7543cde61f.

## Root cause and chain

TeamProvider initialized runs, models and events with the same module-level
EMPTY_PAGE object, also reused by every provider instance and collection reset.
Solid setStore merges a page into the existing object. Loading model rows thus
mutated the run page and the global empty sentinel; the timestamps expected by
Work's pickActiveRun were absent from those model rows.

The complete baseline captured Work update's error boundary:
Cannot read properties of undefined (reading localeCompare), in pickActiveRun.
The HTTP TeamRun schema, SQLite toRun projection and withControlStatus adapter
preserve updatedAt; replacing it with a fallback would hide the wrong rows.
TeamProvider's loadRuns/loadModels casts did not prevent runtime aliasing.

An actual Solid store probe before the fix returned:

```json
{"same":true,"runs":{"items":[{"modelId":"m"}],"nextCursor":null},"globalEmpty":{"items":[{"modelId":"m"}],"nextCursor":null}}
```

The producer is a shared mutable store page, not a missing server timestamp.
The fix creates a fresh object and array for each initial collection, provider
and reset. Server/API/schema, sorting rules and transport remain unchanged.
A repository search for EMPTY_PAGE and empty-page variants finds no remaining
shared Team sentinel; every caller now uses createEmptyPage.

## Proof and limits

From packages/app:

- bun test --preload ./happydom.ts ./src/context/team.test.ts
  ./src/pages/workbench/work-team.test.ts:50 pass/0 fail/90 assertions,1.88s.
  Added witnesses exercise actual Solid store mutation, cross-collection reset
  and isolation between providers.
- bun run test:unit:2108 pass/1 live-STT skip/0 fail,151472 assertions,15.87s.
- bun run typecheck:exit0; targeted Biome:2 files,exit0, no changes.
- bun run test:e2e:local e2e/v110/work-project-update.spec.ts
  e2e/v110/work-team-panels.spec.ts e2e/v110/work-start-run.spec.ts
  e2e/v110/work-board-reload.spec.ts:4 pass/1 fail,3.7min,one worker/zero retries.

The unmodified project-update consumer now passes: real Team HTTP/SQLite run,
task facts, browser reload, persisted update/event and explicit HTTP503 recovery.
Start Run, Kanban reload and Team command palette also pass. The five-case
suite is NOT green: the empty-state panel test still sees a persisted task and
fails its Board No tasks assertion. Its error-context shows0/1 tasks and a
task card. The earlier normal-clone baseline also failed this test's empty
assertion; the remaining fixture/state ownership must be diagnosed separately.
No assertion, skip, timeout or test input was weakened.

Logs: rc0-agent/.build-temp/rc0-team-page-isolation-20261003.log and
rc0-team-pages-app-unit-20261003.log. The full baseline remains historical;
this targeted result does not requalify all312 cases or QA12R. Exact-head CI,
physical owner gates and release qualification remain separate.
