<!-- SPDX-License-Identifier: MIT -->
# Release 1 notes — RC-0 train-1 candidate

Lane C, card C6 (RL00 / RL01). Every statement below is taken from `journal-A.md`,
`journal-A3A4.md`, `journal-B.md`, `journal-C.md`, `journal-D.md` and
`QA12R-REPORT.md`. Nothing is invented; where a source is silent, this document says so.

## Status: NOT RELEASED

**The train-1 gate does not pass.** On the frozen SHA `fa92cb9b5a92027396f98b02dc11fa4c56b556c2`:
1 PASS, 4 FAIL, 2 NOT EXECUTED, 1 FAIL/NEEDS-OWNER. No tag was created, nothing was
pushed to `main`, nothing was published. This document is release *preparation*, not a
release announcement.

| Field | Value |
|---|---|
| Repository | `Rwanbt/unifia` |
| Integration branch | `dev` |
| `dev` tip when written | `ca7ea55481` |
| QA12R frozen SHA | `fa92cb9b5a` (16 commits behind `dev` at the time of writing) |
| `origin/main` | `207ff452b8` |
| Tag | none created |
| Publication | none |

`dev` is still moving. Every gate result below is pinned to the frozen SHA, and where a
statement was re-measured later the re-measurement is labelled.

## RL00 — the candidate freeze is deliberately NOT done

**Verdict: BLOCKED.** Lane C does not freeze a release candidate, because the release
gate it would freeze is red. A frozen SHA implies "this is the candidate"; publishing that
label on a tree with 1 of 8 gates passing would be the exact failure the release process
exists to prevent.

What would unblock it, taken from `QA12R-REPORT.md` §"What would have to change" and
re-measured where it has since moved:

1. E2E green on `dev` (gate 1) — 27 of 305 tests failing deterministically.
2. **Gate 3 has no pending fix.** #345 was closed unmerged; the owner needs a new PR (or to
   reopen #345) before `check-duplicates` can ever report. Also merge **#294** (gate 7).
3. Seven blockers closed with proof (gate 4) — see the current count below.
4. Owner decision on `braces`, then QA05 closes at "no high" or with a written acceptance.
5. SLSA failure resolved (gate 7).

**The manual-test handoff is delivered and does not wait for a candidate.** It is
`OWNER-DEVICE-CHECKLIST.md`, already merged, and it is the answer to gates 5 and 6, which
are owner-only. No physical device result is claimed anywhere in this document.

## What shipped

All merge SHAs verified against `origin/dev`. Four lanes, squash-merged.

### Lane A — test determinism and classification

| PR | Merge SHA | Change |
|---|---|---|
| #310 | `939441437c` | `fix(test): make the Windows unit suite deterministic` |
| #317 | `594e3cee7e` | branch policy + e2e failure classification |
| #323 | `1da85db05e` | journal-A part 1 (defective, superseded by #324) |
| #324 | `93b4706bce` | journal-A rewritten, line breaks restored |
| #328 | `ef77b1f03e` | journal-A3A4 for cards A1, A3, A4 |

`packages/unifia` unit suite: **5336 pass / 0 fail**, three consecutive runs, against a
5332 pass / 4 fail baseline. E2E classified on a clean clone of `origin/dev` with
`PLAYWRIGHT_RETRIES=0`: 247 passed / 52 failed / 5 did not run.

### Lane B — two real product defects fixed

| PR | Merge SHA | Change |
|---|---|---|
| #351 | `81d3fadf7c` | `fix(session): a prompt landing during post-Stop unwind is no longer swallowed` |
| #284 | `2d2974b15a` | `fix(lsp): stop queued writes to a dead server escaping the promise chain` |

#77 is closed. The regression test was de-quarantined, failed red first
(`expect(llm.pending).toBe(0)` → received 1), then the fix landed: 22 lines in `prompt.ts`,
bounded by `LOOP_DRAIN_LIMIT = 10`. Full package suite 5346 pass / 12 skip / 0 fail;
`bun turbo typecheck` 48/48.

### Lane C — the shipped Voice path is now truthful by construction

| PR | Merge SHA | Change |
|---|---|---|
| #296 | `b122d0c4b3` | guard the shipped Android TTS path against non-production providers |
| #300 | `f4f6a72359` | D10 system-voice fallback **setting**, off by default |
| #302 | `b56c7a1edd` | D10 routing to the fallback when the local voice is unavailable |
| #305 | `a71cd08d27` | refuse a tampered model artifact; close four integrity gaps |
| #308 | `fb9f7166a2` | platform build evidence + owner device checklist |
| #325 | `4a6e6cdae3` | `voice.systemFallback.*` in all 16 locales |
| #339 | `5f32302e1e` | record that lane C cleared the QA12R precondition |

`androidShippedTtsBackends()` is the live registration list the shipped router consumes,
and a test fails if a `productionReady: false` provider is ever wired into it. D10 is off
by default: a language with no installed Pocket pack stays silent and reports
`unavailable` unless the user opts in; when they do, the platform voice speaks and is
reported as `fallback-android-tts`, never as Pocket. `origin/voice` needs nothing — all
20 of its commits are already on `dev`.

### Lane D — security, dependencies, release

| PR | Merge SHA | Change |
|---|---|---|
| #297 | `78f9d01cfd` | close the eight live CodeQL security findings |
| #298 | `da48cba502` | canonical origin from the environment, fail closed |
| #304 | `e3aa2f3daf` | `http-cache-semantics` 4.3.0 |
| #309 | `71b6caf7f4` | bound brace-pattern depth before micromatch compiles it |
| #311 | `b72f3ce950` | a disposition and a row for all 223 open CodeQL alerts |
| #329 | `23ea34e782` | `proxy-addr` 2.0.8 |
| #330 | `692a242182` | `seroval` 1.6.8 |
| #331 | `66b6071dfc` | `source-map-js` 1.2.2 |
| #347 | `557e3f3858` | QA12R gate report |
| #352 | `6e89a05cf0` | close the last escape route on the braces high |
| #353 | `b65a337e11` | lane D closing audit and final summary |
| #354 | `a25ddd4405` | `ci: stop merge-and-size reporting a false merge conflict` |

`bun audit`: **7 open, 0 critical, 1 high**, 4 moderate, 2 low, re-measured 2026-10-07
after #360 fixed `smol-toml`. The high is `braces <=3.0.3`, which is the newest published
version — there is no bump to take, and its exploitability is bounded at #309.
`postcss-selector-parser` is **accepted in writing** (#366) rather than fixed: its only
patched version is a major that `tailwindcss 4.1.11` does not declare.

> The absolute advisory count is not a stable baseline. `DEPENDENCY-ACCEPTANCES.md` records
> the same lockfile reporting 5, then 12, then 8, then 7 within hours, because the advisory
> **feed** moves rather than the dependency graph. Any gate written as an absolute count is
> measuring the wrong thing.

## Known limitations

Read these before testing anything. None of them is fixed by this release.

**The release gate is red.** 1 of 8 gates passes. Gate 4 (the seven blockers) is the
cleanest example of why this document is not an announcement.

**Voice is not qualified.** Gate 5 (VO04 on-site qualification) is NOT EXECUTED —
physical tests against real hardware, owner-only. No Android install, no microphone, no
audio route, no desktop STT/TTS round trip was performed by any lane. The desktop release
binary starts cleanly; that qualifies **startup only**. There is also no installer:
bundling failed on DNS and signing is owner-reserved. And no desktop Rust test result —
the test binary cannot start on the build host (`0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND`),
measured on a pristine `origin/dev` worktree with no lane commits, so it is pre-existing
rather than a regression.

**E2E is red on `dev`, deterministically.** 27 of 305 tests, 26 of which fail identically
on both retries. Six consecutive completed `test.yml` runs on `dev` are red across 4h42m.
Worst cluster `v110-canvas` (8), and every canvas attempt logs
`File not found: .unifia/design/canvas.design.json`. Note `e2e (linux)` is **not** a
required check, which is why `dev` stayed red across several green merges.

**`check-duplicates` never reports.** It sits `queued` forever with `runner_id=0`. A
job-level `if:` does not prevent GitHub from queueing the job against a runner label this
fork does not have. This is a visible check that gates nothing while appearing to gate
something. **There is currently no fix pending for this.** #345 was closed unmerged on
2026-10-06T10:55Z, so gate 3 cannot be cleared by merging it; the owner needs a new PR or to
reopen #345. Re-measured 2026-10-07: `check-duplicates` is still `queued` on every PR
checked, including #366, #367 and #368 which merged after the closure. `.github/**` is
owner-only.

**The seven blockers: 1 of 7 closed, re-measured 2026-10-06.** QA12R recorded 0 of 7 at
the frozen SHA; #77 has since been closed by #351. Still open: **#35** (team model selector
unusable on a fresh install), **#86** (no HTTP capability to mutate a task's status),
**#93** (rename should refactor wikilinks), **#96** (editor parity gaps have no
implementation), **#99** and **#103** (Design surfaces still render hard-coded French).
Gate 4 still FAILS on 6 open.

**A release would ship with no SBOM, no provenance and no signature.** `release.yml` has
never been a registered workflow: it exists on `dev` but not on `main`, and GitHub
registers workflows from the default branch (`gh api .../actions/workflows/release.yml` →
HTTP 404). It has only a `draft` input and no `dry_run`. SBOM and signing were each
produced exactly once, in July 2026, bound to the `v0.2.0-fork` tag; **SLSA has exactly
one historical run and it failed.** The repo already has three published non-draft
`-fork` releases, so any rehearsal must assert an unchanged tag and release list before
and after.

**Two D10 items are implemented but unreachable.** The behaviour is unit-tested; no UI
control is wired to it. The strings exist in all 16 locales (`voice.systemFallback.*`) and
the steps are in `journal-C.md` §2.6.

**Voice CI jobs are not required on `dev`,** so a Voice regression can merge today. Adding
them is `.github/**` work — owner-only, `journal-C.md` §3.6.

**~150 localized `packages/web/src/content/docs/**` files** still show an `unifia.ai`
label over an `opencode.ai` href. Documentation-only, but not a clean search result.

## Rollback notes

Nothing is published, so rollback means "move the branch pointers back", not "unpublish an
artifact".

- **No tag exists.** There is no tag to delete and no release to withdraw. The repository's
  three published releases are `v0.2.1-fork`, `v0.2.0-fork` and `v0.1.0-fork`, all from
  before this train, and none is touched by this work.
- **`main` has not moved.** `origin/main` is still `207ff452b8`.
- **To discard the whole train,** delete the branch. `dev` is the only branch that moved;
  `main` and `work-design` are strict ancestors of it, so no other branch needs restoring.
- **To roll back one lane,** revert its merge SHAs in the table above. They are listed per
  PR precisely so a single revert is possible without bisecting 1678 commits.
- **`dev` carries no stateful migration for this train.** The lanes that changed persisted
  formats were the dependency lockfile overrides, which are forward-only in the sense that
  reverting the PR restores the prior versions; no data written by this train requires a
  migration to read it.

## Owner decisions required before a candidate can be frozen

1. **Gate 3 first — nothing is pending.** #345 was closed unmerged on 2026-10-06, so there
   is currently no PR that would make `check-duplicates` schedulable. Open or reopen one.
2. Merge **#294** (or an equivalent `dry_run`) — the only route to a rehearsable release.
3. Decide whether release 1 ships with the unpatchable `braces` high (#309 bounds its
   exploitability; the advisory count does not change).
4. Decide whether to wire `release.yml` to `sbom.yml` / `slsa.yml` / `release-sign.yml`,
   or accept that a release produces no SBOM, provenance or signature.
5. Add the D10 settings toggle (strings are ready in all 16 locales).
6. Add the Voice jobs to `dev`'s required checks.
7. Run `OWNER-DEVICE-CHECKLIST.md`, starting with **A3.4** — the setting-off case must stay
   silent.

## RL02 — the promotion fast-forward, re-verified and not run

Re-verified at `ca7ea55481`, not assumed:

```
origin/main         207ff452b8056ae11d1f71e23198e520835f70ed
commits in dev not in main : 1678
commits in main not in dev : 0
commits in work-design not in dev : 872
commits in dev not in work-design : 0
```

Both directions are zero-divergence, so `dev` promotes to `main` as a **fast-forward** and
`work-design` needs no merge at all. The exact commands are in `journal-C.md` §6.3.
**They were deliberately not run** — promotion is the owner's call, and branch protection
cannot enforce it, so the seven required checks plus CodeQL and Analyze must be re-run by
hand against the exact SHA being promoted.

## Provenance

Gate results: `QA12R-REPORT.md`, frozen SHA `fa92cb9b5a92027396f98b02dc11fa4c56b556c2`.
Per-lane evidence: `journal-A.md`, `journal-A3A4.md`, `journal-B.md`, `journal-C.md`,
`journal-D.md`. Physical-device expectations: `OWNER-DEVICE-CHECKLIST.md`. Re-measurements
performed for this document on 2026-10-06 against `origin/dev` = `ca7ea55481`: the seven
required checks list, the issue states of #35/#77/#86/#93/#96/#99/#103, the fast-forward
divergence counts, and the presence of `QA12R-REPORT.md`.

**Currency pass, 2026-10-07**, against `origin/dev` = `d7adcdb52c` — 6 commits later, two of
them mine. Three claims in the first version of this document had gone stale and are corrected
above: the advisory totals (#360 fixed `smol-toml`, so 8 → 7), the state of #345 (closed
unmerged, not pending), and the `check-duplicates` paragraph (re-measured still `queued` on
#366/#367/#368). Everything else re-checked and unchanged: #294 still open, `release.yml`
still unregistered (HTTP 404), the seven blockers still 1 closed / 6 open, fast-forward
divergence still zero in both directions.

The lesson is the one this repository keeps teaching: a verdict pinned to a SHA is correct
only for that SHA, and a document that reports on the present tense must say which present.
