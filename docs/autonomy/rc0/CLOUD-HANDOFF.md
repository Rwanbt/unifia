<!-- SPDX-License-Identifier: MIT -->
# Unifia RC-0 — Cloud handoff

**Capture:** 2026-10-02 08:54 UTC
**Repository:** `Rwanbt/unifia`
**Purpose:** exportable Cloud checkpoint. This file and its journal entry are local; neither was pushed to GitHub or synchronized to the Obsidian vault.

## Exact repository state

- GitHub `dev` was verified through `gh` and the GitHub API at `0b327298f8719fa47b40322a46ec4e1e97378a7d`. A `git fetch --no-write-fetch-head` confirmed the local tracking ref at the same SHA.
- Shell permission fix commit: `6667bf427a1e7187f6f8cfbd1847fd53599f614e`, branch `agent/rc0-session-command-permission-20261002`, parent `0b327298f8719fa47b40322a46ec4e1e97378a7d`. It exists only in this Cloud clone; no remote branch or PR was created.
- The code branch contains five changed files, 324 insertions and 49 deletions (373 changed lines). This handoff and its appended journal entry are committed locally on `agent/rc0-cloud-handoff-20261002` at `a114b5b2ff3ec263737bf942476b0a8be1b5c972`, based on `origin/dev`; they are not pushed.
- `docs/autonomy/rc0/HANDOFF.md` was absent from this checkout. The user-provided 2026-10-02 checkpoint was used; no unavailable Windows paths, vault files, or raw local logs were claimed as read.

## Command-template shell permission finding

The observed path in `packages/unifia/src/session/prompt.ts` substituted command arguments into templates, expanded `!` backtick directives, and called `Process.text` before validating the selected agent or loading the session. It did not ask for `bash` permission. The CLI `session.command` call and the HTTP `POST /session/:sessionID/command` route reach this same service path.

The change extracts placeholder expansion and shell resolution to `packages/unifia/src/session/command-template.ts`. `SessionPrompt.command` now validates the agent and loads the session, creates the tightened agent/session/permission-mode ruleset, and asks permission for each final shell command before any process starts. The existing argument grouping and shell result substitution are retained.

Local evidence on Bun 1.3.11:

- `cd packages/unifia && bun test test/session/command-template.test.ts test/session/prompt-effect.test.ts test/server/rc0-command-shell-witness.test.ts` — **41 pass, 0 fail, 143 assertions**.
- `bun turbo typecheck --concurrency=1` — **47/47 tasks passed**. The repository `pre-push` script was also run manually after commit; **47/47 passed**.
- Targeted Biome and `git diff --check` passed. `.husky` was not wired by this clone's `core.hooksPath`; its pre-commit and pre-push scripts were run manually. Bun installation could not update `.git/config`, but dependency installation completed from the frozen lockfile.
- Direct service tests cover deny/no marker, a later denied directive with no earlier process, allow, `ask` + reject, and `ask` + once. The test reads back and asserts `permissionMode: "ask"` through `Session.Service`.
- Two tests call the actual Hono `/session/:id/command` route with JSON: deny leaves the marker absent; allow writes it before the deliberately missing model is reported. The HTTP error status/body for denied permission is not asserted as a contract. The supplied checkpoint reports generic HTTP 500/`UnknownError`; there is no HTTP 403 qualification.
- The historical baseline witness in the supplied checkpoint wrote its harmless fixture marker before `ProviderModelNotFoundError`. This Cloud session did not rerun the unpatched baseline.

## GitHub access and open PRs

GitHub reads succeeded, but branch/PR writes are currently unavailable to this connection:

- `git push -u origin agent/rc0-session-command-permission-20261002` returned HTTP 403, permission denied to `Rwanbt`.
- `github_create_branch` for the same agent branch returned HTTP 403, `Resource not accessible by integration`.
- No credentials were searched for or extracted. No PR was opened, so no PR checks exist for the shell fix. The fix remains local and is not delivered to `dev`.
- The Code Scanning alerts endpoint returned 403 (`Resource not accessible by integration`); the alternate GitHub Fetch endpoint rejects that API family. The live alert inventory could not be read. No alert was dismissed.

Current PR observations (2026-10-02):

| PR | Head | Current checks and state | Action |
|---|---|---|---|
| #202 Android target compiler | `e1da341cb3bfbd9f22b6265347e1ff378267b737` | Seven required checks green; CodeQL and Analyze green. `e2e (linux)` is still in progress and `check-duplicates` queued. | Not merged. The Android workflow change has no real Android compile result yet; the checkpoint says to verify the actual build after delivery to `dev`. |
| #204 RC-0 journal | `e25cf19415ca5803ec394065abf5116010508807` | Linux unit failed on `tool.registry > loads tools with external dependencies without crashing`: 300015 ms against a 300000 ms limit, 5260 pass/8 skip/1 fail. CodeQL and Analyze green. E2E failed at 110 minutes; the project-close and project-switch selectors were absent on retries, then the job timed out at test 127/300. Merge state is `DIRTY`. | `gh run rerun 36949017341 --failed` was refused: “workflow file may be broken.” No retry was forced. PR review-thread API returned no threads for #202 or #204. |

The #204 source diff contains only `docs/autonomy/rc0/EXECUTION-LOG.md`; that makes the missing project selectors pre-existing relative to its diff, but does not establish the cause of the registry timeout. The unchanged test was run locally twice: both attempts failed in under 200 ms before dependency resolution with `proxy.url must be a non-empty string`. The standard sidecar host was present; a command-scoped npm proxy setting to that same sidecar did not change the error. This Cloud environment failure does not reproduce CI's five-minute wait. Its logs do not prove a transient network or installer failure. No timeout was increased, and neither symptom is labeled a flake. Follow-up diagnostics are bounded install/lock/network logging on a dedicated CI repro, or running the unchanged test where npm proxy behavior is known-good, before making any product change.

The former PRs #138, #140, #143 and #144 are all MERGED; they were not replayed. Open Issues were read without creating, commenting on, or closing any.

## Gate and release status

**QA12R is not qualified.** The current `dev` SHA has not been frozen as a release candidate. Full CI/E2E evidence is incomplete, the package-wiring and complete security inventory are not established here, open P0/P1 disposition remains incomplete, and owner-only physical Android/Windows/Voice checks have not run. QA08 and VO02–VO05 remain owner-executed. Windows, Android, release signing, tag, deploy, publication and main-branch work were not performed.

RL00–RL02 and the RL01 release package are **not ready** because they depend on a green QA12R SHA. No release workflow was triggered; no dry-run artifact, tag or draft release was created. Release notes and rollback evidence must be tied to the eventual immutable candidate SHA.

## Resume sequence

1. Restore write access for the GitHub connection used by this task (repository contents and pull-request creation). Then push the existing shell-fix branch without force and open one `refactor(session-command-shell)` PR using the repository template.
2. Verify its new checks against the exact PR head, keep all non-required CI failures and logs classified, and merge only under the stated checks and protection rules. After merge to `dev`, run the actual Android compiler/build validation required by #202.
3. Resolve #202/#204 using their fresh checks and evidence; do not replay the already merged historical PRs. Continue independent RC-0 tasks, then run the complete QA12R matrix on one immutable `dev` SHA.
4. Only after QA12R is green, finalize RL00, RL01 (notes, limitations, rollback, non-publishing dry run) and RL02. No `main`, tag, publication or physical owner test is in this handoff.

## Obsidian import block

## 2026-10-02 — [Unifia] — Résumé

- Mémoire : le bypass `session.command` exécutait les directives shell injectées avant `Permission.ask`; le correctif local `6667bf427a1e7187f6f8cfbd1847fd53599f614e` préautorise chaque commande finale et ses preuves passent (41 tests, 143 assertions, typecheck 47/47). Voir `packages/unifia/src/session/command-template.ts` et `packages/unifia/test/server/rc0-command-shell-witness.test.ts`.
- Le SHA `dev` vérifié reste `0b327298f8719fa47b40322a46ec4e1e97378a7d`. La branche agent et la PR n’ont pas pu être publiées : push Git et création de ref GitHub ont reçu 403. Aucun merge n’a eu lieu.
- #202 : sept checks requis + CodeQL/Analyze verts, E2E encore actif et vérification de compilation Android réelle restante. #204 : timeout `tool.registry` conservé et E2E en échec sur sélecteurs absents; aucune relance acceptée, cause non prouvée.
- QA12R, RL00–RL02 et RL01 restent bloqués par les preuves manquantes; tests physiques à Erwan. L’inventaire CodeQL live est inaccessible en 403; aucune alerte n’a été rejetée. Voir `docs/autonomy/rc0/EXECUTION-LOG.md` et le présent handoff.
