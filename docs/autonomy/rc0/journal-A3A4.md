<!-- SPDX-License-Identifier: MIT -->
# journal-A3A4 — Lane A, RC-0 release-1 push (cards A1, A3, A4)

**Scope:** `packages/app/e2e/**`, `packages/unifia/test/**`, `scripts/**`.
**Base:** `origin/dev`. **Worktree:** `D:\App\unifia\_rc0-laneA`.
**Cards:** A1 (QA01, #59), A3 (QA03, #58), A4 (QA10).  Card A2 is in `journal-A.md`.

`EXECUTION-LOG.md` is never edited from this lane. Anything outside the scope above is recorded as
`NEEDS-OWNER` with the exact patch. Every claim below is an executed measurement; where something could not
be reproduced, that is said rather than papered over.

| Card | Status | PR |
|---|---|---|
| A3 e2e measurement + classification | DONE | #317 → `594e3cee7e` |
| A4 branch policy | DONE | #317 → `594e3cee7e` |
| A1 #59 check-duplicates | NEEDS-OWNER (lane D) | — |

---

## A1 (#59) — `check-duplicates` never reports: NEEDS-OWNER for lane D

`.github/**` is outside this lane's write scope, and D11 reserves workflow changes for the owner.

A fix was already attempted: `684248b1bf refactor(ci): skip the upstream-only check-duplicates jobs on this fork
(QA01)`, 2026-09-30. Both jobs carry a guard naming this issue, verified byte-for-byte through
`gh api repos/Rwanbt/unifia/contents/.github/workflows/pr-management.yml?ref=dev`. **The guard does not work**,
and that is the finding.

Job 111837388587 in run 37332065713 (PR #294), which never completed:

```
JOB add-contributor-label  completed/success
   labels=ubuntu-latest   runner_id=1000031012   runner_name=GitHub Actions 1000031012
   2026-10-05T15:20:49Z -> 15:20:51Z   steps=3
JOB check-duplicates      queued
   labels=blacksmith-4vcpu-ubuntu-2404   runner_id=0   runner_name=
   2026-10-05T15:20:47Z -> <never>   steps=0
```

Two things fall out, and together they are the whole diagnosis:

1. **Actions is healthy** — the sibling job in the *same run* got a runner and finished in 2 s. So this is not
   the runner saturation that has other workflows queued right now; it is specific to the Blacksmith label.
2. **The job is created and queued anyway.** The label is resolved, `runner_id=0`, `steps=0`: GitHub searched
   for a runner this fork does not have and keeps waiting. A job-level `if:` that is false does not stop the
   run being queued against its `runs-on` label — so the guard added on 2026-09-30 is the wrong lever, which
   is why #59 was closed as fixed and is still open in fact.

Not one stale PR: **12 consecutive `pr-management` runs**, 2026-10-05T16:49Z → 20:44Z, all `queued`, none
`completed`, across nine agent branches. A stale check run is ruled out — the queued job carries today's
`started_at` and a resolved label, not an old job ID.

### NEEDS-OWNER — exact patch for lane D, `.github/workflows/pr-management.yml`

Make the job schedulable here, and move the fork check out of the job-level `if:` into a step that reports:

```yaml
  check-duplicates:
    # WHY: upstream-only job. It previously also needed blacksmith runners, which is
    # what left the check queued forever on this fork (issue #59).
    #
    # A job-level `if:` is NOT sufficient: with the guard below, GitHub still created
    # the job and queued it against `blacksmith-4vcpu-ubuntu-2404`, runner_id=0,
    # steps=0, forever — measured on PR #294 and across 12 consecutive runs. The job
    # has to be schedulable, and the fork check has to live in a step.
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - name: Nothing to do on a fork
        if: github.repository != 'anomalyco/opencode'
        run: echo "check-duplicates is upstream-only; skipping on ${{ github.repository }}"

      - name: Checkout repository
        if: github.repository == 'anomalyco/opencode'
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      # ... every remaining step gains the same `if: github.repository == 'anomalyco/opencode'`
```

On this fork the job schedules, the first step runs, the rest are skipped, and `check-duplicates` reports
**success** — so it can be required and will never block a PR. Upstream is unchanged apart from
`ubuntu-latest`. `duplicate-issues.yml` needs the same treatment for its identically-guarded
`blacksmith-4vcpu-ubuntu-2404` job; it is triggered on `issues`, so it does not block merging today but will
hang on every new issue.

**Not DONE**, and cannot be from this lane: it needs `.github/**`, and the criterion "a PR run shows the check
reporting, proven by `gh pr checks`" is only observable once the patch lands.

---

## A3 (#58) — e2e re-measurement on a clean clone of origin/dev

Clean clone, **not** a worktree — the 2026-10-02 section of the classification doc records a worktree baseline
being thrown away as an artifact:

```
clone   git clone --branch dev --single-branch https://github.com/Rwanbt/unifia.git
SHA     a71cd08d2  test(voice): refuse a tampered model artifact, and close four integrity gaps (#305)
config  PLAYWRIGHT_WORKERS=1  PLAYWRIGHT_RETRIES=0  real backend  terminal specs enabled
result  247 passed   52 failed   5 did not run   1.3h
```

One worker, zero retries: a count that moves when the worker count moves is not a classification.

| baseline | SHA | pass | fail |
|---|---|---|---|
| `RC0-E2E-BASELINE-20261003.md` | `fixed9f69f9c` | 203 | 98 |
| full run | `8777452c46` | 240 | 59 |
| full run | `e849922c98` | 247 | 51 |
| **this run** | **`a71cd08d2`** | **247** | **52** |

Flattened at ~50 across two runs, so "keep merging and it will clear" is refuted by two consecutive
measurements. Composition, evidence and owners are in `docs/audit/RC0-E2E-CLASSIFICATION.md`:

| group | n | class | owner |
|---|---|---|---|
| G1 design-visual baselines | 8 | STALE-SPEC | lane A (D14) |
| G2 canvas interaction | 8 | **PRODUCT-BUG** | lane B |
| G3 v110 responsive family | 5 | STALE-SPEC | lane A |
| G4 projects / sidebar navigation | 5 | STALE-SPEC | lane A |
| G5 modes / web bridge | 5 | MIXED, needs a probe | lane A + lane B |
| G6 prompt / shell | 4 | STALE-SPEC | lane A |
| G7 session model persistence | 3 | STALE-SPEC | lane A |
| G8 sidebar popover | 3 | STALE-SPEC | lane A |
| G9 single-file / unclassified | 11 | unclassified | lane A |

Two results worth stating separately:

- **G2 is the largest PRODUCT-BUG group and it is not a locator problem.** All 8 canvas failures fail on a
  product invariant *after* the gesture, and the suite names the invariant in the error: `publishing must commit
  one addComment`, `the drag must persist a canonical transform`, `the dragged pen point must become a cubic
  segment`, `the sibling edge must snap`. The surface renders, the pointer drag lands, the document is not
  updated. The canvas commit/serialise path is wrong, not the spec. Needs a failing unit test in
  `packages/unifia/src` — outside this lane.
- **`design-a11y:45` is worse than a failure**: `axe found no element for its include selector`. The a11y gate
  resolved nothing and still reported. A gate that cannot fail has stopped being one.

**Nothing is called flaky.** No group has five repeated runs, so under this programme's rule none may be.

**The CI cross-check is unavailable, and that is recorded too.** `e2e (linux)` is not required and does not
finish: `EXECUTION-LOG.md` 2026-10-04 16:20 measured it hitting the 110-minute ceiling. This run confirms the
`port-gate` cluster it died on is gone (#271) — `port-gate` does not appear in the 52 — but the job still
overruns, so "CI agrees" is unavailable as a second opinion on any row above.

**A correction made before publishing.** The group counts were written from the tail of the log and recounted
from the full failure list afterwards; two were wrong in the first draft — G1 is **8**, not 9, and G9 is **11**,
not 9. One line (`v110-shell-gate.spec.ts:86`) sits outside any subdirectory and was missed by the first
per-spec grouping, which is what exposed the discrepancy. The nine groups now sum to 52.

---

## A4 (QA10) — branch policy

**DONE** (document only, nothing changed). `docs/autonomy/rc0/BRANCH-POLICY.md`, written from measured API
output:

```
gh api repos/Rwanbt/unifia/branches/dev/protection   -> 200, 7 required contexts
gh api repos/Rwanbt/unifia/branches/main/protection  -> 200, the same 7
gh api repos/Rwanbt/unifia --jq '.default_branch'    -> main
```

The seven: `check-compliance`, `check-standards`, `conformance`, `rust unit tests`,
`sdk in sync with server`, `unit (linux)`, `unit (windows)`.

The findings that are not visible from the workflow files:

1. **`strict: false` on both branches** — a PR is judged on its head only, so a green PR can go red on merge
   without being re-run. Squash promptly after a green head.
2. **No review requirement on `dev` at all** — no `required_pull_request_reviews` key. Every lane PR merges
   into `dev` with zero human review. Intended under D11, but it means the seven checks are the *only* gate
   there.
3. **`enforce_admins: false` on both** — protection does not apply to admins, so `required_linear_history` and
   the no-force-push setting are conventions rather than enforced boundaries. The widest gap between what the
   policy says and what it holds.
4. **`required_linear_history: true` on both** — which is why every PR here merges by squash.
5. `main` additionally requires 1 approving review with `dismiss_stale_reviews: true`.
6. **Not required, though they run:** `typecheck`, `check`, `e2e (linux)`, `merge-and-size`, `nix-eval`,
   `schema-and-snapshot`, `snapshot-freshness`, `CodeQL`, `Analyze`.

`check-duplicates` is **not** required on either branch, so it does not block merging today — but adding it
as-is turns every PR unmergeable, per card A1.

---

## Merges and the CI gate

| PR | SHA | Contents |
|---|---|---|
| #310 | `939441437c` | `fix(test)`: the five harness fixes above, +141/-17 |
| #317 | `594e3cee7e` | `docs`: BRANCH-POLICY.md + the new e2e measurement, +354 |
| #323 | `1da85db05e` | `docs`: this journal, part 1 |

`rust unit tests` on #310 first returned `cancelled` with `steps=0`. That is not a failure: nine other jobs on
the same PR reported `fail` all at 15m0x-15m2x, the signature of cancellation rather than of running code, and
at one point 12 of the 30 most recent runs were `queued` because four agents were pushing simultaneously.
Re-running the cancelled jobs cleared them. `rust unit tests` needed a second attempt because its run was still
`in_progress` while `e2e (linux)` held it, and `gh run rerun` refuses a run that is still going.

**`unit (windows)` is green on three consecutive PR heads** — `e9757e5417` (#310), `29cdf245ac` (#317) and
`b5e84c233a`/#323 — which is A2's criterion.

**`merge-and-size` stays red and is not a size problem.** The log says `fatal: refusing to merge unrelated
histories`, exit 128: `work-design-integrity.yml` does `git fetch origin dev --depth=1` then `git merge-tree
--write-tree origin/dev HEAD`, and with a depth-1 fetch of a base that is not an ancestor of a shallow head,
merge-tree reports unrelated histories. Not a required check, so not investigated further; recorded because
"PR size limit exceeded" is what the next person will assume.

### A2 is NOT closed, and why

- **#57 was never reproduced** — ten green runs, and a pollution experiment that *passed*. The test is
  hardened against two measured hazards; the CI failure is not claimed fixed. Both remaining candidates are
  product-side and out of scope.
- **#56 is half addressed** — the FakeConnector race is fixed and proven; the `BrowserOpenFailed` 180 s hang is
  a product defect filed above as NEEDS-OWNER, and the test was reverted rather than patched because every
  workaround was tried and each was worse.

Neither issue is closed by #310. Both stay open for the owner.
