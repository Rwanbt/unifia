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

---

## Lane A - final summary

Every card is closed. Five PRs, all squash-merged into `dev`, all with the seven required checks plus CodeQL and
Analyze green on the exact head.

| PR | merge SHA | contents |
|---|---|---|
| #310 | `939441437c` | `fix(test): make the Windows unit suite deterministic` - the five harness fixes, +141/-17 |
| #317 | `594e3cee7e` | `docs`: `BRANCH-POLICY.md` + the new e2e measurement section, +354 |
| #323 | `1da85db05e` | `docs`: journal part 1 (flattened by a bad PowerShell write, superseded by #324) |
| #324 | `93b4706bc` | `docs`: `journal-A.md` for card A2, rewritten with its line breaks restored |
| #328 | `ef77b1f03` | `docs`: `journal-A3A4.md` for cards A1, A3, A4 |

### Card status

| Card | Status | Evidence |
|---|---|---|
| **A2** unit suite green | **DONE** | three consecutive `bun test --timeout 180000` in `packages/unifia`: `5336 pass / 0 fail / exit 0` (1162s, 977s, 720s), against a `5332 pass / 4 fail` baseline; `unit (windows)` green on three consecutive PR heads |
| **A4** branch policy | **DONE** | both branches read with `gh api repos/Rwanbt/unifia/branches/<b>/protection`, both `200` |
| **A3** e2e classification | **DONE** | one full run, clean clone of `a71cd08d2`, `PLAYWRIGHT_WORKERS=1`, `PLAYWRIGHT_RETRIES=0`: `247 passed / 52 failed / 5 did not run`, all 52 grouped with an owner; #58 closed as completed with the merge SHA |
| **A2 / #284** | **NEEDS-OWNER** lane B | cause proven with the exact stack; failing test written and measured 5/5 failing; `client.ts` patch posted |
| **A1 / #59** | **NEEDS-OWNER** lane D | `runner_id=0`, `steps=0`, 12 consecutive runs queued; the job-level `if:` guard does not prevent queueing; `.github/**` is owner-only |
| **A2 / #56 (a)** | **DONE** | race proven, 1 of 25 boundary-aligned pairs; 5 runs, `20 pass / 0 fail` |
| **A2 / #56 (b)** | **NEEDS-OWNER** lane B | 5 runs green, cause is a dangling promise at `src/mcp/index.ts:850`; test reverted on purpose |
| **A2 / #57** | hardened, **not claimed fixed** | 10 green runs; the pollution hypothesis was tested and withdrawn |

Issues: **#58 closed** as completed, merge SHA `ef77b1f03eb70d3d67709e8e7f75d617d772cf5f`. **#56, #57, #59, #284
left open** with a comment on each giving the measurement and naming exactly what blocks it - three need a
product or `.github/**` change that is not in this lane's scope, and #57 was never reproduced, so closing it
would claim a fix that was never demonstrated.

### What is left for the next agent

1. **Lane B, #284** - land the failing test from `journal-A.md` together with the `client.ts` patch. Acceptance
   unchanged: the test passes and `unit (windows)` reports no unhandled error between tests across three runs.
2. **Lane B, #56 (b)** - one line in `src/mcp/index.ts`. The patch is in `journal-A.md`; the fixed 2 s sleep in
   `oauth-browser.test.ts` can then become a condition wait, but not before.
3. **Lane B, A3 G2** - the canvas PRODUCT-BUG cluster, 8 failures, needs a failing unit test in
   `packages/unifia/src`. This is the largest cluster in the suite and the only one where the product is wrong.
4. **Lane D, #59** - the workflow patch. Until it lands, expect `check-duplicates` to sit `pending` forever on
   every PR; it is not a required check, so nothing is blocked, but it must not be added to the required list
   as-is.
5. **Lane A, the queued A3 groups** - 25 STALE-SPEC failures across G1, G3, G4, G6, G7 and G8, one group per PR.
   G1 is already decided by D14 (fix the project identity to a fixed fixture, then regenerate the baselines).

### Three things this lane got wrong, kept because they are the useful part

- **The 5 s SIGKILL hypothesis.** The first guess for the plugin `exit 9` was `Process.run`'s
  `opts.timeout ?? 5_000`. Measurement refuted it: that timer is only armed inside `abort()`. It was acted on
  before being checked, and the record of that is worth more than the guess was.
- **The instance-capacity pollution hypothesis.** 95 files share the cache and only 46 dispose, which looks like
  the bug. A pollution experiment **passed**, so it is withdrawn rather than quietly kept as a "fix".
- **The flattened journal.** #323 committed `journal-A.md` as a single 12 kB line, because a PowerShell
  `Set-Content -NoNewline` on an array joined it. #324 is a fix-forward that restores the structure. Worth
  knowing that the file on `dev` between those two SHAs was unreadable.

---

## A3 remediation, group 1 of 6: G3 / a6-responsive — DONE

**PR #341, squash `1e80c590408112a37fbaf015a9f1873cd5b99e5d`.** One group per PR. 52 → 51 failures.

The card said to *fix* the groups, not only to classify them. Classification is done; this is the first
remediation, and the first one that could be closed with executed proof.

**What was wrong, and why a locator rename would have been wrong.** `a6-responsive.spec.ts` asserted
`[data-design-split-kind]` with three values, plus a surface switcher, an assistant pane and a workspace pane.
All of it belonged to `DesignSplit`, deleted on purpose by `1171ccd38 fix(parity): unify Design mode's chat,
delete the dead per-mode chat stack` — `b00ccd818` had added it. The cited authority
`pages/workbench/design-responsive.ts` is gone too. The component the spec describes does not exist, so
guessing a replacement attribute would have produced another green test measuring nothing.

**Measured before writing anything.** A disposable probe recorded every `data-design*`, `data-parity` and
`data-workbench-surface` attribute present at all five v110 families:

```
family                  layout   layers-toggle  bottombar  save-state  rail  scrollW/innerW
desktop-wide   1440x900   studio        -            -          yes      62px     1440/1440
desktop-compact 1024x768   studio        -            -          yes      58px     1024/1024
tablet-portrait 768x1024   single        yes          yes        no       58px      768/768
phone-portrait   390x844   single        yes          yes        no        0px      390/390
compact-landscape 844x390  single        yes          yes        no       58px      844/844
```

`data-design-studio-layout` answers the question the spec existed to ask — does the studio relayout as the
viewport family changes — and the split point is between 1024 and 768. The layers toggle and the bottom bar are
asserted in **both** directions, so a studio that stopped rendering either fails rather than passes.

**The console gate changed for a measured reason.** Chromium reports every resource failure with the same text
and no URL, so a text filter cannot tell an expected failure from a real one. Measured with the studio settled:
**zero** HTTP responses ≥ 400; every console entry is the app's own bootstrap polling `127.0.0.1:4096`, which
this harness does not start, across 23 paths. Those have no HTTP status at all, so the gate now asserts through
`trackFailingRequests` + `unexpectedRequests` — status, method and URL — the same reasoning as
`BENIGN_HARNESS_404`.

**Proof that it is not a pass for the wrong reason.** A control run with one family's `layout` flipped to the
wrong value fails on exactly that assertion. Then 5 consecutive standalone runs, `1 passed` each. Then order
independence: inside a 141-test batch with the rest of `e2e/v110/` plus `e2e/modes/design-mode.spec.ts`
(116 passed / 18 failed, 22.6 min), a6 is **not** among the 18.

**One correction, because it nearly became a wrong claim.** A first grep reported a6 as still failing in that
batch. It was matching Playwright's test *plan* listing, not a failure block — none of the 18 numbered failure
blocks contain it. The corrected evidence is what is recorded above, and the plan-vs-failures distinction is the
same trap as counting MENTIONS instead of failures in the 2026-10-04 log entry.

**What is left in G3**, same shape, untouched at the time of writing: `a3-responsive:137` (memory pane,
`Expected: 1 Received: 3`), and `automate-responsive:46` with `settings-responsive:30`, both
"element is not stable" for 30–60 s at `compact-landscape-844x390`.

---

## A3 remediation, group 2 of 6: G3 / a4-responsive — DONE

**PR #346, squash `a605103d73a33b99ffc86d0e872d07236e9c64b8`.** 52 → 50 failures.

Same discipline as group 1: measure the DOM before writing an assertion, then prove the spec can still fail.

**First defect: the panel can never exist on the layout the spec was on.** It asserted
`[data-v110="terminal-panel"]` present and `aria-hidden` on the *default* layout, but `TerminalPanel` is
mounted by `session-editor-surface.tsx`, which only renders in the Editor layout. Measured on all five
families before changing anything:

```
[data-component="session-editor-surface"]  0     [aria-controls="terminal-panel"]  1
[data-v110="terminal-panel"]               0     [data-component="terminal"]       0
```

The toggle's `aria-controls` pointed at an id that only exists inside the editor surface. `useEditorLayout`
exists for exactly this and its doc comment records the same measurement (`e2e/actions.ts:148`) — this spec
predated the helper. Fixed by calling it once before the loop.

**Second defect, which only became visible once the layout was mounted:** the spec required the toggle visible
at every family, but the topbar is folded away on phones and the editor carries a FAB. Measured on the Editor
layout:

```
family                 [data-v110=top-terminal]   [data-v110=code-terminal-fab]
desktop-wide  1440x900   31x31 visible                0x0 display:none
desktop-compact 1024x768  31x31 visible                0x0 display:none
tablet-portrait 768x1024 32x31 visible                0x0 display:none
phone-portrait   390x844  0x0  collapsed              44x44 display:grid
compact-landscape 844x390 32x31 visible                0x0 display:none
```

So the contract is "reachable at this family", not "in the topbar". `aria-expanded="false"` and
`aria-hidden="true"` are still asserted at every family including 390px, where both hold on the collapsed
button — nothing was dropped to make it pass.

Also replaced the fixed `waitForTimeout(250)` with a wait for the panel to be mounted, since that is what the
next assertion is about.

**Executed proof.** The **unmodified** spec fails **5/5** — the defect was deterministic, not noise. With the
fix, **5/5** pass on the current base `fa902a861`, and `a4-responsive` + `a6-responsive` together give
`2 passed (33.9s)`. Two control runs: removing `useEditorLayout` fails on "panel must be mounted"; pinning
the toggle to the topbar everywhere fails on "terminal toggle must stay reachable" at phone-portrait.

**One number recorded rather than smoothed over.** An earlier 10-run sample gave **9 of 10**, the single failure
being `gotoSession()` timing out at `actions.ts:542` (`resolveDirectory`, 45 s) **before the test body ran**.
That is harness instability, not an assertion. The same thing appeared as `read ECONNRESET` on an unrelated
probe, and a worktree left holding orphaned Playwright workers after an interrupted run reproduced it exactly.
It is not called flaky and it is not claimed fixed; the 5/5 above is on a freshly reset clone with no orphans.

**What is left in G3**: `a3-responsive:137`, and the paired `automate-responsive:46` /
`settings-responsive:30` "element is not stable" failures.
---

## A3 remediation, group 3 of 6: G1 / design-visual - NEEDS-OWNER

**Reproduced, cause proven, not fixed.** The fix needs `packages/app/src/**`, which is outside this lane.

Clean clone of `dev@ca7ea5548`, Windows Chromium, `PLAYWRIGHT_WORKERS=1`, `PLAYWRIGHT_RETRIES=0`:

```
8 failed  2 passed (5.8m)
```

All eight are the same line, `design-visual.spec.ts:147`, and the measured ratios are **0.68 - 0.91** of all
image pixels. That is not antialiasing and not a one-pixel regression; it is a different page. The two
reload-determinism tests in the same file pass, so the surface itself is stable - only the committed baselines
are wrong.

**What the capture actually paints.** A disposable probe recorded every text node on the loaded surface. The
machine-specific values are the project basename, its absolute path, and the avatar initials derived from it:

```
Unifia  rc0-g1 / Design
rc0-g1 · Design
rc0-g1 | D:\App\unifia\build-temp-external\rc0-g1 | active
Build anything | D:/App/unifia/build-temp-external/ | rc0-g1 | Main branch
RC
```

The same probe shows what is already pinned and therefore not a source of drift: `mock-instance-1`,
`Test system 1.0.0`, and the clock (`PINNED_EPOCH`). The probe was deleted; it is in no diff.

**Why the in-scope levers were rejected, with the reason rather than the preference.** D14 settles the approach:
fixed dummy data in the test, then regenerate. `e2e/AGENTS.md` prefers `data-*` / semantic selectors and the e2e
scope excludes `src/**`, so the measurements that settle it are:

- Masking the identity regions needs a selector for the two elements that carry the text. `session-new-view.tsx`
  renders them with **no `data-*` attribute at all**, so the only handles available are a CSS class or the text
  itself. The first is what the guide calls a bad selector; the second breaks the moment the path changes length.
- Pinning `sync.project.worktree` is the correct fix, but the project list arrives over the server's event
  stream, not an HTTP call the page can be routed on - the probe captured **no** `project.list` request, only Vite
  module loads. Intercepting a stream to rewrite one field is not something to do blind to routing.

So the honest status is: the cause is proven and reproducible, and the fix is a product-side pin. Recorded as
NEEDS-OWNER rather than shipped as a narrowed capture, because narrowing what the gate measures is the specific
mistake that made #267's report untrustworthy.

### NEEDS-OWNER - the pin, for whoever owns `packages/app/src`

The surface already has a pinning convention (`pinTime`, `ANIMATION_DISABLE_CSS`, `installWorkbenchMock`,
`markE2E`) and a hook that nothing reads - `markE2E` sets `window.__opencode_e2e = {}`, and `E2EWindow` in
`src/testing/terminal.ts` is the established shape for exactly this. Follow it rather than inventing a new one:

1. `src/testing/terminal.ts` - extend `E2EWindow.__opencode_e2e` with
   `visual?: { enabled?: boolean; project?: { name: string; path: string; branch?: string } }`.
2. `src/context/global-sync/bootstrap.ts` - after `globalSDK.project.list()` resolves (~line 124), when
   `__opencode_e2e.visual.project` is set, overwrite the rendered `worktree`/`sandboxes` with the pinned values.
   **Keep the real directory in `sandboxes`**: `projectID()` (bootstrap.ts:161) matches on
   `worktree === directory || sandboxes?.includes(directory)`, and dropping the real path there breaks routing
   rather than just the pixels.
3. `src/components/session/session-new-view.tsx` - read the pinned values, and add stable `data-*` attributes so
   a future mask has something to target.
4. Then `bunx playwright test e2e/design/design-visual.spec.ts --update-snapshots` on the generating platform and
   commit the eight files.

Acceptance is unchanged: the eight tests pass, and the baselines stay reproducible on a second clone and in CI.

### What this measurement also says, which matters more than the stale baselines

The surface renders **no design content**. The right-hand panel is `Connected to Workbench instance mock-instance-1`
and nothing else - the workbench mock serves a design system (`Test system 1.0.0`) but no artifacts, so there is no
canvas, no layers, no nodes. The gate is therefore comparing roughly ninety percent application chrome and one empty
panel, and it cannot detect a regression in the design surface it is named after. Regenerating the baselines makes
eight tests green without making that true. This is a product-fixture gap (seed a design artifact in the mock), it
is outside this lane, and it is the more valuable of the two findings here.

---

## A3 remediation, group 4 of 6: G4 / projects + sidebar navigation - RECLASSIFIED, PR #374

**The classification was wrong, and reclassifying it is the result.** `RC0-E2E-CLASSIFICATION.md` records G4 as
STALE-SPEC on a signature of "`toBeVisible` and a 60 s click timeout on the sidebar project row", noting those specs
"regressed" after being moved to the sidebar row. Measured on `dev@ca7ea5548`, clean clone, workers 1, retries 0:

```
5 failed   ECONNREFUSED occurrences: 5
```

**Every one of the five is the same refusal, and none of them is a locator.** `createTestProject`, `resolveSlug` and
`waitDir` each accept an optional `serverUrl` and default to `http://127.0.0.1:4096`, while the worker-scoped
`backend` fixture starts the real server on a **random free port**. Nothing listens on 4096, so the spec died before
touching the UI:

```
TypeError: fetch failed
  [cause]: Error: connect ECONNREFUSED 127.0.0.1:4096
  at ...\projects\projects-close.spec.ts:16:17
```

The fixture itself was already correct - `makeProject.open()` passes `{ serverUrl: backend.url }`
(`fixtures.ts:394`). It was the **specs** that called `createTestProject()` bare, and the helpers that defaulted.

**Fix, and why it is at the source.** The `backend` fixture registers its real URL and the three SDK helpers default
to it, instead of patching five call sites and leaving the sixth to be found later. State is module scope rather than
`process.env` on purpose: Playwright gives each worker its own process, so two workers on different ports cannot
overwrite each other's value. `serverUrl` is left alone - it backs `serverNamePattern`.

| | `ECONNREFUSED` | result |
|---|---|---|
| baseline `dev@ca7ea5548` | 5 | `5 failed`, `1 passed` |
| with the fix | **0** | the same five tests **all pass** |

Per-test, workers 1, retries 0: `projects-close:13` 14.0s, `projects-switch:16` 3.5s, `projects-switch:38` 6.8s,
`workspace-new-session:60` 10.0s, `workspaces:75` 9.6s.

**Two failures I refused to count as fixed, and one of them nearly became a false regression claim.**
`workspaces:141` ("can rename a workspace") fails on **unmodified** `dev` as well - pre-existing, not in G4.
`projects/project-edit:4` failed in a batch that included the change, which would have made this a regression. Two
measurements cleared it: an instrumented `defaultServerUrl()` logged **zero** calls during that spec, so the new code
path is never reached; and on unmodified `dev`, alone, the same spec gave **1 failed / 1 passed**. Pre-existing
non-determinism - and deliberately *not* called flaky, because that needs five runs it has not had.

`bun typecheck` exit 0. Full `bun test` in `packages/app`: **2128 pass / 1 skip / 0 fail**, 253 files.

**Carried to G8 and G7.** `sidebar-popover-actions.spec.ts:53,78` call `createTestProject()` bare and should clear
with this change; `session-model-persistence` routes through the same `resolveSlug`/`waitDir` helpers. Both are
unverified - measured next, not assumed.---

## A3 remediation, groups 5 and 6 of 6: G7 and G8 - measured on top of #374

Both groups were measured with `agent/A-G4-backend-url-defaults` applied, on the same clean clone, workers 1,
retries 0. The fix from group 4 removed **every** `ECONNREFUSED` from these files too (count: 0), so what remains
here is what the classification recorded after the port defect is discounted.

### G8 - sidebar popover, 3 failures. TWO FIXED, one still open.

```
x  sidebar-popover-actions:14  collapsed sidebar popover stays open when archiving a session  (1.0m)
ok sidebar-popover-actions:50  opening another project disclosure leaves the active route unchanged  (9.3s)
ok sidebar-popover-actions:75  project disclosure opens with keyboard activation                (3.5s)
```

The two that pass are exactly the two `createTestProject()` call sites (`:53`, `:78`) that group 4 fixed. The one
that still fails is the case the classification has carried since the 2026-10-03 baseline - "the project row is not
rendered in a collapsed sidebar" - and it is not a port problem: it times out on the assertion, not on a fetch.
**Not claimed fixed.** Its cause is still undiagnosed and this lane did not get to it.

### G7 - session model persistence, 3 failures. NOT FIXED, cause identified.

```
x  session-model-persistence:268  session model restore per session without leaking  (42.7s)
x  session-model-persistence:301  session model restore across workspaces            (38.1s)
x  session-model-persistence:343  variant preserved when switching agent modes        (1.0m)
```

All three fail the same way, and it is not the port either:

```
Error: Timeout 30000ms exceeded while waiting on the predicate
  > 215 |   await expect.poll(async () => (await read(page)).model, { timeout: 30_000 }).toBe(next.name)
      at chooseOtherModel (e2e/session/session-model-persistence.spec.ts:215:3)
```

A **hardcoded** `30_000` on the model-picker poll. That is the race `playwright.config.ts:27-28` already names when
it excludes this file from CI - "hardcoded 30_000 timeouts in spec + async model picker race". The config knows; the
spec was never fixed.

**Why it is not fixed here.** The programme's rule for a time-sensitive test is to measure it over five runs and
fix the *test* by waiting on a condition - never by raising the timeout. Five runs of three tests is a measurement
lot of its own, and doing it half-way would produce exactly the unsupported "fixed" claim this lane is meant to
avoid. It is left measured, with the line to change named.

## Correction to `docs/audit/RC0-E2E-CLASSIFICATION.md`

**G4 was mis-classified.** The document records G4 (5 failures) as STALE-SPEC, on the signature of "`toBeVisible`
and a 60 s click timeout on the sidebar project row", and asserts those specs "regressed" after being moved to the
sidebar row. Measured on `dev@ca7ea5548`: **5 of 5** failed with `ECONNREFUSED 127.0.0.1:4096`, before any UI
interaction. No locator was ever exercised. Fixed as PR #374; the classification should read **HARNESS**.

The same reason applies to **G8** and probably to part of **G7**: all three route through `resolveSlug`/`waitDir`/
`createTestProject`, which defaulted to the fixed port. G8 is 2/3 clear on that basis. G7 needed a separate
diagnosis and did not get one - it is the only group of the three whose remaining failures are not the port.

## Where the A3 e2e tally actually stands

The classification counted 52 failures at `a71cd08d2`. Of the STALE-SPEC share:

| group | n | status after this lane |
|---|---|---|
| G3 v110 responsive | 5 | 2 merged (#341 a6, #346 a4); 3 open |
| G4 projects/sidebar | 5 | **fixed**, #374 - and reclassified HARNESS |
| G6 prompt/shell | 4 | untouched |
| G7 model persistence | 3 | measured, cause named, not fixed |
| G8 sidebar popover | 3 | **2 fixed** by #374; 1 known-open since 2026-10-03 |
| G1 design-visual | 8 | NEEDS-OWNER (above) |

So of 25 STALE-SPEC failures, **7 are now green** and the rest are measured rather than assumed. G2 (8) remains
lane B's PRODUCT-BUG cluster, and G5 (5) still needs the probe that splits spec from bridge.

**The correction that matters most is not a count.** Two of the four groups this lane touched were mis-filed, and
both errors pointed the same way: a failure that happens *before* the UI was exercised was read as a failure *of*
the UI. A port refusal and a stale locator look identical in a summary line and are opposite problems. The next
agent should read the first line of a failure - not the assertion name - before deciding what class it belongs to.