# Unit test collection and deterministic CI gates

The PR unit workflow runs `node --test scripts/tests/unit-collection.test.mjs`, then
`node scripts/verify-unit-collection.mjs`, before `bun turbo test:ci --concurrency=2`.
Turbo test tasks have caching disabled so old green results cannot replace a new run.

## Collection contract

The collector discovers Git-tracked `.test`/`.spec` JavaScript/TypeScript files in
workspace packages and checks that the owning package exposes a reachable
`test:ci` runner. This checks **test selection**, not executed branch/line coverage
or the quality of the assertions. Its tests verify a newly uncovered test fails
closed and that removed exceptions cannot stay on the allowlist.

A small number of older packages invoke assertion scripts directly. They use
`scripts/run-legacy-unit.mjs`, which wraps the original test command in a Node
test and requires a successful exit and a nonzero, internally consistent
`N/N passed` counter. These should eventually migrate to native `bun:test`
test declarations.

Two explicit cases remain outside the hermetic unit gate:
- `packages/unifia/test/session/structured-output-integration.test.ts` depends on a real external Gemini API and its quota.
- `packages/workbench-server/test/real-transport.test.ts` requires the external Chromium transport harness.

The DBOS real-binary cases in `automate-m0-harness` remain conditionally skipped
unless the required binary is built; a green unit job does **not** certify them.

## Reliable local checks

Use the repository's pinned Bun **1.3.11**, not an unrelated global Bun version.
Run `node scripts/verify-unit-collection.mjs` and
`node --test scripts/tests/unit-collection.test.mjs`, then targeted
`bun run --cwd packages/<name> test:ci` commands.

On a resource-constrained Windows machine, running the full core suite along
with UI tests can produce environment failures. Ensure sufficient free
temporary disk space. For Git Bash-dependent tests, use Git for Windows Bash;
Windows `C:\Windows\system32\bash.exe` may refer to unavailable WSL.
CI Linux supplies Bash. Never treat ENOSPC, an absent shell, a missing fixture
binary, or a dependency startup error as a proven product regression.

## Not yet claimed

The gate does not establish 100% line, branch, mutation, accessibility or E2E
coverage. A future instrumented per-package coverage budget should be set only
after collecting a reproducible baseline. No broad E2E campaign is added here.
