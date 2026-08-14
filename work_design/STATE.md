# Work/Design execution state

This file is the durable execution state for the Unifia Work/Design integration.

## Current state

- Branch: `work-design`
- Base commit: `91daa35a26a8e44d7f35b539c91030ec1e230c54`
- Current card: `M1c-i` (opaque native lease metadata)
- Status: `IMPLEMENTED_WITH_DEFERRED_HUMAN_PROOFS`
- Commit or push performed: yes; latest pushed SHA is `a04be041fa`.

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
| M1c | implemented with deferred platform proof | server handshake 5/5 + server 72/72 + bootstrap 40/40 + topology 4/4 + security/CORS 4/4 + shell bridge 5/5 + connection 2/2 | Server, shell and app contracts are implemented; concrete Tauri/Electron/Android bridge bindings and the human MV-01/MV-02 traces remain required. |
| M4 | implemented with deferred human proofs | workbench-shell typecheck + shell 122/122 + modes 4/4 + client 26/26 + bridge 5/5 + connection 2/2 | Typed client, bounded retry policy, SSE cursor resume, token refresh hook, event dispatcher, merge/gap rules, native adapter and identity-checked connection controller. Concrete platform bindings and packaged WebView proofs remain pending. |
| M5 | implemented with deferred human proofs | workbench-shell typecheck + shell 122/122 + modes 4/4 + client 7/7 + routes 11/11 | Total typed route registry with compile-time Work V1 coverage and explicit work/document versus design/render lineage. |
| M6 | implemented with deferred human proofs | workbench-server typecheck + server 72/72 + bootstrap 40/40 + security/preflight/topology + operations 2/2 | Reconnectable session SSE remains cursor-based; long prompt operations now receive idempotent operation IDs and can be cancelled through a scoped route. |
| M7 | implemented with deferred human proofs | contracts/workspace + workspace-runtime typecheck/tests + server 72/72 + shell typecheck + security guard | Bounded, root-confined file listing/search and protected `GET /v1/files/list` and `GET /v1/files/search` routes. |
| M8 | implemented with deferred human proofs | server typecheck + server 72/72 + security 3/3 + P3 C8/C9 7/7 + topology 4/4 | Pending approval listing scoped to a workspace, cursor/limit audit pages for trace/activity, distinct redacted server logging, and automatic-port ownership evidence are implemented; cross-process and manual checks remain. |
| M9a | implemented with deferred human proofs | artifact-runtime 38/38 + server 72/72 + typechecks + route registry | Artifact lineage listing/detail with provenance and base64 content, scoped by workspace read capability. |
| M9b | implemented with deferred human proofs | server typecheck + shell typecheck + server 72/72 | Artifact creation and revision route delegates to the persistent ArtifactStore under `artifact.create`. |
| M10 | implemented with deferred human proofs | server typecheck + shell typecheck + server 72/72 | Local artifact export route is capability-gated by `artifact.export`; destination stays inside ArtifactStore outbox and metadata defaults to strip. |
| M11 | implemented with deferred human proofs | spec/server/shell typechecks + server 72/72 | Server-side JSON spec validation delegates to `SpecRuntime`; requested capabilities are intersected with an empty workspace grant and never elevated. Design-system catalog source remains open under G6. |
| M12 | implemented with deferred human proofs | shell typecheck + shell 122/122 + modes 4/4 + client 11/11 + routes 11/11 | Typed client methods for bounded file listing/search, URL encoding, response typing, and export of all server route registries. |
| M13 | implemented with deferred human proofs | server 72/72 + shell 122/122 + client 13/13 + modes/routes contracts | Documents list route filters persisted artifact heads; client exposes typed artifact and document catalogs. |
| M14 | implemented with deferred human proofs | shell typecheck + client 17/17 | Client exposes typed bounded trace and activity pages with explicit cursors and page kinds. |
| M15 | implemented with deferred human proofs | shell typecheck + client 20/20 + routes 11/11 | Client exposes scoped approvals, capability search filters, and idempotent artifact export; capability-picker registry now points to the real search route. |
| M16 | implemented with deferred human proofs | shell typecheck + DesignSpecPanel 5/5 | Pure spec panel model preserves inline/file provenance, reports line/column diagnostics, and resolves requested capabilities against an empty grant. |
| M17 | implemented with deferred human proofs | shell typecheck + DesignRenderer 5/5 | Canonical escaped SVG renderer consumes validated spec/tokens with deterministic dimensions and output. |
| M18 | implemented with deferred human proofs | shell typecheck + DesignPreviewPanel 4/4 | Preview model exposes mobile/tablet/desktop SVG data sources and refuses invalid specs while preserving diagnostics. |
| M19a | implemented with deferred human proofs | shell typecheck + DesignFiles 5/5 | Workspace file page adapts to a sorted Design catalog with asset/component/style classification and safe selection. |
| M19b | implemented with deferred human proofs | shell typecheck + DesignFiles 6/6 | Design file rows expose stable labels, kinds, and selected state for a UI surface. |
| M20a | implemented with deferred human proofs | shell typecheck + DesignSystem 3/3 | Explicit injected Design System catalog schema validates id/version/source/tokens without discovering a new authority. |
| M20b | implemented with deferred human proofs | shell typecheck + DesignSystem 3/3 | Picker rows sort catalogs deterministically and preserve a validated selected id. |
| M21 | implemented with deferred human proofs | shell typecheck + ArtifactVersionPanel 4/4 | Artifact history ordering, structural diff, provenance display, and explicit export approval state are modeled from persisted artifact summaries. |
| M22 | implemented with deferred human proofs | shell typecheck + MobileNavigation 4/4 | Mobile navigation uses the shared route registry, switches drawer/rail by viewport, and carries Work/Design counts. |
| M23 | implemented with deferred human proofs | full Workbench Shell suite: 11 files, 0 failures; remote typecheck 35/35; release candidate file | Candidate release checklist is recorded; MV-01 through MV-10 remain pending and no signing/merge/publication is claimed. |
| M24 | implemented with deferred human proofs | app typecheck + app unit suite 704/704 + production build | Existing Workbench route renders the shared Work registry with operation selection and Design with editable validation diagnostics plus inert responsive SVG previews; native, lifecycle, and publication gates remain pending. |
| M1c-a | implemented with deferred native proof | workbench-server handshake 4/4 + shell client 22/22 + server typecheck; unsupported versions are refused and decisions are audited | `/v1/handshake` now exchanges the versioned wire payload and preserves a server instance id. Native token issue/rotate/revoke remains the M1c blocker. |
| M1c-b | implemented with deferred native proof | shell typecheck + client 26/26 | `WorkbenchClient.applyTokenRotation()` validates the executable wire contract and serializes requests until the native provider completes rotation; native bridge and server acceptance proof remain pending. |
| M1c-c | implemented with deferred native proof | workbench-server typecheck + handshake 4/4 + server 72/72 + bootstrap 40/40 + topology 3/3 + security/preflight 4/4 | `ScopedTokenAuthority` is injected into `WorkbenchServer`; internal native-only issue/rotate/revoke methods bind tokens to the process instance and audit decisions. No HTTP token route is exposed. |
| M1c-d | implemented with deferred platform proof | shell typecheck + NativeTokenBridge 4/4 + client 26/26 | `createNativeTokenProvider` adapts issue/rotate/revoke to the shell `TokenProvider`, validates returned lease data, and keeps signing material outside the WebView. Platform bindings remain pending. |
| M1c-e | implemented with deferred platform proof | Workbench Server handshake 5/5 + server 72/72 + bootstrap 40/40 + topology 3/3 + security/CORS 4/4 + typecheck | Native scoped tokens are now registered as workspace sessions, accepted through issuer fallback, preserved across rotation grace, and fully removed on revoke. |
| M1c-f | implemented with deferred platform proof | shell 13 scripts: WorkbenchConnection 2/2, Client 26/26, NativeTokenBridge 4/4; shell typecheck PASS | `connectWorkbench` creates the client only after decoding the native lease identity, completing the handshake, and checking server instance continuity; close remains explicit through native revoke. |
| M1c-g | implemented with deferred platform proof | app typecheck PASS + 704/704 tests + production build PASS | `Platform.workbench.connect` is now an explicit native-only injection point; Workbench mode consumes it when present, shows pending state otherwise, and revokes on cleanup. |
| M1c-h | implemented with deferred platform proof | NativeTokenBridge 5/5 + WorkbenchConnection 2/2 + shell typecheck PASS | Rotation accepts the structured server lease or an adapted string, while issue/rotation reject wrong-workspace and expired leases. |
| M1c-i | implemented with deferred platform proof | WorkbenchShell 13 scripts + typecheck PASS | `connectWorkbench` now uses validated metadata returned by the native adapter and never decodes JWT payloads in the WebView. |
| M8-a | implemented with deferred process proof | WorkbenchTopology 4/4 | Two concurrent automatic-port listeners receive distinct ports and process identities; occupied-port rejection and restart identity remain covered. |
| M9-a | implemented with deferred packaged interaction proof | `node scripts/check-workbench-security.mjs` PASS | The guard now parses desktop/mobile CSP JSON and asserts loopback connect-src, data images, object-src none, and frame-ancestors none. |
| M7-a | implemented with deferred process proof | server typecheck + topology 3/3 | `WorkbenchHandle` now exposes the process `instanceId`; restart tests prove the released port is reusable without reusing the previous process identity. |

## Manual verification register

See `work_design/MANUAL-VERIFICATION.md`. Items MV-01 through MV-10 are intentionally pending until a human runs the desktop, Android, UI, lifecycle, CSP, and publication checks.

See `work_design/BLOCKERS.md` for the code-level causes and the safe unlock order.

## Validation log

- `git status --short --branch` → clean on `work-design`
- `git log -1 --oneline` → `28b7827b31 test(workbench): prove fresh instance identity on restart`
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
- `node scripts/unifia-conformance.mjs --json unifia-conformance.json` → PASS (8/8) after adding SPDX headers to seven owned test files that the CI gate correctly required.
- Android runtime preparation → PASS: Alpine `rootfs.tgz` generated at 824426778 bytes; the WSL branch and Bun-unavailable bundle reuse path in `packages/mobile/scripts/prepare-android-runtime.sh` were exercised.
- Android release build → PASS (exit 0): unsigned APK and AAB generated under `packages/mobile/src-tauri/gen/android/app/build/outputs/`; APK size 1115164803 bytes, AAB size 1066480647 bytes.
- `bun scripts/check-android-runtime.mjs` from `packages/mobile` → PASS: rootfs and 30 native libraries present. The ORT binary was supplied from an existing local prepared worktree through an ignored hardlink; no source checkout was modified.
- Android build warnings remain: Gradle reports a debuggable release build and the native ORT sync reports a Windows file-lock warning. These require review before treating the artifact as release-ready.
- The source APK remains unsigned; a local debug-signed copy was installed and executed on `b7163823`. No release signing, merge, or publication was performed; MV-03/MV-04 and all other human gates remain pending.
- M1c token implementation → `ScopedTokenIssuer` now owns workspace + instance + capability scoped tokens, short TTL, rotation grace, and close-time revocation; focused auth/security/preflight/topology validation passes (6 tests, 0 failures).
- M4 implementation → `packages/workbench-shell/src/client.ts` adds `WorkbenchClient`, `WorkbenchEventDispatcher`, bounded authentication retry, idempotency-aware mutation handling, SSE parsing, cursor continuation, and token-rotation hook; client contract test passes 7/7.
- M5 implementation → `packages/workbench-shell/src/routes.ts` adds total `WORKBENCH_ROUTE_REGISTRY`, route helpers, capability/event mapping, and artifact lineage discriminants; route contract passes 11/11.
- M6 implementation → operation registry adds idempotent operation tracking, asynchronous prompt execution, scoped cancellation, and typed M6 route registration; operation tests pass 2/2 and existing server suites remain green.
- M7 implementation → `WorkspacePort` now exposes bounded listing/search; `WorkspaceRuntime` resolves real paths inside the registered root, refuses escapes and enforces an entry quota; Workbench routes apply workspace auth and `workspace.read`; runtime and server assertions cover list/search.
- M8 implementation → `ApprovalBroker.pending()` and `GET /v1/approvals` expose only live requests for the authorized workspace; audit pages support bounded cursors for `/v1/trace` and `/v1/activity`; `ServerLogger` is separate from audit, defaults to info, redacts sensitive fields, filters debug, and rotates at a size limit.
- M9a implementation → `ArtifactStore.list()` returns latest heads from the authoritative on-disk lineage manifests; Workbench artifact list/detail routes enforce workspace scope and `workspace.read`, expose provenance, and encode bytes explicitly as base64.
- M9b implementation → `POST /v1/artifacts` creates a new lineage or version, validates the workspace bearer scope and `artifact.create`, and delegates persistence/provenance/versioning to `ArtifactStore`.
- M10 implementation → `POST /v1/artifacts/export` checks `artifact.export` before exporting the verified latest version through `ArtifactStore`; outbox names remain path-safe and metadata is stripped unless explicitly kept.
- M11 implementation → `POST /v1/specs/validate` parses untrusted specs through `SpecRuntime`, returns explicit denied capabilities, and does not infer or create a design-system catalog source while G6 remains open.
- M12 implementation → `WorkbenchClient.listFiles/searchFiles` consume the protected M7 routes with typed entries, deterministic query parameters and abort signals; the shell index now exports M6–M11 route registries.
- M13 implementation → `GET /v1/documents` exposes non-binary persisted artifact heads under workspace read scope; the client adds typed artifact/document catalog methods without creating a second store.
- M14 implementation → `WorkbenchClient.trace/activity` consume the existing scoped audit pages with typed events, bounded cursors, and deterministic query parameters.
- M15 implementation → `WorkbenchClient.listApprovals/searchCapabilities/exportArtifact` consumes the existing server authorities; capability search is explicitly `package.install` gated and export uses an idempotency key.
- M16 implementation → `createDesignSpecPanelState` is the shared pure model for Design spec input and diagnostics; it delegates validation to `SpecRuntime` and never elevates capabilities.
- M17 implementation → `renderDesignSpecSvg` is the shared deterministic SVG authority; it escapes spec text and applies only validated token values.
- M18 implementation → `createDesignPreviewPanelState` derives three canonical responsive previews from the renderer and never emits an image for invalid input.
- M19a implementation → `adaptDesignFiles` is the sole adapter from the bounded workspace index to Design file categories; directories and absent selections are excluded.
- M19b implementation → `renderDesignFileRows` projects the adapted catalog into stable panel rows and marks only the validated selection.
- M20a implementation → `parseDesignSystemCatalog` validates an explicitly supplied catalog and keeps G6 open by requiring its source rather than inventing one.
- M20b implementation → `createDesignSystemPickerRows` provides deterministic labels, versions, sources, and selection state.
- M21 implementation → `createArtifactVersionPanelState` and `diffArtifactVersions` expose ordered history, provenance, changed fields, and an export state that is false until an approved export result exists.
- M22 implementation → `createMobileNavigationModel` reuses the shared eleven-route registry for mobile and exposes deterministic drawer/rail and Work/Design surface counts.
- M23 implementation → `work_design/RELEASE-CANDIDATE.md` records the completed implementation scope, automated evidence, open G6 decision, and all human release gates without declaring release readiness.
- Fresh conformance rerun → PASS 8/8: 43 suites, 25 owned packages lint clean, typecheck 35/35; browser E2E remains explicitly skipped and Gate C remains NO-GO on its documented external conditions.
- M1c-d validation → shell suite 5 scripts, including NativeTokenBridge 4/4; app typecheck and production build PASS; Workbench security guard and conformance 8/8 PASS; browser/device/manual gates remain pending.
- M1c-e validation → Workbench Server handshake 5/5, server 72/72, bootstrap 40/40, topology 3/3, security/CORS 4/4, and typecheck PASS; platform bridge and browser/device/manual gates remain pending.
- M1c-f validation → WorkbenchShell 13 scripts pass, including WorkbenchConnection 2/2; shell typecheck PASS. Desktop/mobile concrete bridge bindings and browser/device/manual gates remain pending.
- M1c-g validation → app typecheck PASS, 704/704 tests, production build PASS with existing Vite warnings. Desktop/mobile concrete bridge bindings and browser/device/manual gates remain pending.
- M8-a validation → WorkbenchTopology 4/4 confirms two automatic-port servers do not share a listener or process identity; the full cross-process desktop proof remains pending.
- M9-a validation → WorkbenchSecurityGuard parses both packaged configuration CSPs and passes explicit origin, loopback, data-image, object and frame policies; MV-09 still needs packaged artifact extraction and interactive URL checks.
- M1c-h validation → NativeTokenBridge 5/5, WorkbenchConnection 2/2, and shell typecheck PASS; concrete platform bridge and manual scope/expiry evidence remain pending.
- M1c-i validation → WorkbenchShell 13 scripts pass, NativeTokenBridge 5/5, WorkbenchConnection 2/2, and typecheck PASS; concrete platform bridge and manual evidence remain pending.
- Current checkpoint → `e2a82c953e refactor(workbench): keep native lease metadata opaque`; worktree clean, branch `work-design`, remote typecheck 35/35.
- GitHub Actions → run `31761195329` (`unifia-conformance`) completed `success` on code commit `aede7fc1c5fba75e7b857a657ce8b70f90a5ffd5`; subsequent pushes `54abaa8394` are documentation-only and outside the workflow path filter.
- Device observation → APK debug source remained unsigned; a local debug-signed copy installed on `b7163823`, `MainActivity` resumed, and `/global/health` returned `healthy=true` on loopback `127.0.0.1:14096`; MV-03/MV-04 remain pending for their full procedures.
- Lifecycle sub-test → same PID `6866` and resumed `MainActivity` after relaunch; MIUI refused `adb shell input keyevent` with missing `INJECT_EVENTS`, so true background/foreground behavior remains unproven.
- CSP static extraction → desktop and mobile Tauri configurations declare explicit loopback/IPC origins, `img-src data:`, `object-src 'none'`, and `frame-ancestors 'none'`; the runtime server CSP is self/data-only. Packaged-bundle and interactive URL checks remain MV-09.
- M24 UI wiring → `packages/app/src/pages/workbench-mode.tsx` now composes `createMobileNavigationModel`, `createDesignSpecPanelState`, and `createDesignPreviewPanelState`; app typecheck passes and the unit suite reports 704/704.
- M24 production bundle → `bun run --cwd packages/app build` PASS; Vite emitted only pre-existing chunk-size, CSS minifier, and dynamic-import warnings.
- M24 interaction → Work operation cards now select a scoped operation; Design spec editing recomputes line/column diagnostics and previews without executing markup. Typecheck, 704/704 unit tests, and production build pass.

## Resume first

1. Read this file, `DECISIONS.md`, and `../INTEGRATION.md`.
2. Review the M0b diff and run the CI workflow on the first PR.
3. M24 UI wiring is implemented; M1c-g injects the live connection point into the app, and M8-a strengthens automatic-port ownership evidence. Native platform bindings and MV-01 through MV-10 remain open. Do not sign, merge, publish, or mark the candidate release-ready from automated checks alone.
