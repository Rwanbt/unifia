<!-- SPDX-License-Identifier: MIT -->
# RC-0 release preparation (RL00–RL02, RL01 package) — DRAFT, NOT READY

Status date: 2026-10-03. RL00-RL02 procedures below have not been executed. No tag, publication, release workflow run, `main` change, secret or signing identity was touched.

## Why RL00–RL02 are not started

RL00, RL01 and RL02 depend on QA12R, which requires the full build/test/security/visual/functional/package-wiring matrix green on one immutable `dev` SHA. That is not the case today:

| Gate input | State on `dev` | Evidence needed to close |
|---|---|---|
| Required checks (7) | green on every merged head | already evidenced per PR |
| Full E2E | normal-clone Windows baseline9f69f9c complete:203 pass/98 fail/7 skip/4 not-run,53.5min; Linux CI not qualified | immutable-SHA complete run, classified failures and zero unapproved failures; see RC0-E2E-BASELINE-20261003.md |
| Android build | `Build Android APK` run `37033612001` SUCCESS on `00108bb` | re-run on the frozen candidate SHA |
| CodeQL | local read succeeds:22 open alerts on dev9f69f9c; #225 proposes rule-specific FP for615; shell/CLI lots #207/#213/#214 delivered | every current open alert fixed or justified; no blanket dismissal |
| Voice software CI | run37081782382 SUCCESS on c15cc202,7 jobs; voice-host189 pass/1 skip, R14 security53 pass | same software matrix on the frozen SHA plus owner-only physical proof |
| Physical checks | not run | owner-executed: Android/Windows, VO02–VO05, QA08 |

## RL00 — freeze (agent, after QA12R is green)
1. Record the candidate SHA, `git status` clean, and the exact check runs (links) for that SHA in `docs/autonomy/rc0/`.
2. Write the owner manual-test checklist and known limitations (below). No feature commits after the freeze except approved blocker fixes.

## RL01 — release package (agent; stops before publishing)
- Changelog and release notes from `RELEASE_NOTES_TEMPLATE.md`, tied to the candidate SHA. HTTP403 denial is qualified by #214/#226. Retain unresolved native transport, axe contrast debt, Automate policy O1/O3, Design visual gate and licence/SBOM closure (sharp/libvips LGPL, ghostty Git dependency) until their actual evidence closes them.
- Rollback notes: revert path to the previous `dev` SHA, no force-push, no tag deletion needed because none is created.
- Dry run: **do not dispatch `release.yml`.** #216 guards npm and Docker with `!inputs.draft`, but the workflow still signs an APK and invokes action-gh-release with tag_name and contents:write in draft mode. That can create a release/tag and is outside this mandate. A non-publishing package build must be isolated from signing and release creation; no safe artifact-only procedure is qualified yet.

### Verified on 2026-10-03 (`dev@067e02b84e`) — why the draft dry run is not safe

Re-read of `.github/workflows/release.yml` confirms the gap and pins it to lines:

- `build-android` (`release.yml:301`) is `if: github.repository == 'Rwanbt/unifia'` with **no `!inputs.draft`**, so a draft run still reaches `Sign APK (debug keystore)` (`:490`), which generates a throwaway key in `/tmp` and signs with it. No owner secret and no persistent credential is involved.
- `build-tauri` (`:204`) needs `secrets.TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (`:269-270`). On a repository where those secrets are absent, a dispatch fails here rather than producing artifacts.
- `release` (`:511`) is also **unguarded by `draft`**. It runs `softprops/action-gh-release` with `tag_name: ${{ steps.tag.outputs.tag }}` (`:547`) while the workflow holds `permissions: contents: write` (`:31`). `action-gh-release` creates the tag when it is absent, so a draft dispatch can create a real tag and a draft release. `inputs.tag` is `required: true` (`:11-14`).
- Also note the `push: tags: v*` trigger (`:20-24`): any `v*` tag pushed to this repository triggers the whole pipeline, including the npm and Docker publishes.

Two decisions are therefore reserved for the owner, and neither is taken here: (1) whether a `draft` dispatch should still create a draft release/tag, and (2) the version number, `NPM_TOKEN` and Windows signing identity. Extending #216's `!inputs.draft` to `build-android` and `release` would remove the tag-creation path entirely, but it would also disable the draft release the input documents, so it is not a change to make unilaterally.

## RL02 — align `work-design` (agent)
Fast-forward only, no content review. Verify first that `work-design` is an ancestor of the candidate SHA (`git merge-base --is-ancestor`); if it is not, stop and report instead of merging.

## Owner-only (RL03–RL07) — procedures and expected proof
- Manual tests on the candidate build: clean install, project open/switch from Home, Start Run, Design connection states, file tabs, command shell permission deny/allow.
- Physical: Android install and launch, Windows install and launch, Voice (VO02–VO05), QA08.
- Expected proof per item: build identifier (SHA), date, device/OS, pass/fail, and a screenshot or log excerpt stored outside the repository or in `docs/autonomy/rc0/` by the owner.
- Then the owner opens `dev` → `main`, tags and publishes. None of this is done by the agent.
