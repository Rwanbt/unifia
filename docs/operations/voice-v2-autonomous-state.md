<!-- SPDX-License-Identifier: MIT -->
# Voice v2.2 Autonomous Execution State

**Issue:** [#117](https://github.com/Rwanbt/unifia/issues/117) (open, assigned to `Rwanbt`)

**Branch:** `voice`

**Baseline HEAD:** `261cef41351ae7804a07e811e775e056be51f9d5`

**Last code SHA with verified remote CI:** `f039a92d98caf77345cc647b5dfa369f1dbebfd9`

**G0 commits pushed:** `e00bf2a388`, `e81cb76c9c`, `35f05b6f37`, `3cd2a3bc66`, `5e77352883`, `386fdcf5ea`.

**Updated:** 2026-09-26

## Verdict

**IN PROGRESS — NOT GO PROD.** G0 CI repair is green. G1 has a first structured TypeScript error-contract slice, but ADR adoption is incomplete and the Python runtime does not yet emit the canonical event. No production qualification is inferred from unit tests or scaffolds.

## Gate State

| Gate | State | Evidence / remaining work |
|---|---|---|
| G0 — Truth and CI | Green | GitHub Actions run `36232511790` completed successfully on exact SHA `386fdcf5eafb216288e3d7ea0d3070a8f6e5f3ee`; all 5 mandatory jobs passed. The subsequent Voice CI run `36233221531` and conformance run `36233221569` also passed on `e5e8f9af82`. Voice Host: 156 passed, 1 explicitly skipped integration test requiring livekit-server, espeak-ng, and Bun. Local Rust module test: 15 passed; hosted direct `rustc --test` step passed. |
| G1 — Contracts and ADR reconciliation | Partial | The TypeScript controller validates ordered envelopes and discards free-form remote detail; LiveKit accepts only reliable `unifia.voice_error` packets from the agent. Python publishes safe, sequenced session errors on that data topic, with a legacy-attribute fallback if sending fails. Remaining: structured pre-session errors (no `sessionID` may exist yet), all other stages/providers, cross-platform emitters, readiness gating, and ADR-070 adoption evidence. |
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

1. Finish G1 by emitting the staged contract for pre-session/provider failures and remaining desktop/Android error stages, then reconcile ADR-070's readiness rule with actual runtime provider health.
2. Continue G2–G14 in order; update this gate table only with production-path evidence, not scaffold or mock coverage.
3. Record each test, benchmark, device, exact source SHA, and package/model SHA here; never mark a physical gate green from mocks or host-only tests.
