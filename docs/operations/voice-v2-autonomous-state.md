<!-- SPDX-License-Identifier: MIT -->
# Voice v2.2 Autonomous Execution State

**Issue:** [#117](https://github.com/Rwanbt/unifia/issues/117) (open, assigned to `Rwanbt`)

**Branch:** `voice`

**Baseline HEAD:** `261cef41351ae7804a07e811e775e056be51f9d5`

**Last source SHA with both required remote workflows green:** `14f0aa791ffa16adfdb488da3c4f7bb2bcb24c12` (`voice-ci` 36243451608; `unifia-conformance` 36243451545).

**Current source HEAD:** `af13bb2d1290ef40deb3edc273683389497ecc42` on `voice` and `origin/voice` (fetched and verified). Local changes below are not yet committed.

**Current worktree:** implementation is committed and remotely green at `14f0aa791ffa16adfdb488da3c4f7bb2bcb24c12`. `packages/voice-core` adds event sequencing, idempotency-key deduplication, timestamp monotonicity, generation fencing across reconnect/recovery, turn tokens, and playback-only cancellation; ADR-060 selects Rust as canonical. Production event producers have not migrated. Untracked build/cache artifacts remain preserved and unstaged.

**G0 commits pushed:** `e00bf2a388`, `e81cb76c9c`, `35f05b6f37`, `3cd2a3bc66`, `5e77352883`, `386fdcf5ea`.

**Updated:** 2026-09-26

## Verdict

**IN PROGRESS — NOT GO PROD.** Both G0 workflows are green on exact SHA `46f6686851`. G1 readiness and microphone gating are pushed at `5b7d69dff6`; cause-category metadata and provider identity validation are pushed at `33b6b4e7df`; binding-scoped pre-session errors are pushed at `46f6686851`. G1 remains partial: selected LLM/provider health is unverified and Android/local/desktop emitters are not unified. No production qualification is inferred from unit tests or scaffolds.

## Gate State

| Gate | State | Evidence / remaining work |
|---|---|---|
| G0 — Truth and CI | Green | Exact SHA `46f6686851e3e4df4dabb3345a50f4e290485bde` passed `voice-ci` `36242039225` and `unifia-conformance` `36242039213`. |
| G1 — Contracts and ADR reconciliation | Partial | Python publishes session-scoped `voice_ready` on reliable data and participant attributes; TypeScript requires it before opening the microphone. Error envelopes include required `cause_category`, optional validated provider identity, and stable codes for all 21 stages. The current local change adds binding-scoped errors before session creation and persistent error attributes. Remaining: selected LLM/provider readiness beyond bridge reachability, other Android/local/desktop emitters, completed ADR adoption evidence, model registry/security reconciliation. |
| G2 — Shared VoiceCore | In progress | Portable `packages/voice-core` defines typed error/event contracts, sequence assignment, idempotency-key deduplication, monotonic timestamp checks, generation fencing, turn tokens, playback-only cancellation, reconnect, and snapshot recovery. Rust unit tests cover duplicate retries, ordering, stale generations, cancellation races, reconnect, and recovery; the Tauri runtime links the crate. Production producers, complete lifecycle state machine, durable persistence, adapters, and cross-runtime fixture parity remain open.
| G3 — Native Android audio | Not started | Android Live still uses WebView capture/playback; native full-duplex and AEC need implementation and device qualification. |
| G4 — VAD and EOT | Not started | Real Android Silero and qualified EOT model/audio corpus remain open. |
| G5 — Streaming STT | Not started | Android Parakeet is batch/final transcription; real streaming parity is open. |
| G6 — AgentBridge streaming | Not started | Verify actual prompt/event-stream wiring, not only interfaces or mocks. |
| G7 — Pocket Android | Not started | Current Pocket Android backend is deterministic scaffolding; qualify a real neural runtime. |
| G8 — Canonical TTS | Not started | Wire the router to the real Live/manual/preview paths and qualify fallback behavior. |
| G9 — Full duplex | Not started | AEC, self-echo control, and barge-in require physical evidence. |
| G10 — FastDecision | Not started | Rules-first implementation and measurements remain open. |
| G11 — Resource scheduling | Partial | TypeScript/Python/Rust scheduler logic exists and has unit tests; actual model residency/provider wiring and hardware pressure qualification remain open. |
| G12 — Android standalone | Not started | Airplane-mode, local LLM, five-language, endurance, and duplex physical gates remain open. |
| G13 — Desktop convergence | Not started | Shared core must become canonical; document compatibility or retirement of the legacy path. |
| G14 — Production hardening | Not started | Registry integrity, security, packaging, final CI, documentation, and evidence remain open. |

## Checks Run

- `bun test --preload ./happydom.ts ./src/voice` in `packages/app`: **118 passed**, 0 failed, 481 assertions.
- `bun run typecheck` in `packages/app`: passed.
- `cargo test --lib voice:: --no-fail-fast` in `packages/mobile/src-tauri`: **15 passed** (one unrelated unused-import warning).
- Python resource scheduler/platform-signal tests: **26 passed** with system Python when run from `packages/voice-host` with cache disabled; the wiring test could not collect there because `livekit` is absent.
- Full `scripts/voice/voice-host-test-runner.py --full` with elevated network access: **156 passed, 1 skipped**, after `uv sync`, pytest install, and smoke imports succeeded.
- Skip classification: `tests/test_live_transport_integration.py:390` is explicitly skipped because it requires `livekit-server`, `espeak-ng`, and Bun. This is an integration prerequisite gap, not a collection failure; that live transport integration remains unqualified.
- `voice-ci.yml` parsed successfully after the local repair; workflow dispatch is present and all configured jobs are blocking; `git diff --check` passed.
- Current validator rerun: the registry CLI executed under Node 22, validated 6 entries, and reported 2 missing model groups; 4 self-tests passed. The CLI entrypoint now uses Node-compatible `fileURLToPath` detection.
- `node scripts/voice/model-registry-validator.mjs`: **6 entries structurally valid**, with an explicit warning that 2 required model groups remain missing.
- `node scripts/voice/model-registry-validator.test.mjs`: **4 direct Node self-tests passed**, including digest mismatch detection. This validates the helper, not model download, extraction, atomic promotion, or runtime loading.
- `bunx biome check packages/app/src/voice packages/contracts/src packages/contracts/test scripts/voice/model-registry-validator.mjs scripts/voice/model-registry-validator.test.mjs`: passed; **151 files checked**.
- Current targeted rerun: App Voice **118 passed**, contracts **701 passed**, Rust scheduler **15 passed**; app and contract typechecks passed.
- G1 checkpoint targeted rerun: app Live controller/state/orb plus contracts speech tests **39 passed**, 0 failed, 160 assertions; app and contracts typechecks passed. This proves only the new TypeScript contract and touched Live UI/controller path, not full G1 adoption.
- Latest full app run: **1,799 passed**, 0 failed across 213 files; latest contracts run: **704 passed**, 0 failed across 46 files.
- Latest targeted controller/contracts rerun after session-correlation and payload-registry checks: **31 passed**, 0 failed; app and contracts typechecks plus Biome on the changed TypeScript files passed.
- Latest Voice Host suite: **159 passed, 1 skipped**. The skip remains the live transport integration requiring livekit-server, espeak-ng, and Bun.
- Cross-runtime serialization check: Python `encode_voice_error_event()` produced a `SESSION_AGENT_ERROR` envelope that TypeScript `isVoiceErrorEvent()` accepted (`sessionID=ses_cross`, `seq=1`).
- Current pre-push gate on `f039a92d98`: **47/47 typechecks passed**.
- Current pre-push gate on `dbf5d111db`: **47/47 typechecks passed**; push hook completed successfully.
- Current remote gate on exact SHA `dbf5d111db`: `voice-ci` run `36239716868` **success** (including app Voice tests/typecheck, contracts tests/typecheck, docs, Rust scheduler, model registry/integrity, Voice Host full suite, and SpeechRenderer security); `unifia-conformance` run `36239716904` **success**. Remote Voice Host full suite: **163 passed, 1 skipped**.
- The local targeted Voice Host rerun in this session was impeded by sandbox `PermissionError` while tests wrote temporary fake Piper scripts; this does not supersede the successful exact-SHA remote suite. It yielded 29 passed, 2 environment-failed, 1 skipped.
- Current G1 local verification on the uncommitted worktree: App Voice **123 passed**; contracts **705 passed**; app and contracts typechecks passed; Voice Host full suite **167 passed, 1 skipped**; Ruff checks passed for all touched Python files.
- Native model prewarm smoke on this Windows host called `livekit.local_inference._native.init_vad()` and `init_eot()` successfully. This confirms model initialization only; it is not an EOT accuracy, latency, or production qualification result.
- Latest G1 error-envelope verification on local HEAD `5b7d69dff6`: App Voice suite **123 passed**; contracts suite **706 passed**; app and contracts typechecks passed; Python↔TypeScript accepted an actual `STT_PROVIDER_UNAVAILABLE` payload with `cause_category=availability`, `provider_id=parakeet`, and `seq=7`. Voice Host full suite: **169 passed, 1 skipped, 25 subtests passed**; the skip is the existing live transport integration requiring livekit-server, espeak-ng, and Bun.
- Exact-SHA G1 evidence for `46f6686851`: App Voice suite **124 passed** and app typecheck passed; contracts suite **707 passed** and contracts typecheck passed; Voice Host suite **171 passed, 1 skipped, 25 subtests passed**; Biome checked all five changed TypeScript files; Python→TypeScript accepted a real binding-scoped `PROVIDER_BINDING_INVALID` event. These suites were run on the source tree immediately before the commit; the committed source is identical.
- GitHub run `36238924843` (`voice-ci`) and `36238924934` (`unifia-conformance`) both passed on `f039a92d98`.
- The full app (**1,799 tests**) and contracts (**704 tests**) runs preceded the final event-schema alignment change that removed a non-ADR `causeCategory` field; after that correction, the focused controller/contracts suite passed **31 tests**, both typechecks and Biome passed, and the Python suite remained **159 passed, 1 skipped**. The new source diff still requires remote CI.
- Current pre-commit Rust checks: `cargo clippy --all-targets -- -D warnings` passed after fixing two scheduler lint findings and documenting the Android-only bearer re-export; targeted Rust scheduler tests remained **15/15 green**.
- Current Python targeted rerun: `python -m pytest -p no:cacheprovider tests/test_resource_scheduler.py tests/test_platform_signals.py -q` from `packages/voice-host`: **26 passed**.
- Local reproduction of the formerly failing isolated renderer step with the workflow's `PYTHONPATH`: **53 passed**. The workflow parser now confirms this environment and the Windows Rust runner selection.
- GitHub Actions run `36231800987` on `3cd2a3bc66`: app (**118 tests**), contracts (**701 tests**), docs, registry CLI, registry integrity helper tests, and full Python Host suite passed. The explicit SpeechRenderer step failed collection because `PYTHONPATH` was absent. Rust scheduler step failed because Ubuntu lacked `glib-2.0` / `gobject-2.0` development packages.
- The repo-wide `cargo fmt --all -- --check` currently reports extensive pre-existing formatting differences outside this Voice task. CI uses `rustfmt --check` on the Voice scheduler file instead; that focused check passes.
- GitHub confirmed Issue #117 remains OPEN and assigned to `Rwanbt`; its scope and Acceptance criteria explicitly cover G0–G14. No open PR referencing #117 was returned by the search.
- Issue #117 Acceptance Criteria were normalized from heading `Acceptance` and ordinary bullets to `Acceptance Criteria` checkboxes. The exact text of all seven criteria was preserved; `ac_guard.py --bind` and the post-update claim re-read both pass. Bound AC digest: `689002c87f981091be1eda0890c4fbaf9b6f89dc46ce54c877cf88e941d22657`.
- GitHub run `36241529290` (`voice-ci`) and `36241529304` (`unifia-conformance`) both passed on exact SHA `33b6b4e7df2f7ff877386bc90b71cbd883942b33`.
- For exact SHA `46f6686851e3e4df4dabb3345a50f4e290485bde`, `voice-ci` run `36242039225` and `unifia-conformance` run `36242039213` both completed successfully. The push hook also passed all **47/47** typechecks.
- At local HEAD `af13bb2d12`, `packages/voice-core` passed `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test` (**4 passed**); the mobile Tauri crate passed `cargo check --lib`. This pushed slice only adds typed contracts and links the crate; production producers have not migrated.
- VoiceCore sequencing slice at `14f0aa791ffa16adfdb488da3c4f7bb2bcb24c12`: `cargo fmt --check`, Clippy, and `cargo check --lib --manifest-path ../mobile/src-tauri/Cargo.toml` pass; VoiceCore tests **9 passed**. This establishes core-local behavior only; no device or cross-runtime qualification is claimed.
- Exact source SHA `14f0aa791ffa16adfdb488da3c4f7bb2bcb24c12`: local VoiceCore format check, Clippy (`-D warnings`), **9 tests**, and mobile `cargo check --lib` passed. GitHub `voice-ci` run `36243451608` and `unifia-conformance` run `36243451545` both completed successfully on that exact SHA.

## CI Runs at Baseline

- Run `36222438107` on `261cef4`: failed before creating jobs (the invalid YAML prevented workflow parsing).
- Run `36210384107` on `7580531`: failed before creating jobs.
- Run `36231757400` on `35f05b6f37` and `36231800987` on `3cd2a3bc66`: workflow parsed; the latter's job-level failures and root causes are detailed above.
- Run `36232257315` on `5e77352883`: Python, SpeechRenderer security, registry, contracts, app, and docs are green; the Rust crate-wide build had not completed when the CI job was narrowed to its pure module.
- Run `36232511790` on `386fdcf5ea`: **success**, all five configured blocking jobs.

## Known Qualification Blockers

- No target Windows physical Live/audio qualification is recorded.
- The Xiaomi Android device is available, but interaction/audio permissions and unattended device limits prevent claiming physical qualification.
- Model registry is partial: Parakeet and Pocket entries are absent, and several Piper revisions are marked unverified. There is no verified Android registry.
- The checkout contains untracked build/cache artifacts. Preserve them; do not stage them as campaign output.

## Next Exact Actions

1. Continue G1: establish a truthful selected-LLM/provider readiness check without generating an unauthorized session turn; unify desktop/Android/local error producers; close ADR-070 only after all emitters and adoption tests pass.
2. Continue G1: reconcile typed Rust errors/events with all active Python/TypeScript emitters and implement selected-provider readiness plus model-registry security. ADR-060 now selects Rust VoiceCore; six missing architecture topics still require decision records.
3. Continue G2 by connecting actual Android and desktop producers/adapters to VoiceCore and proving Python/TypeScript/Rust fixture parity; proceed through G3–G14 in dependency order. Update gates only with production-path evidence.
