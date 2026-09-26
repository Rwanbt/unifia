<!-- SPDX-License-Identifier: MIT -->
# Voice v2.2 Autonomous Execution State

**Issue:** [#117](https://github.com/Rwanbt/unifia/issues/117) (open, assigned to `Rwanbt`)

**Branch:** `voice`

**Baseline HEAD:** `261cef41351ae7804a07e811e775e056be51f9d5`

**Latest pushed SHA with both required remote workflows confirmed green:** `61ab9b8934aaf295cdf17a5bb97f7fbbed35d03a` (`voice-ci` 36249076833; `unifia-conformance` 36249076835; both successful).

**Latest pushed implementation SHA:** `61ab9b8934aaf295cdf17a5bb97f7fbbed35d03a` on `voice` and `origin/voice`; both required remote workflows passed. The push hook passed all **47/47** Turbo typechecks.

**Latest code-bearing commit:** `61ab9b8934aaf295cdf17a5bb97f7fbbed35d03a`. Exact-SHA runs `36249076833` and `36249076835` passed, including the new blocking VoiceCore Rust format/Clippy/test job. The snapshot store and bounded-history slice are verified and pushed; there is still no production runtime owner, and production event producers do not use VoiceCore as ordering/state authority. Preserve pre-existing and test-generated build/cache artifacts unstaged.

**G0 commits pushed:** `e00bf2a388`, `e81cb76c9c`, `35f05b6f37`, `3cd2a3bc66`, `5e77352883`, `386fdcf5ea`.

**Updated:** 2026-09-26

## Verdict

**IN PROGRESS — NOT GO PROD.** Live startup checks an explicit model against the configured connected-provider catalog before `voice_ready`, without creating a session or generating a turn; this does not prove inference or provider reachability. Parakeet has immutable archive and per-file SHA-256 pins and a shared atomic installer. The current G2 slice adds crash-conscious snapshot persistence, bounded turn replay history and blocking VoiceCore CI coverage, but the store has no production runtime owner and production event emitters still bypass VoiceCore. No production qualification is inferred from unit tests or scaffolds.

## Gate State

| Gate | State | Evidence / remaining work |
|---|---|---|
| G0 — Truth and CI | Green | `voice-ci` `36249076833` and `unifia-conformance` `36249076835` both passed on exact SHA `61ab9b8934aaf295cdf17a5bb97f7fbbed35d03a`. The new blocking VoiceCore job passed formatting, strict Clippy, and Rust tests. |
| G1 — Contracts and ADR reconciliation | Partial | Python publishes session-scoped `voice_ready` on reliable data and participant attributes; TypeScript requires it before opening the microphone. Python error/readiness emitters now use safe monotonic timestamps and TypeScript rejects unsafe timestamps. Error envelopes include required `cause_category`, optional validated provider identity, and stable codes for all 21 stages. Explicit Live model selections are checked against the connected provider catalog before readiness. Remaining: non-generative preflight cannot prove inference/network health; event generation and ordering parity across other Android/local/desktop emitters, and completed ADR adoption evidence remain open. |
| G2 — Shared VoiceCore | In progress | Portable `packages/voice-core` defines typed contracts, ordering, generation fencing, turn tokens, playback-only cancellation, reconnect and recovery. The current local slice adds `VoiceCoreSnapshotStore`: two alternating slots, schema validation, 1 MiB bounded reads, SHA-256 consistency checks for accidental corruption (not authenticity), flush-before-promotion, stale-snapshot rejection and preservation of the previous complete slot on interrupted writes. Issued turn history caps at 4,096 and fails closed rather than evicting IDs; callers must still surface capacity and rotate the session safely. Local tests cover corruption, interrupted promotion, oversized input, stale writes, deduplication and capacity. No production runtime owns or calls the store; production event producers still bypass VoiceCore. Lifecycle state machine, durable idempotency, runtime integration, generation parity and cross-runtime fixture parity remain open.
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
| G14 — Production hardening | Partial | Parakeet archive and four extracted-file hashes are pinned; shared safe extraction, cache validation, atomic promotion/rollback and recovery have 7 passing unit tests. Both Tauri crates compile locally. Remaining: green exact-SHA remote workflows, Windows/Android packaging/runtime and physical qualification, broader registry adoption, and production security/evidence gates. |

## Checks Run

- Latest pushed SHA `b7733b32455e59529c1525f5fb5e6c8170ef5056`: `voice-ci` run `36248320071` and `unifia-conformance` run `36248320089` both completed successfully; push hook passed **47/47** typechecks.
- Exact pushed G2 slice SHA `61ab9b8934aaf295cdf17a5bb97f7fbbed35d03a`: `voice-ci` `36249076833` and `unifia-conformance` `36249076835` passed. The new `voice-rust-core` job passed format, strict Clippy and tests; local VoiceCore tests **21 passed**; mobile Tauri `cargo check --lib --locked` and push-hook **47/47** typechecks passed.

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
- Exact pushed source SHA `01bf5da293394970bfe1e99b476a249ed783c17f`: Voice artifact crate `cargo fmt --check`, Clippy `--locked -D warnings`, and **7 tests** passed; mobile and desktop `cargo check --lib` passed; registry validator and **5** Node self-tests passed; workflow YAML parsed; `git diff --check` passed. GitHub branch API confirmed `voice` points to this exact SHA; `voice-ci` `36244758338` completed successfully; `unifia-conformance` `36244758313` was still in progress at the last read.
- G1 selected-model preflight at exact pushed SHA `e31ca24b26d5bda257bbe641a0d8df359d116024`: `BridgeTests` **6 passed**; Ruff, `py_compile`, and `git diff --check` passed. The full `test_live_runtime.py` invocation produced **18 passed, 2 environment failures**: the sandbox denied writes under `%TEMP%` in existing Piper test setup. The push hook passed **47/47** Turbo typechecks. GitHub run lookup returned no results; remote workflow status is unverified. No model inference/network health is claimed by the provider-catalog check.
- Local VoiceCore sequence-atomicity fix at `6e2a3b9afb`: `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`, and `cargo test --locked` passed; **10 tests** passed. Regression test proves invalid `VadProbability(NaN)` neither consumes `seq=0` nor advances the monotonic timestamp. Remote CI has not yet run for this SHA.
- Voice event safe-integer alignment at `a706dcc0d4`: VoiceCore format, strict Clippy and **12 Rust tests** passed; mobile Tauri `cargo check --lib --locked` passed; contracts `bun run typecheck` and focused speech tests (**12 passed**) passed; Biome and `git diff --check` passed. Rust now rejects timestamps/sequences above `2^53-1`; TypeScript readiness/error envelope validators reject unsafe timestamps. Remote CI is pending.
- Python event clock alignment at `533355c886bac24846bdb6feb99ede3e75e73de7`: Voice Host `test_voice_error.py` **14 passed, 25 subtests passed** in its project `.venv`; Ruff and `py_compile` passed. Both `voice_error` and `voice_ready` now use `time.monotonic_ns()` milliseconds and reject values beyond the JavaScript safe-integer limit. System Python could not collect this suite because `livekit` is absent; the project environment supplied the successful run.
- Cross-runtime check after the Python clock change: an actual Python-generated `STT_PROVIDER_UNAVAILABLE` event (`seq=7`) was accepted by `packages/contracts/src/speech.ts`; its monotonic timestamp was a JavaScript safe integer.
- At local SHA `65ff1b6cbcec3650bb26d751e01f5d41e0de0205`, Voice Host error/readiness events now begin at `seq=0` to match Rust VoiceCore and enforce JavaScript-safe integer sequences (including rejecting Python `bool`). `tests/test_voice_error.py`: **15 passed, 29 subtests passed**; full Voice Host suite: **176 passed, 1 skipped, 29 subtests passed**. Ruff, `py_compile`, and `git diff --check` passed. The repository runner could not initialize its managed environment because `uv` could not access its user cache; the existing package `.venv` full suite passed when its temporary-file tests ran with the required filesystem permission. The skip remains the existing live transport integration requiring livekit-server, espeak-ng, and Bun.
- At local SHA `3e0fed9179a979d6ad316beb346f5be4fc9a295d`, VoiceCore snapshots serialize issued turn IDs, reject a repeated ID after reconnect and process recovery, and reject duplicate/invalid turn history, zero generation, and unsafe persisted timestamp. `cargo fmt --check`, `cargo test --locked` (**14 passed**), strict Clippy, `cargo check --lib --manifest-path packages/mobile/src-tauri/Cargo.toml --locked`, and `git diff --check` passed. `graphify path` could not run because this checkout has no `graphify-out/graph.json`; direct search found two `begin_turn` callers, both core unit tests, and no production consumer. Snapshot storage ownership and turn-history retention remain open.
- The pinned 463,415,355-byte Parakeet release ZIP was downloaded to ignored `.build-temp/voice-artifact-audit/`; `Get-FileHash -Algorithm SHA256` returned `c5d0197e0b98552d8b88c569dbd9715199b68f6d0de17045b96e8541d4f75c03`. Hashes for the four required ONNX/vocabulary files were computed from the ZIP stream and added to the registry.

## CI Runs at Baseline

- Run `36222438107` on `261cef4`: failed before creating jobs (the invalid YAML prevented workflow parsing).
- Run `36210384107` on `7580531`: failed before creating jobs.
- Run `36231757400` on `35f05b6f37` and `36231800987` on `3cd2a3bc66`: workflow parsed; the latter's job-level failures and root causes are detailed above.
- Run `36232257315` on `5e77352883`: Python, SpeechRenderer security, registry, contracts, app, and docs are green; the Rust crate-wide build had not completed when the CI job was narrowed to its pure module.
- Run `36232511790` on `386fdcf5ea`: **success**, all five configured blocking jobs.

## Known Qualification Blockers

- No target Windows physical Live/audio qualification is recorded.
- The Xiaomi Android device is available, but interaction/audio permissions and unattended device limits prevent claiming physical qualification.
- Pocket TTS entries are still absent and several Piper revisions remain unverified. Android/Windows model packaging and runtime loading have not been qualified on target systems.
- The checkout contains untracked build/cache artifacts. Preserve them; do not stage them as campaign output.

## Next Exact Actions

1. Continue G2 by wiring a durable snapshot owner into the actual Live runtime and making VoiceCore the state/order authority for production Android, TypeScript and Python paths; inspect binding/session flows before choosing adapter boundaries.
2. Surface safe session rotation at turn-history capacity, persist idempotency history, and add generation/cross-runtime fixture parity; preserve `cancel speech != cancel agent work`.
3. Continue G3 native audio (Android adapter still uses WebView `getUserMedia`/`ScriptProcessorNode`) and proceed through G14 in dependency order. Do not claim GO PROD from host tests.
4. The Xiaomi device was previously visible to `adb devices`; recheck it and inspect app/device instructions before qualification. Qualify installer/model loading on Windows and Android hardware with exact source/package hashes.
