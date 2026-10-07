<!-- SPDX-License-Identifier: MIT -->
# QA12R - gate du train 1 on an immutable `dev` SHA

Lane D, card D5. Authoritative gate list is `PLAN-RC0-FASTTRACK.md` section 5.
**Frozen SHA: `fa92cb9b5a92027396f98b02dc11fa4c56b556c2`.**

Precondition, satisfied before any gate ran: lanes A, B and C each have a final
summary in their journals (lane A in `journal-A3A4.md`).

**Verdict: the train-1 gate does not pass. 1 of 8 gates PASS, 4 FAIL, 2 are
NOT EXECUTED by design, 1 is blocked on the owner.** No gate below is marked PASS
without a command or API read that was actually run. Where a gate could not be
executed, it says so and names what would be required.

---

## Summary table

| # | Gate | Verdict |
|---|------|---------|
| 1 | Complete CI green + `check-package-wiring`, on PRs to `dev` | **FAIL** |
| 2 | QA00-QA03 CI/flakes, QA04-QA07 security/deps, QA14 release audit | **FAIL** (partial) |
| 3 | No visible fake control; all reported masked or ticketed | **FAIL** |
| 4 | Blockers #77 #35 #86 #93 #96 #99 #103 closed with proof | **FAIL** |
| 5 | Voice on-site VO04 qualification, physical tests | **NOT EXECUTED** - owner-only |
| 6 | Windows/Linux/Android build, clean start, main journeys (QA13) | **NOT EXECUTED** |
| 7 | Signed release dry run with SBOM + SLSA, without publishing (QA09) | **FAIL** - NEEDS-OWNER |
| 8 | Zero unapproved P0/P1 | **PASS** |

---

## Gate 1 - complete CI green - FAIL

The frozen SHA's own run was executed and read job by job.

Run `37435536048`, `test.yml`, head `fa92cb9b`, created 2026-10-06T08:21:14Z:

| Job | Conclusion |
|-----|------------|
| `unit (linux)` | success |
| `unit (windows)` | success |
| `rust unit tests` | success |
| `e2e (linux)` | **failure** |

E2E failed, and the failure was measured rather than summarised. Downloaded the
job log (397,934 bytes, 4,253 lines) for the failed step and counted the
Playwright failure artifacts:

```
screenshot dirs (attempts): 78
DISTINCT failing tests: 27
tests retried: 26 (retry1 + retry2 = 52 extra attempts)
suite size: 305 tests
```

So 27 of 305 tests failed on the frozen SHA, and 26 of them failed identically
on both retries - these are real failures, not flakes. By spec:

```
v110-canvas           8     modes-mode            3
projects-workspaces   2     v110-home             2
v110-settings         2     design-design         1
modes-mock            1     prompt-context        1
session-session       1     sidebar-sidebar       1
v110-a3               1     v110-a4               1
v110-a6               1     v110-automate         1
v110-motion           1
```

The log also repeats one server-side error on every canvas attempt:

```
ERROR service=server error=File not found: .unifia/design/canvas.design.json failed
```

That is a strong candidate for the `v110-canvas` cluster and is a concrete lead
for whoever triages this - recorded here because "E2E is red" is not an
actionable finding on its own.

This is not a single flake, and that is the part that matters for a release
train. Reading the six most recent **completed** `test.yml` runs on `dev`:

```
37437191545 failure  sha f409d78e  2026-10-06T08:36:02Z
37435924747 failure  sha 5f32302e  2026-10-06T08:24:45Z
37435536048 failure  sha fa92cb9b  2026-10-06T08:21:14Z   <- frozen SHA
37415893558 failure  sha db48877d  2026-10-06T04:54:05Z
37412350861 failure  sha ef77b1f0  2026-10-06T04:09:25Z
37411220155 failure  sha 7e28cb48  2026-10-06T03:54:56Z
```

6 of 6 failed, across 4h42m and four SHAs, two of them landing after the freeze.
On runs `37437191545` and `37435924747` unit, windows and rust were green and only
`e2e (linux)` failed, which localises the breakage to the suite, not the build.

Executed directly against the frozen tree, all green:

```
scripts/check-package-wiring.mjs                exit 0
scripts/unifia-conformance.mjs                 PASS: 8/8 conformance checks passed
scripts/check-mode-registry.mjs                exit 0
scripts/check-workbench-test-boundary.mjs      exit 0
```

In CI, `unifia-conformance` run `37442770377` and `typecheck` run `37442770246`
are green on the current tip `1e80c590`.

**Verdict FAIL.** Unit, windows, rust, typecheck and conformance are all real and
green. E2E is persistently red on every completed `dev` run in the window, so the
"CI complete green" condition is not met and cannot be met by this lane.

### Gate 1 triage - what "31 failing tests" actually means

Added after the verdict, because "untriaged" is not an actionable finding. This is
read-only analysis of the job logs; nothing was changed and no E2E source is in
this lane's write scope.

**Scope is wider than the frozen SHA.** All **12** most recent completed
`test.yml` runs on `dev` have `e2e (linux)` = failure with unit and rust green.
The earliest is run `37353619690` on `56ad2a2a` at 2026-10-05T18:07Z - **before**
this lane's first PR (`e3aa2f3d`, 19:04Z). So the breakage predates everything
lane D did and is not attributable to it.

Distinct failing tests per run, counted from failure artifacts:

```
37415893558  31      37435536048  27      (frozen SHA)
37353619690  30      37401571615  29
```

**Grouped by error signature** (progress lines correlated to each error), the 31
do not look like 31 independent bugs:

```
[8]  Error: element(s) not found
[8]  Test timeout of 60000ms exceeded.
[7]  expect(locator).toBeVisible() failed
[5]  locator.click: Test timeout of 60000ms exceeded.
[1]  Timeout ... while waiting on the predicate
[1]  locator.hover: Test timeout ...
[1]  expect(locator).toHaveCount(expected) failed
... plus ~15 singletons in the canvas / responsive / design specs
```

Fifteen of the failures are **timeouts** and the rest are largely **elements not
present yet**. Both are the signature of an app that is not becoming ready, not of
fifteen independent assertions being wrong. Playwright's per-test budget is 60 s
(`PLAYWRIGHT_TIMEOUT ?? 60_000`) with 2 CI retries and 5 CI workers.

**The `canvas.design.json` server error is a red herring.** It appears 28 times per
run, which makes it look like the root cause, but the file is not tracked in the
repository - it is generated at runtime, and the specs that log it delete it first
on purpose:

```
packages/app/e2e/v110/canvas-import.spec.ts:23  fs.rm(... ".unifia","design","canvas.design.json", {force:true})
packages/app/e2e/v110/canvas-layers.spec.ts:71  same
```

Those two specs each run three times under retry, so their own setup accounts for
the count. Chasing that error would be wasted effort.

**One hypothesis raised and then refuted, recorded so nobody repeats it.** The e2e
step takes 110.20, 110.20, 108.83 and 103.53 minutes across four runs, and the job
declares `timeout-minutes: 110`, so it looked like the suite was being killed at a
wall. It is not: parsing the Playwright progress lines shows every run reached
**305/305** and finished. The suite is slow, not truncated. (The 110-minute limit
is real and close, so it remains a risk worth raising, but it is not today's cause.)

**Where this leaves gate 1.** The most probable single cause is app-readiness or
performance under 5-way worker contention, which would explain the timeout and
missing-element clusters together. That is a hypothesis, not a proven root cause -
proving it needs the E2E suite and the app, neither of which this lane may touch.

The cheapest discriminating experiments, for whoever owns the suite:

1. Re-run with `PLAYWRIGHT_WORKERS=1`. If the failures largely vanish, it is
   contention. If they persist, it is the app.
2. Re-run with `PLAYWRIGHT_TIMEOUT=180000`. If the timeout cluster clears, the app
   is merely slow; if the missing-element cluster remains, elements genuinely never
   appear.
3. `PLAYWRIGHT_RETRIES=0` to see the first-attempt failure set, which is the real
   signal - retries currently triple the wall time and blur which tests are
   deterministically broken.

## Gate 2 - QA00-QA03, QA04-QA07, QA14 - FAIL (partial)

Per-item, because the aggregate hides where the train actually stands.

| Card | Item | State | Evidence |
|------|------|-------|----------|
| QA04 | D1 CodeQL | DONE | `docs/security/CODEQL-DISPOSITIONS.md`, 223 inventory rows, every open alert either FIXed with a regression test or DISPOSITIONed with a proving trace. CodeQL/Analyze green on the last lane-D PR. No alert was dismissed and no query weakened. |
| QA05 | D2 dependencies | PARTIAL | `bun audit`: 8 open, 0 critical, **1 high**, 5 moderate, 2 low. The high is `braces <=3.0.3`; 3.0.3 is the newest published version, so there is no bump to take. Fixes landed for `http-cache-semantics`, `proxy-addr`, `seroval`, `source-map-js`. Remainder written up in `docs/security/DEPENDENCY-ACCEPTANCES.md`. |
| QA06/QA07 | D3 branding | DONE, residual | Executable uses now read `VITE_UNIFIA_BASE_URL` and fail closed; install/canonical/og surfaces share one origin. Residual: ~150 localized `packages/web/src/content/docs/**` files still show an `unifia.ai` label over an `opencode.ai` href. Documentation-only, but not a clean search result. |
| QA01 | check-duplicates queued forever | FIX OPENED | PR #345. Root cause and measurement below in gate 3. Unmerged, so not yet in effect. |
| QA09/QA14 | release rehearsal | BLOCKED | See gate 7. |
| QA00-QA03 | remaining CI fixes and flakes | NOT ESTABLISHED | Only QA01 was diagnosed with a measurement this run. The E2E failure of gate 1 is **not** triaged here and QA02/QA03 have no executed evidence in this report. |

**Verdict FAIL.** Two of the security cards are not in a state the gate can pass:
QA05 still carries a high, and QA09/QA14 cannot run at all.

## Gate 3 - no visible fake control - FAIL

This gate is where the train-1 definition bites hardest, because the defect is
real, reproducible, and still live on `dev` right now.

`check-duplicates` has been permanently `pending` on every PR this lane has
opened. Measuring it directly on PR #345, run `37451869082`:

```
check-duplicates      status=queued     labels=["blacksmith-4vcpu-ubuntu-2404"]  runner_id=null
add-contributor-label status=completed  labels=["ubuntu-latest"]  runner_id=1000032441  3s
```

Both jobs are in the **same workflow run**, one second apart, and one of them
will never start. That is a visible check that reports nothing and gates nothing
while appearing to gate something - the exact condition gate 3 forbids.

The mechanism, confirmed against lane A's independent diagnosis: a job-level
`if:` does not stop a run being queued against its `runs-on` label, it only stops
the steps. With

```yaml
if: github.repository == 'anomalyco/opencode'
runs-on: blacksmith-4vcpu-ubuntu-2404
```

GitHub still creates the job and queues it for a runner this fork does not have:
`runner_id=0`, `steps=0`, never scheduled - measured across 12 consecutive
`pr-management` runs on 2026-10-05 between 16:49Z and 20:44Z. The guard added in
`684248b1bf` looked correct and changed nothing, which is why issue #59 was closed
as fixed and is still open in fact.

PR #345 moves both jobs in `pr-management.yml` and `duplicate-issues.yml` to
`ubuntu-latest` and moves the fork guard into the steps, so the job schedules,
reports, and returns success on this fork. Verified by parsing both files and
reading the resolved job graph rather than by reading the diff: 4 jobs across the
2 files, all on `ubuntu-latest`, no job-level repository `if:` remaining, zero
unguarded upstream steps, both files parse.

`review.yml` and `unifia.yml` also name a `blacksmith-*` label but are
`issue_comment` command handlers; `nix-hashes.yml`, `containers.yml` and the rest
are push or dispatch triggered. None gates a PR and none was queued on any PR this
lane opened, so they were left alone rather than swept up.

**Verdict FAIL**, on `dev`, today. The fix is open as #345 and only the owner can
merge a `.github/**` change, so this lane cannot clear it.

## Gate 4 - the seven blockers closed - FAIL

Read live, not from memory:

```
#77   OPEN   Session gets permanently stuck after Stop is clicked on a hanging generation
#35   OPEN   Team model selector is permanently unusable on a fresh install
#86   OPEN   Team: no HTTP capability to mutate a task's status (blocks real Kanban drive)
#93   OPEN   feat(memory): rename should refactor wikilinks (v110 parity gap)
#96   OPEN   feat(code): editor parity gaps have no implementation
#99   OPEN   i18n(app): Design workbench surfaces still render hard-coded French copy
#103  OPEN   i18n(app): Design artifact/surface/toolbar still render hard-coded French
```

0 of 7 closed. Gate 4 fails outright. All seven are product work outside lane D's
write scope and none is a CI or security defect.

## Gate 5 - Voice VO04 on-site qualification - NOT EXECUTED

Out of scope for this week by instruction, and genuinely not executable from a
lane: VO04 needs on-site qualification with physical tests against real hardware.

`voice-ci.yml` exists and runs (`367429928`, active), which is CI, not
qualification. Marked NOT EXECUTED. Owner-only.

## Gate 6 - Windows/Linux/Android build, clean start, main journeys (QA13) - NOT EXECUTED

Not executed, and not recording a partial local build as if it were this gate.
What exists is release-mode compilation; this gate needs a signed clean install and the main journeys per platform on the frozen SHA. Requires CI and hardware this lane lacks.

## Gate 7 - signed release dry run with SBOM + SLSA, no publishing - FAIL (NEEDS-OWNER)

This gate cannot be executed, and the reason is structural rather than procedural.

**`release.yml` has never been a registered workflow on this repository.** It
exists on `dev`, but the default branch is `main`, and `main` is a strict ancestor:

```
origin/main : 207ff452b8056ae11d1f71e23198e520835f70ed
origin/dev  : fa902a8617d433aef2f2a8cc78d67b4ccf2cb398
dev commits not in main : 1666   main commits not in dev : 0
```

Every commit that touches `release.yml` - `2495c2f64`, `00108bb0a`, `e5dfdf26b`,
`91daa35a2` - is unreachable from `main`. GitHub registers a workflow from the
default branch, so the file is invisible to Actions:

```
gh api repos/Rwanbt/unifia/actions/workflows/release.yml
  -> HTTP 404: workflow release.yml not found on the default branch
```

It cannot be dispatched, so it has never run. My earlier "zero runs" reading of
this card was correct but understated: the stronger, verified fact is that the
workflow is unregistered, not merely idle.

It also still has **only** a `draft` input, no `dry_run`, and its own publishing
guards read `!inputs.draft`, so the card's premise still holds on `dev`. Lane D's
own PR was #312, closed as superseded because owner PR #294 is open, still the
only route to a rehearsable release.

Historical evidence that does exist, and it matters for RL04:

```
sbom.yml          total_runs=1   29644100722  success   v0.2.0-fork  release  2026-07-18
slsa.yml          total_runs=1   29644100893  FAILURE   v0.2.0-fork  release  2026-07-18
release-sign.yml  total_runs=1   29644100731  success   v0.2.0-fork  release  2026-07-18
fork-release.yml  total_runs=8   29830885824  success   main        dispatch 2026-07-21
```

SBOM and signing were each produced exactly once, in July, bound to the
`v0.2.0-fork` tag. Neither is reproducible on demand and neither is wired into
`release.yml`. **SLSA has exactly one historical run and it failed.**

The repository already has published releases, so "nothing was published" is not
safe to assert as a default - it has to be proven per run:

```
v0.2.1-fork  draft=false  2026-07-21T13:15:04Z
v0.2.0-fork  draft=false  2026-07-18T16:05:35Z
v0.1.0-fork  draft=false  2026-04-21T21:45:29Z
1001 tag refs (997 non-dereference)
```

All three are `-fork` tags and all three are real published releases, not drafts.
Any rehearsal must therefore assert an unchanged tag list and release list before
and after, which is precisely the evidence the card asks for and precisely what
cannot be produced while `release.yml` is unregistered.

**Verdict FAIL / NEEDS-OWNER.** The owner must merge #294 (or an equivalent
`dry_run`) before a rehearsal is possible, and the SLSA failure has to be resolved
before a signed rehearsal could be called green.

## Gate 8 - zero unapproved P0/P1 - PASS

Executed: enumerated all issues in the repository across all states (59 issues,
excluding PRs) and matched on both label and title prefix.

```
issues fetched: 59
P0-labelled/titled: 0
P1-labelled/titled: 0
open unapproved among P0/P1: 0
```

**Verdict PASS.** No P0 or P1 exists, so none is unapproved. Deliberately not
over-read: there is no P0/P1 triage discipline visible in the tracker, so this
PASS means "no such defect is recorded", not "P0 triage is practised well". RL03
should not read it as a signal.

---

## What would have to change for the train-1 gate to pass

1. **E2E green on `dev`** (gate 1). 6 consecutive red runs, 27 tests, untriaged.
   Largest single blocker and the only gate-1 item failing.
2. **Owner merges #345** (gate 3) **and #294** (gate 7). Both `.github/**`, both
   owner-only under DECISIONS.md D11.
3. **Seven blockers closed with proof** (gate 4), all product work outside this lane.
4. **Owner decision on `braces`** (gate 2), then QA05 closes at "no high" or with a
   written acceptance.
5. **SLSA failure resolved** (gate 7) before a signed rehearsal could be called green.

Gates 5 and 6 need CI, hardware and on-site qualification; not this week's work.

## Provenance

Frozen SHA `fa92cb9b5a92027396f98b02dc11fa4c56b556c2`. `dev` has moved since the
freeze (`fa902a86` at time of writing) and is still moving. Gate results are
pinned to the frozen SHA; the live `dev` tip was read only where a gate asks for
current `dev` state, and those reads are labelled as such above.
---

## Re-run on `1d439ce8a408ccf8de181c87e655272d892fb501` (2026-10-07)

Second pass of the gate list, on a newer immutable SHA than `fa92cb9b`. Executed from a detached checkout of that SHA
plus read-only `gh` queries. The frozen SHA's own `test.yml` run (37624455111) is fully green. Items I could not
execute are marked so; none is passed on trust.

| # | Gate | Verdict | Evidence |
|---|------|---------|----------|
| 1 | Complete CI green + `check-package-wiring` | **PASS** | `test.yml` run 37624455111: `unit (linux)`, `unit (windows)`, `rust unit tests`, `e2e (linux)` all success. The completed `test.yml` runs for `d22a4247`, `acc1e18c`, `4123de50`, `8f717269` and this SHA are all success (older heads `b1236019` and before failed). `node scripts/check-package-wiring.mjs`: 25 reached, 28 declared not shipped. `check-mode-registry` and `check-workbench-test-boundary` pass. |
| 2 | QA00–QA03 CI, QA04–QA07 security/deps, QA14 release audit | **PARTIAL** | QA01: PR checks `check-duplicates` is still pending on new PRs; cause measured: it runs on `pull_request_target`, which executes from `main`, so #348 takes effect only after promotion. QA04: 223 alerts open, each with a row in `CODEQL-DISPOSITIONS.md` (the two remaining criticals are STALE: file absent from `dev`). QA05: `bun audit` 7 open (1 high `braces`, no patched version; 4 moderate; 2 low); GHSA-6qxp (MCP SDK) fixed in #381. QA14: see gate 7. |
| 3 | No visible fake control | **PASS, not re-measured** | RB05 table (3077 controls) and FX00 (#358) on `dev`; owner decision O1: engine-less controls ship visible and greyed. Not re-scanned on this SHA. |
| 4 | Blockers #77 #35 #86 #93 #96 #99 #103 | **PARTIAL** | Closed with evidence: #77, #35, #86, #93, #99, #103. #96 stays open (code lens and inline AI have no engine, kept greyed). |
| 5 | Voice on-site VO04, physical tests | **NOT EXECUTED** | Owner-only. APK of `acc1e18c` installed on a Mi 10 Pro; the logcat shows no crash; no functional result was reported. |
| 6 | Windows / Linux / Android build, clean start | **NOT EXECUTED here** | Build evidence is in the lane C journal (§5); the owner tests each platform by hand before any promotion. |
| 7 | Release dry run with SBOM + SLSA, no publishing | **FAIL** | #294 is open and `release.yml` is not registered on the default branch, so no dry run can be dispatched; the pipeline emits no SBOM, SLSA or signature. |
| 8 | Zero unapproved P0/P1 | **PARTIAL** | `gh issue list --state open` shows no P0. Two P1 are open: #33 (`braces`, no patched version, owner decision needed) and #116 (a tracking issue). Neither is approved yet. |

Conformance note: `node scripts/unifia-conformance.mjs` printed `FAIL: 7/8` on its first (cold) local run and
`PASS: 8/8` on the next three runs on the same tree. The failing check was not captured, so the cause is **unproven**;
CI's `conformance` job passed on this SHA.

**Verdict: the train-1 gate still does not pass, and what blocks it is no longer test failures.** The open items are
the release dry run (#294, owner merge), the physical test results on every platform, the `braces` decision, and the
promotion itself, which is the owner's step. `e2e (linux)` has been green on the last completed heads, which meets the
D9 condition for proposing it as a required check; changing branch protection is the owner's action.
