# Work/Design execution state

This file is the durable execution state for the Unifia Work/Design integration.

## Current state

- Branch: `work-design`
- Base commit: `91daa35a26a8e44d7f35b539c91030ec1e230c54`
- Current card: `M9b`
- Status: `IMPLEMENTED_WITH_DEFERRED_HUMAN_PROOFS`
- Commit or push performed: yes (through M7; latest SHA recorded after commit)

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
| M4 | implemented with deferred human proofs | workbench-shell typecheck + shell 122/122 + modes 4/4 + client 7/7 | Typed client, bounded retry policy, SSE cursor resume, token refresh hook, event dispatcher and merge/gap rules. Native bridge and packaged WebView proofs remain pending by explicit user decision. |
| M5 | implemented with deferred human proofs | workbench-shell typecheck + shell 122/122 + modes 4/4 + client 7/7 + routes 11/11 | Total typed route registry with compile-time Work V1 coverage and explicit work/document versus design/render lineage. |
| M6 | implemented with deferred human proofs | workbench-server typecheck + server 72/72 + bootstrap 40/40 + security/preflight/topology + operations 2/2 | Reconnectable session SSE remains cursor-based; long prompt operations now receive idempotent operation IDs and can be cancelled through a scoped route. |
| M7 | implemented with deferred human proofs | contracts/workspace + workspace-runtime typecheck/tests + server 72/72 + shell typecheck + security guard | Bounded, root-confined file listing/search and protected `GET /v1/files/list` and `GET /v1/files/search` routes. |
| M8 | implemented with deferred human proofs | server typecheck + server 72/72 + security 3/3 + P3 C8/C9 7/7 | Pending approval listing scoped to a workspace, cursor/limit audit pages for trace/activity, and a distinct redacted/level-filtered rolling server logger. |
| M9a | implemented with deferred human proofs | artifact-runtime 38/38 + server 72/72 + typechecks + route registry | Artifact lineage listing/detail with provenance and base64 content, scoped by workspace read capability. |
| M9b | implemented with deferred human proofs | server typecheck + shell typecheck + server 72/72 | Artifact creation and revision route delegates to the persistent ArtifactStore under `artifact.create`. |

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
- M4 implementation → `packages/workbench-shell/src/client.ts` adds `WorkbenchClient`, `WorkbenchEventDispatcher`, bounded authentication retry, idempotency-aware mutation handling, SSE parsing, cursor continuation, and token-rotation hook; client contract test passes 7/7.
- M5 implementation → `packages/workbench-shell/src/routes.ts` adds total `WORKBENCH_ROUTE_REGISTRY`, route helpers, capability/event mapping, and artifact lineage discriminants; route contract passes 11/11.
- M6 implementation → operation registry adds idempotent operation tracking, asynchronous prompt execution, scoped cancellation, and typed M6 route registration; operation tests pass 2/2 and existing server suites remain green.
- M7 implementation → `WorkspacePort` now exposes bounded listing/search; `WorkspaceRuntime` resolves real paths inside the registered root, refuses escapes and enforces an entry quota; Workbench routes apply workspace auth and `workspace.read`; runtime and server assertions cover list/search.
- M8 implementation → `ApprovalBroker.pending()` and `GET /v1/approvals` expose only live requests for the authorized workspace; audit pages support bounded cursors for `/v1/trace` and `/v1/activity`; `ServerLogger` is separate from audit, defaults to info, redacts sensitive fields, filters debug, and rotates at a size limit.
- M9a implementation → `ArtifactStore.list()` returns latest heads from the authoritative on-disk lineage manifests; Workbench artifact list/detail routes enforce workspace scope and `workspace.read`, expose provenance, and encode bytes explicitly as base64.
- M9b implementation → `POST /v1/artifacts` creates a new lineage or version, validates the workspace bearer scope and `artifact.create`, and delegates persistence/provenance/versioning to `ArtifactStore`.

## Resume first

1. Read this file, `DECISIONS.md`, and `../INTEGRATION.md`.
2. Review the M0b diff and run the CI workflow on the first PR.
3. M9b code is present by explicit user override; keep MV-01 through MV-04 pending until platform-native bridge/rotation wiring and real Android `<img src="data:…">` proof are supplied.
