<!-- SPDX-License-Identifier: MIT -->
# RC-0 release preparation (RL00–RL02, RL01 package) — DRAFT, NOT READY

Status date: 2026-10-02. Nothing in this file has been executed. No tag, publication, release workflow run, `main` change, secret or signing identity was touched.

## Why RL00–RL02 are not started

RL00, RL01 and RL02 depend on QA12R, which requires the full build/test/security/visual/functional/package-wiring matrix green on one immutable `dev` SHA. That is not the case today:

| Gate input | State on `dev` | Evidence needed to close |
|---|---|---|
| Required checks (7) | green on every merged head | already evidenced per PR |
| Full E2E job (`e2e (linux)`) | not green: earlier runs `36946939249`, `36950762529` hit the 110 min ceiling at bootstrap or after ~128/300 tests; most locator groups unclassified | one complete run with the failing specs classified (pre-existing / regression / unknown) and zero unapproved failures |
| Android build | `Build Android APK` run `37033612001` SUCCESS on `00108bb` | re-run on the frozen candidate SHA |
| CodeQL | live inventory unreadable from Cloud (alerts API 403); alert 382 (`cli/cmd/run.ts` quoting) open by design choice, shell bypass closed by #207 | alert list read by an authorized session; each open alert fixed or justified, none dismissed to turn the board green |
| Physical checks | not run | owner-executed: Android/Windows, VO02–VO05, QA08 |

## RL00 — freeze (agent, after QA12R is green)
1. Record the candidate SHA, `git status` clean, and the exact check runs (links) for that SHA in `docs/autonomy/rc0/`.
2. Write the owner manual-test checklist and known limitations (below). No feature commits after the freeze except approved blocker fixes.

## RL01 — release package (agent; stops before publishing)
- Changelog and release notes from `RELEASE_NOTES_TEMPLATE.md`, tied to the candidate SHA. Known limitations must include: HTTP 403 contract for a denied command shell permission is not qualified (generic 500); native transport, axe contrast debt and Automate policy O1/O3 not qualified; licence/SBOM closure (sharp/libvips LGPL, ghostty Git dependency) pending artifact qualification.
- Rollback notes: revert path to the previous `dev` SHA, no force-push, no tag deletion needed because none is created.
- Dry run: **do not run `release.yml` as is.** `RELEASE-PIPELINE.md` §3 records that the npm and Docker publish jobs are guarded by repository, not by `draft`. A safe dry run first needs a reviewed workflow change (`if: !inputs.draft` on the publishing jobs). Until then the dry run is blocked, not skipped silently.

## RL02 — align `work-design` (agent)
Fast-forward only, no content review. Verify first that `work-design` is an ancestor of the candidate SHA (`git merge-base --is-ancestor`); if it is not, stop and report instead of merging.

## Owner-only (RL03–RL07) — procedures and expected proof
- Manual tests on the candidate build: clean install, project open/switch from Home, Start Run, Design connection states, file tabs, command shell permission deny/allow.
- Physical: Android install and launch, Windows install and launch, Voice (VO02–VO05), QA08.
- Expected proof per item: build identifier (SHA), date, device/OS, pass/fail, and a screenshot or log excerpt stored outside the repository or in `docs/autonomy/rc0/` by the owner.
- Then the owner opens `dev` → `main`, tags and publishes. None of this is done by the agent.
