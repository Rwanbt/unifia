# Work/Design execution state

This file is the durable execution state for the Unifia Work/Design integration.

## Current state

- Branch: `work-design`
- Base commit: `91daa35a26a8e44d7f35b539c91030ec1e230c54`
- Current card: `M1c`
- Status: `BLOCKED_ON_HUMAN_DEVICE_GATE`
- Commit or push performed: no

## Cards

| Card | Status | Evidence | Notes |
|---|---|---|---|
| M0 | completed | Branch and clean worktree verified | Base is the local `dev` branch requested for this worktree. |
| M0b | completed | State files, integration ownership map, size gate, and merge simulation workflow created | 152 changed lines measured; local checks pass. |
| M1a | completed | Nine gate decisions recorded in `DECISIONS.md` from the reviewed master plan | No code or generated output changed. |
| M1b | completed | Identity variants and port lifecycle tests added; existing bootstrap proves approval flow and loopback binding | Approval persistence across process restarts remains an M8 concern. |
| M2a | completed | Export, app dependency, lockfile, runtime coherence test, and declaration-only registry guard pass | Existing test fixtures are not treated as authorities. |
| M2b | completed | Persistent per-directory mode context, four-mode rail, sibling routes, local state page, and app tests | No network client or server route introduced. |
| M3 | completed | `@unifia/contracts/workbench-wire` typecheck + 5 tests | Executable wire schemas, reconciliation rules, cursor/idempotency/token policies, binary references, handshake and rate limits. |
| M1c | blocked on human device gate | workbench-server typecheck + security 2 tests + preflight 1 test + server 72/72 + bootstrap 40/40 + topology 3/3 | CORS/origin/preflight and aligned mobile CSP implemented. Native token injection/rotation and real Android WebView SVG proof remain required before M4. |

## Manual verification register

See `work_design/MANUAL-VERIFICATION.md`. Items MV-01 through MV-10 are intentionally pending until a human runs the desktop, Android, UI, lifecycle, CSP, and publication checks.

## Validation log

- `git status --short --branch` → clean on `work-design`
- `git log -1 --oneline` → `91daa35a26 feat: complete the Unifia rebrand and repair the desync it left behind (#23)`
- `bash scripts/check-pr-size.sh dev` → 152 changed lines, under the 400-line limit
- `.github/workflows/work-design-integrity.yml` → merge-tree, size, and whitespace checks declared
- `DECISIONS.md` M1a gate table → nine plan decisions recorded
- `bun run --cwd packages/workbench-shell test` → PASS (122/122 + mode contract 4/4)
- `bun run --cwd packages/spec-runtime test` → PASS (37/37)
- `bun run --cwd packages/app typecheck` → PASS
- `node scripts/check-mode-registry.mjs` → PASS after limiting detection to registry declarations
- `bun run --cwd packages/app typecheck` → PASS
- `bun run --cwd packages/app test:unit` → PASS (704 tests, 0 failures)
- M2b scope check → no Workbench network request or server route introduced
- `bun run --cwd packages/workspace-runtime typecheck` → PASS after making the package-local compiler invocation explicit
- `bun run --cwd packages/workspace-runtime test` → PASS (12/12 + 5/5 + 12/12 + 4/4)
- `bun run --cwd packages/workbench-server typecheck` → PASS after making the package-local compiler invocation explicit
- `bun run --cwd packages/workbench-server test` → PASS (72/72 + 40/40 + 3/3)
- `bun x tsc --noEmit -p packages/contracts/tsconfig.json` → PASS
- `bun test packages/contracts/test/workbench-wire.test.ts` → PASS (5/5)
- `bun run --cwd packages/workbench-server typecheck` → PASS after explicit origin/CORS policy
- `bun test packages/workbench-server/test/security.test.ts` → PASS (2/2)
- `bun test packages/workbench-server/test/server.test.ts` → PASS (72/72)
- `bun test packages/workbench-server/test/bootstrap.test.ts` → PASS (40/40)
- `bun test packages/workbench-server/test/topology.test.ts` → PASS (3/3)
- `node scripts/check-workbench-security.mjs` → PASS locally; CI guard added for server/desktop/mobile Origin and CSP alignment
- Android runtime preparation → PASS: Alpine `rootfs.tgz` generated at 824426778 bytes; the WSL branch and Bun-unavailable bundle reuse path in `packages/mobile/scripts/prepare-android-runtime.sh` were exercised.
- Android release build → PASS (exit 0): unsigned APK and AAB generated under `packages/mobile/src-tauri/gen/android/app/build/outputs/`; APK size 1115164803 bytes, AAB size 1066480647 bytes.
- `bun scripts/check-android-runtime.mjs` from `packages/mobile` → PASS: rootfs and 30 native libraries present. The ORT binary was supplied from an existing local prepared worktree through an ignored hardlink; no source checkout was modified.
- Android build warnings remain: Gradle reports a debuggable release build and the native ORT sync reports a Windows file-lock warning. These require review before treating the artifact as release-ready.
- No APK installation, device execution, signing, commit, push, merge, or publication was performed; MV-03/MV-04 and all other human gates remain pending.
- M1c token implementation → `ScopedTokenIssuer` now owns workspace + instance + capability scoped tokens, short TTL, rotation grace, and close-time revocation; focused auth/security/preflight/topology validation passes (6 tests, 0 failures).

## Resume first

1. Read this file, `DECISIONS.md`, and `../INTEGRATION.md`.
2. Review the M0b diff and run the CI workflow on the first PR.
3. M1c is partially implemented; the server-side issuer is present, but do not start M4 until platform-native bridge/rotation wiring and real Android `<img src="data:…">` proof are supplied.
