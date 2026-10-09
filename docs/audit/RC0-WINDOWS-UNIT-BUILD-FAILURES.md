<!-- SPDX-License-Identifier: MIT -->
# RC-0 the Windows unit pipeline fails without a test failure

Three occurrences on 2026-10-03/04, in three different tasks, all on the same
required check (`unit (windows)`), and none of them is a test failure. This is
written up rather than rerun again, because the rule is three strikes and the
third one has now happened.

## The signature

`unit (windows)` goes red while **every test passes**. The junit artifacts prove
it: on the third occurrence the artifact set covered all six packages —
`ui` 168, `storybook` 3, `desktop-electron` 19, `app` 91, `unifia` 5370, and one
more at 2109 — for **7760 tests with `failures="0"`** in every file, while step 7
"Run unit tests" reported `failure`.

That rules out the test *suite* and points at the **task process** exiting
non-zero. Two of the three are now identified precisely, and the third is not the
same kind of thing as the first two — the shape of this is narrower than it looks:

| # | Run | Failing task | Measured cause |
|---|---|---|---|
| 1 | 37119278415 (#231) | `unifia#build` | `vite:prepare-outDir` → `ENOTEMPTY: directory not empty, rmdir 'packages\app\dist\assets'`, raised while `packages/unifia/script/build.ts:87` runs `bun run build` in `packages/app`. The artifact set was truncated to the three small packages, which is what an early abort looks like. |
| 2 | 37160023448 (#252) | `@unifia/sdk#build` | hey-api codegen **succeeded** — `[Job 1] ✓ …\src\v2\gen · 3 files · 1s`, `src/gen/client.gen.ts 476ms (unchanged)` — and then the script exited 1 with **no error message at all**. |
| 3 | 37174998851 (#260) | `unifia#test:ci` | The **test** task, not a build. `Tasks: 12 successful, 13 total`, `Failed: unifia#test:ci`, and the only diagnostic is `ERROR run failed: command exited (1)`. All 5370 `unifia` tests pass in the junit, and the log ends on `Cleaning up orphan processes` with no stack, no assertion and no named test. |

All three reruns of the failed job came back green, and all three were on PRs
whose diff was a single Markdown file, so none of them can have been caused by the
change under test.

## What the three have in common

Not "the build breaks". Only #1 is a filesystem race. The common denominator is
narrower and more specific: **a task process in the Windows unit pipeline exits 1
with no diagnostic at all**, while everything it actually produced — compiled
output, generated SDK, junit reports — is correct and complete. #1 at least named
itself (`ENOTEMPTY`); #2 and #3 emit nothing beyond the exit code.

The most common cause of "exit 1, no output" in a Bun test task after all tests
passed is an unhandled rejection or a process-level error **after** the reporter
has already written its junit, which is exactly the ordering the evidence shows:
the junit on disk is complete and green, and the non-zero exit lands after.

## Why rerunning is not a fix

`unit (windows)` is one of the seven protected checks, so every merge in this
programme waits on it. Rerunning works — it is the documented procedure and it has
been used correctly each time — but it treats the symptom. Three failures in three
different tasks on one day, two of them with no diagnostic whatsoever, is a
pattern, and the pattern is what needs a decision.

## Options

1. **Find the post-reporter exit.** The strongest lever, because #3 is a *test*
   task that exits 1 after writing a complete green junit. Candidate causes to
   separate, in order of how cheaply they can be told apart: an unhandled
   rejection after the reporter runs; a `process.exitCode` left set by a test that
   completes; and a failing cleanup/teardown. Bun's `--reporter-outfile` ordering
   makes the junit untrustworthy as a pass/fail oracle for *this* failure mode, so
   the `unit results (windows)` job that the conformance gate already consumes
   should not be treated as authoritative either until this is understood.
2. **Give the destructive steps bounded retries.** `maxRetries`/`retryDelay`
   where the pipeline removes and recreates generated trees (Vite's
   `emptyOutDir`; the `rm -rf dist tsconfig.tsbuildinfo` the compile tasks
   already run). This addresses #1's mechanism, which is the one occurrence that
   named a cause. Node's `fs.rmSync(recursive)` has known `ENOTEMPTY`/`EPERM`
   behaviour on Windows when a handle is still open, and Vite's `emptyOutDir`
   passes no `maxRetries`.
3. **Serialise the unit pipeline on Windows.** `turbo` already runs tasks
   concurrently; forcing `--concurrency=1` for `unit (windows)` would remove
   writer/writer races by construction, at the cost of wall-clock on every run.
   This is a workflow change under `.github/**`, which the current mandate does
   authorise, but it trades throughput for reliability across the whole suite and
   should be a deliberate choice. It also would not fix #3, which is not a race —
   which is a reason not to reach for it first.

Recommendation: pursue option 1, because it is the only one that addresses the
occurrence that recurred in a *test* task with no output. Option 2 is a
well-understood fix for the one occurrence that named its cause. Option 3 last, and
not as a reflex.

## What was explicitly not done

No timeout was raised, no test was skipped or re-serialised, no build script was
edited, and the three PRs involved were merged only after their rerun on the
**identical head** was green. The failures are recorded here as what they are:
unattributed Windows build failures in the unit pipeline, not regressions, and not
flakes in the test suite — the suite passed every time.
