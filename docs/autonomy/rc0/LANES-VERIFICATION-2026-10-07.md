<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# Verification of the four RC-0 lanes — 2026-10-07

Read-only audit of what lanes A, B, C and D delivered, measured on `origin/dev` at `acc1e18c48`
(#377). Labels: VERIFIED = a command or API read was run today; INFERRED = deduced from what was read.

## Verdict

The lanes delivered real, evidenced work and stayed inside their write scopes. The train-1 gate
(`QA12R-REPORT.md`) was run at `fa92cb9b` and failed; since then `dev` moved by dozens of commits and
the picture changed, so the gate has to be re-run on a fresh SHA (RL00).

## Scope discipline (VERIFIED)

- `bun.lock` changed only in lane D's dependency PRs (#304, #329, #330, #331, #360) and the Browser PRs.
- `.github/**` changed only in #348 (check-duplicates) and #354 (merge-and-size CI fix).
- `EXECUTION-LOG.md` was not touched by any lane (last change: #282, before the lanes started).
- No issue was closed without its acceptance criteria; no CodeQL alert was dismissed in the UI.

## Delivered

| Lane | Evidence |
|---|---|
| A | #284 fixed (#336, closed); Windows unit suite deterministic (#310); e2e classified (#317) and groups G3/G4/G8 fixed (#341, #346, #374); branch policy (#317). |
| B | #77 fixed (#351, closed); CR05 proven (#301); RB05 truth table, 3077 controls (#303); FX00 closed (#358); PW00 policy (#306); UI00 parity run (#306). |
| C | D10 setting + routing (#300, #302); tampered-artifact refusal (#305); provider inventory (#296); build evidence + device checklist (#308); release notes (#359). |
| D | CodeQL: 223 dispositions, 8 fixes (#297, #309, #311); `unifia.ai` removed from executable surfaces (#298); five advisories removed (#304, #329, #330, #331, #360) and brace-pattern depth bounded (#309); check-duplicates (#348); QA12R report (#347). |

## State of the gate today

| Item | State | Evidence |
|---|---|---|
| `e2e (linux)` on `dev` | **Green on the two newest completed runs** (`acc1e18c`, `d22a4247`); red on older ones | `gh run view` on runs 37592567288, 37592535803, 37592521176. The 27-failure run (`73ee5d92`) predates #362–#371. Three consecutive green heads are still needed before it can be required (D9). |
| Required checks | `check-compliance`, `check-standards`, `conformance`, `rust unit tests`, `sdk in sync with server`, `unit (linux)`, `unit (windows)` | `gh api repos/Rwanbt/unifia/branches/dev/protection` |
| `bun audit` | 8 open (2 high) before this audit's PRs | `bun audit` on the `dev` lockfile |
| CodeQL | 223 alerts still open on GitHub, all with a row in `CODEQL-DISPOSITIONS.md` | `gh api .../code-scanning/alerts?state=open` |
| Release dry run | Not proven: #294 open, `release.yml` not registered on the default branch; no SBOM/SLSA/signature in the pipeline | `gh api .../workflows/release.yml` returned 404 |
| QA12R | Stale (frozen SHA `fa92cb9b`) | `QA12R-REPORT.md` |

## Gaps found, and what was done about them

1. **New high advisory, in no acceptance file**: `@modelcontextprotocol/sdk` GHSA-6qxp-vccf-f47h (range
   `<1.31.0`, pinned `1.27.1`). Fixed by bumping to 1.32.1 — PR #381. `braces` stays the only high and has
   no patched version.
2. **The D10 toggle was not in the UI.** `settings.ttsSystemVoiceFallback` had a consumer in the voice path
   and the 16-locale strings, but no control wrote it (VERIFIED: no reference outside `voice/` and i18n).
   Added to Audio settings — PR #380. Default stays off.
3. **Stale texts**: the lane B summary table still said B1 was blocked after #351 landed (corrected here);
   `DECISIONS.md` still listed O1 as open although the owner decided it (corrected here).

## Still open

- Merge #380 and #381, then #294 (owner: `.github/**`), plus the five open test PRs #318–#322 and the
  Browser PRs #289, #292, #295.
- Wait for `e2e (linux)` on three consecutive `dev` heads, then make it required (D9).
- Re-run QA12R on a fresh frozen SHA (RL00), then a final release dry run.
- Triage the remaining e2e groups the lane A journal lists as untouched if `e2e` goes red again
  (G6, G5, G9, G1).
- Decide the dispositions of the three critical CodeQL alerts that remain open on GitHub.
- Browser integration (B5/B7/B11) is held on #279 (Playwright under Bun, ADR-089).
- Issues to close by hand with their merge SHA (D13): #59 once #348's effect is confirmed; #33, #35, #56,
  #57, #86, #93, #96, #99 and #103 remain open on their own merits.
- **Owner only**: the physical qualification on every platform (`OWNER-DEVICE-CHECKLIST.md`), then
  `dev` → `main`, tag and publication. Per the owner's decision of 2026-10-07, nothing is promoted before
  the application has been fully tested on `dev` on each platform.

## Decisions recorded on 2026-10-07

- O1 / RB07: engine-less controls ship **visible and greyed** in release 1.
- No promotion to `main` until the owner has tested the whole application on `dev` on every platform.
