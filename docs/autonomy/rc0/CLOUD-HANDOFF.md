<!-- SPDX-License-Identifier: MIT -->
# Unifia RC-0 — Cloud handoff

**Capture:** 2026-10-02 15:04 UTC
**Repository:** `Rwanbt/unifia`
**Purpose:** exportable Cloud checkpoint. This file and its journal entry are local; neither was pushed to GitHub or synchronized to the Obsidian vault.

## Corrected environment diagnosis (15:04 UTC)

The earlier claim that the Cloud proxy was unavailable was not established: the failed Git commands lacked the executor's explicit network grant. With `sandbox_permissions: with_additional_permissions` and `additional_permissions.network.enabled: true`, `git ls-remote origin refs/heads/dev` and `git fetch origin` succeed through the inherited proxy. Do not restart the runtime or alter proxy settings on the basis of the earlier failures.

Bun 1.3.11 exists at `/tmp/rc0-tools/node_modules/.bin/bun`; command-scoped `PATH=/tmp/rc0-tools/node_modules/.bin:$PATH` restores tool invocation. The shell branch was rechecked: 41 tests pass, 143 assertions, exit 0, 14.43 seconds; serial typecheck passes 47/47 (cached). Missing worktree dependencies were linked to the existing installation. `core.hooksPath` is now `.husky`; its pre-push check passes 47/47, with no hook bypass.

The remaining blocker is GitHub write authorization. Network-enabled `git push -u origin agent/rc0-session-command-permission-20261002` returns HTTP 403, denied to Rwanbt. `gh pr merge 202 --squash --match-head-commit e1da341cb3bfbd9f22b6265347e1ff378267b737` returns GraphQL `Resource not accessible by integration`. The CLI reports login Rwanbt and account-level repository permissions including push/admin, but those do not establish integration-token write rights. The exact permission/configuration defect cannot be identified from these responses alone. No tool available here changes the GitHub installation's OAuth/App repository authorization. ChatGPT plugin permission modes govern action confirmation and cannot repair this provider-side 403.

Resume with the existing GitHub connection reauthorized for repository writes (Contents and Pull requests; Actions for reruns). A portable incremental Git bundle in `/workspace/unifia-rc0-recovery.bundle` preserves the four local agent branches, with prerequisite `dev@0b327298f8719fa47b40322a46ec4e1e97378a7d`. Verify it before importing in another checkout. Older proxy-unavailable/Bun-absent statements below are historical and superseded by this section.

## Exact repository state

- GitHub `dev` was verified through `gh` and the GitHub API at `0b327298f8719fa47b40322a46ec4e1e97378a7d`. A `git fetch --no-write-fetch-head` confirmed the local tracking ref at the same SHA.
- Shell permission fix commit: `6667bf427a1e7187f6f8cfbd1847fd53599f614e`, branch `agent/rc0-session-command-permission-20261002`, parent `0b327298f8719fa47b40322a46ec4e1e97378a7d`. It exists only in this Cloud clone; no remote branch or PR was created.
- Test-only fixes remain local on `agent/rc0-registry-test-hermetic-20261002` at `3d4013df31dea023c1440b3bcdccd61351481fdd` and `agent/rc0-project-switch-e2e-20261002` at `670a5332f7749d535189a0ed6d42849d9a4cc805`, both based on `0b327298f8719fa47b40322a46ec4e1e97378a7d`. Neither was pushed or opened as a PR.
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
- After read-only verification qualified #202 for squash, `github_merge_pull_request` with expected head `e1da341cb3bfbd9f22b6265347e1ff378267b737` also returned HTTP 403, `Resource not accessible by integration`. A Git push now fails earlier because Cloud cannot connect to proxy `proxy:8080`.
- No credentials were searched for or extracted. No PR was opened, so no PR checks exist for the shell fix. The fix remains local and is not delivered to `dev`.
- The Code Scanning alerts endpoint returned 403 (`Resource not accessible by integration`); the alternate GitHub Fetch endpoint rejects that API family. The live alert inventory could not be read. No alert was dismissed.

Current PR observations (2026-10-02):

| PR | Head | Current checks and state | Action |
|---|---|---|---|
| #202 Android target compiler | `e1da341cb3bfbd9f22b6265347e1ff378267b737` | Seven protected checks SUCCESS on exact head; CodeQL/Analyze, typecheck and nix-eval SUCCESS. Non-required E2E failed after missing project-switch selectors and timed out at 110 minutes (`36946939249`). | Qualified for squash, but GitHub merge API returned 403 with expected exact SHA. Still open. Real Android compile on `dev` remains pending. |
| #204 RC-0 journal | `e25cf19415ca5803ec394065abf5116010508807` | Linux unit failed on `tool.registry > loads tools with external dependencies without crashing`: 300015 ms against 300000 ms, 5260 pass/8 skip/1 fail. CodeQL and Analyze green. E2E job failed/timed out at 110 minutes; project-switch selectors absent, run 36949017341. Merge state was `DIRTY`. | `gh run rerun 36949017341 --failed` was refused: “workflow file may be broken.” No retry was forced. PR review-thread API returned no threads for #202 or #204. |

The #204 source diff contains only `docs/autonomy/rc0/EXECUTION-LOG.md`; that makes the missing project selectors pre-existing relative to its diff, but does not establish the cause of the registry timeout. Source analysis now establishes the blocking boundary: `ToolRegistry.build()` waits for all `Config` dependency promises when a custom tool exists; config loading starts `Config.installDependencies()` for writable directories, which calls `Npm.install()` and Arborist `reify()`. The old registry fixture declared real npm dependencies, so this discovery test depended on registry I/O and shared install locks. GitHub's 300015 ms log proves the timeout, but does not identify which `reify()` or lock operation consumed it. The unchanged local test failed before resolution with `proxy.url must be a non-empty string`; adding npm proxy variables did not change that Cloud-side failure, so it does not reproduce CI's five-minute wait.

A local correction is committed on `agent/rc0-registry-test-hermetic-20261002` at `3d4013df31`, parent `0b327298f8719fa47b40322a46ec4e1e97378a7d`: the entire registry test file mocks npm installation and provides a local ESM `cowsay` package, retaining real custom-tool discovery and module import. The full file passes 8/8 tests, 33 assertions, 2.30 s; package typecheck passes. This removes live npm and shared-lock dependence from the unit test; it does not qualify live `Npm.install()` behavior or establish the exact underlying CI stall. No timeout was changed. `git fetch` now fails because Cloud proxy host `proxy:8080` is unreachable, and earlier GitHub write APIs returned 403. The fix has no remote branch or PR; don't claim it delivered to `dev`.

Run `36946939249` for #202 confirms that the E2E locator expected a sidebar project-switch action that the current UI intentionally removed: sidebar rows disclose project content, while opening another project is available through Home. Run `36950762529` on merged dev also fails stale `server-default` and titlebar button assertions; the current server-status badge is in the Servers tab, and the titlebar explicitly has no Back/Forward buttons while navigation commands remain. These observations drove local test-only changes on `agent/rc0-project-switch-e2e-20261002` through `670a5332f7749d535189a0ed6d42849d9a4cc805`. Seven E2E files are updated to follow Home recents, the real disclosure selector, the Servers status tab, browser history and command-key navigation. `packages/app` typecheck and syntax bundling pass. The local Playwright harness still aborts before browser startup while npm reports `proxy.url must be a non-empty string`; no browser pass is claimed. E2E run `36950762529` contains other locator failures across different suites that are not yet classified and times out at 110 minutes.

The former PRs #138, #140, #143 and #144 are all MERGED; they were not replayed. Open Issues were read without creating, commenting on, or closing any.

## Gate and release status

**QA12R is not qualified.** The current `dev` SHA has not been frozen as a release candidate. Full CI/E2E evidence is incomplete, the package-wiring and complete security inventory are not established here, open P0/P1 disposition remains incomplete, and owner-only physical Android/Windows/Voice checks have not run. QA08 and VO02–VO05 remain owner-executed. Windows, Android, release signing, tag, deploy, publication and main-branch work were not performed.

RL00–RL02 and the RL01 release package are **not ready** because they depend on a green QA12R SHA. No release workflow was triggered; no dry-run artifact, tag or draft release was created. Release notes and rollback evidence must be tied to the eventual immutable candidate SHA.

## Resume sequence

1. Restore repository write authorization for the GitHub connection. Use the explicit executor network grant and command-scoped Bun PATH described above. Then push the shell-fix branch, `agent/rc0-registry-test-hermetic-20261002`, and `agent/rc0-project-switch-e2e-20261002` without force; open template-complete PRs for each coherent lot, respecting the four-open-PR limit.
2. Recheck #202's exact head/checks, retry the documented squash only with GitHub access restored, and after delivery to `dev` run the actual Android compiler/build validation.
3. Resolve #202/#204 using their fresh checks and evidence; do not replay the already merged historical PRs. Continue independent RC-0 tasks, then run the complete QA12R matrix on one immutable `dev` SHA.
4. Only after QA12R is green, finalize RL00, RL01 (notes, limitations, rollback, non-publishing dry run) and RL02. No `main`, tag, publication or physical owner test is in this handoff.

## Obsidian import block

## 2026-10-02 — [Unifia] — Résumé

- Mémoire : le bypass `session.command` exécutait les directives shell injectées avant `Permission.ask`; le correctif local `6667bf427a1e7187f6f8cfbd1847fd53599f614e` préautorise chaque commande finale et ses preuves passent (41 tests, 143 assertions, typecheck 47/47). Voir `packages/unifia/src/session/command-template.ts` et `packages/unifia/test/server/rc0-command-shell-witness.test.ts`.
- Le SHA `dev` vérifié reste `0b327298f8719fa47b40322a46ec4e1e97378a7d`. La branche agent et la PR n’ont pas pu être publiées : push Git et création de ref GitHub ont reçu 403. Aucun merge n’a eu lieu.
- #202 : sept checks requis + CodeQL/Analyze verts, E2E encore actif et vérification de compilation Android réelle restante. #204 : timeout `tool.registry` et échec E2E sur sélecteurs absents conservés; cause exacte du délai inconnue. Correctif hermétique local `3d4013df31`, 8 tests/33 assertions et typecheck verts; aucune PR.
- Mémoire #204 : le test de registre attendait `Config.waitForDependencies`, qui attend l’installation npm de ses répertoires; il faisait donc de la résolution et du verrouillage npm dans une suite unitaire. La fixture locale et le mock d’installation isolent le vrai import ESM. Voir `packages/unifia/test/tool/registry.test.ts` et l’entrée QA03 du `EXECUTION-LOG.md`.
- Les E2E de projet, serveur par défaut et historique de navigation ont des sélecteurs/scénarios dépassés par le contrat UI actuel. Corrections locales `agent/rc0-project-switch-e2e-20261002` (`670a5332f7`); typecheck/syntaxe passent, Playwright n’a pas démarré à cause du proxy npm. Voir les runs `36946939249`, `36950762529` et le journal.
- Le squash #202 qualifié a été refusé par l’API GitHub (403 `Resource not accessible by integration`); le push est bloqué par proxy inaccessible. Aucun changement distant. QA12R, RL00–RL02 et RL01 restent bloqués par preuves manquantes; tests physiques à Erwan. Aucun CodeQL rejeté. Voir le journal et le présent handoff.
