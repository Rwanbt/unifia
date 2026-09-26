<!-- SPDX-License-Identifier: MIT -->
# Voice v2.2 Autonomous Execution State

**Issue:** [#117](https://github.com/Rwanbt/unifia/issues/117) (open, assigned to `Rwanbt`)

**Branch:** `voice`

**Baseline HEAD:** `261cef41351ae7804a07e811e775e056be51f9d5`

**Last code SHA with verified remote CI:** `dbf5d111db915adb550bc3d5e9d0b547fe62ccec`

**Current worktree:** G1 readiness implementation is being developed on top of `dbf5d111db`; these changes are not yet committed or covered by remote CI.

**G0 commits pushed:** `e00bf2a388`, `e81cb76c9c`, `35f05b6f37`, `3cd2a3bc66`, `5e77352883`, `386fdcf5ea`.

**Updated:** 2026-09-26

## Verdict

**IN PROGRESS — NOT GO PROD.** G0 CI is green on `dbf5d111db`. The current G1 work adds a canonical `voice_ready` event and keeps Live microphone input disabled until it is received; startup prewarms the native Silero VAD and local EOT model, verifies the recognizer, Unifia bridge, TTS backend, session binding, and LiveKit session start. These new changes are locally tested but not yet committed or remotely qualified. G1 remains partial: selected LLM/provider health is not verified and error emitters are not unified across Android/desktop. No production qualification is inferred from unit tests or scaffolds.

## Gate State

| Gate | State | Evidence / remaining work |
|---|---|---|
| G0 — Truth and CI | Green | GitHub Actions runs `36239716868` (`voice-ci`) and `36239716904` (`unifia-conformance`) both completed successfully on exact SHA `dbf5d111db915adb550bc3d5e9d0b547fe62ccec`. Voice CI has 6 successful blocking jobs; the Voice Host job reports 163 passed and 1 explicitly skipped live transport integration requiring livekit-server, espeak-ng, and Bun. |
| G1 — Contracts and ADR reconciliation | Partial | Python now publishes a session-scoped `voice_ready` envelope on reliable `unifia.voice_ready` data and persists the same payload in participant attributes for late joiners. The TypeScript controller validates the event, remains connecting on a bare `lk.agent.state=listening`, and keeps the mic closed until readiness. Startup prewarms local Silero VAD and EOT, then checks recognizer presence, Unifia bridge reachability/session binding, TTS warmup, and successful LiveKit session start. Remaining: selected LLM/provider health beyond the session endpoint probe, structured pre-binding errors, the other provider/stage emitters and Android/local transport adoption, complete error-code appendix/tests, and full ADR-070 adoption evidence. |
| G2 — Shared VoiceCore | Not started | No canonical cross-platform state machine/event core has been verified. |
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
- GitHub run `36238924843` (`voice-ci`) and `36238924934` (`unifia-conformance`) both passed on `f039a92d98`.
- The full app (**1,799 tests**) and contracts (**704 tests**) runs preceded the final event-schema alignment change that removed a non-ADR `causeCategory` field; after that correction, the focused controller/contracts suite passed **31 tests**, both typechecks and Biome passed, and the Python suite remained **159 passed, 1 skipped**. The new source diff still requires remote CI.
- Current pre-commit Rust checks: `cargo clippy --all-targets -- -D warnings` passed after fixing two scheduler lint findings and documenting the Android-only bearer re-export; targeted Rust scheduler tests remained **15/15 green**.
- Current Python targeted rerun: `python -m pytest -p no:cacheprovider tests/test_resource_scheduler.py tests/test_platform_signals.py -q` from `packages/voice-host`: **26 passed**.
- Local reproduction of the formerly failing isolated renderer step with the workflow's `PYTHONPATH`: **53 passed**. The workflow parser now confirms this environment and the Windows Rust runner selection.
- GitHub Actions run `36231800987` on `3cd2a3bc66`: app (**118 tests**), contracts (**701 tests**), docs, registry CLI, registry integrity helper tests, and full Python Host suite passed. The explicit SpeechRenderer step failed collection because `PYTHONPATH` was absent. Rust scheduler step failed because Ubuntu lacked `glib-2.0` / `gobject-2.0` development packages.
- The repo-wide `cargo fmt --all -- --check` currently reports extensive pre-existing formatting differences outside this Voice task. CI uses `rustfmt --check` on the Voice scheduler file instead; that focused check passes.

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

1. Commit and push the current G1 readiness slice after final diff/format review; then verify exact-SHA Voice CI and conformance.
2. Finish G1 by measuring a supported selected LLM/provider readiness check and mapping remaining desktop/Android error producers into the same safe staged contract; close ADR-070 only after its full appendix and tests are complete.
3. Continue G2–G14 in order; update this gate table only with production-path evidence, not scaffold or mock coverage.
4. Record each test, benchmark, device, exact source SHA, and package/model SHA here; never mark a physical gate green from mocks or host-only tests.
