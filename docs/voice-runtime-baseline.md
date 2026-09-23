# Voice runtime baseline

Status: Wave A characterization, 2026-09-23. The baseline is measured, exploratory, and not production qualification.

## Repository and branch

- Checkout: `D:/App/unifia/voice-runtime`
- Branch: `voice`
- Base commit: `6ff80084c6e733c2fed199e9450a8ad0fd4919de` (`new-ui`, pushed to `origin/new-ui`)
- The implementation branch was created from the pushed `new-ui` commit. No voice implementation was present at that base.
- Later base synchronization: `origin/new-ui` at `a29a80c2adef0c709ecdd90f28b0236cef4b3e45` was merged into `voice` at `59fb2e31174526cbff7cb41c0fe777f7d8806bb1`; the five additional `new-ui` commits through `09d609621ce80bf224296c5981cd93aa9196893e` were merged at `713bd580a8e198664b009940fc94c53a54f9331d`. The first push attempt from the `voice` worktree was blocked by its pre-push typecheck because of cross-worktree dependency aliases. From the correct `new-ui` worktree, the full workspace typecheck passed and the normal push succeeded; `origin/new-ui` now points to `09d609621ce80bf224296c5981cd93aa9196893e`.

## Existing behavior and ownership

| Concern | Current owner | Observed behavior |
|---|---|---|
| Web dictation and browser read aloud | `packages/app/src/hooks/web-speech.ts` | `stt-start` records final recognition text and inserts it into the prompt editor; it does not submit the prompt. `tts-toggle` uses browser speech synthesis. |
| Desktop dictation and TTS | `packages/desktop/src/hooks/use-speech.ts`, `packages/desktop/src-tauri/src/speech.rs` | Parakeet STT and Pocket TTS; playback uses WAV files. |
| Mobile dictation and TTS | `packages/mobile/src/hooks/use-speech.ts`, `packages/mobile/src-tauri/src/speech.rs` | Parakeet STT remains local; TTS reports Voice Host unavailable until host playback is wired. |
| Audio settings | `packages/app/src/components/settings-audio.tsx` | Versioned v2 settings with automatic/Pocket provider choice. Legacy storage migrates through the shared boundary. |
| Shared contracts | None before this change | Wave B introduces provider-neutral speech types in `@unifia/contracts/speech`. |

Existing characterization tests are in `packages/app/src/hooks/web-speech.test.ts`. They cover cleaned spoken text, unsupported/denied browser dictation, final-transcript insertion without submission, and read-aloud pause/resume/cancel behavior.

## Baseline verification

- Existing browser speech characterization and audio settings migration tests: 10 passed, 24 assertions (`web-speech.test.ts` plus `audio-settings.test.ts`).
- Audio settings migration tests: 5 passed, 16 assertions.
- Speech contract, registry, and language-router tests: 6 passed, 17 assertions.
- Contracts TypeScript check: passed (`bun run typecheck` in `packages/contracts`).
- Whole app typecheck: blocked by the cross-worktree dependency mount loading `@unifia/contracts` from both worktrees, causing duplicate nominal `OpaqueCursor` symbols in an unrelated existing `workbench/provider.tsx` reference. The changed settings module passes an isolated strict TypeScript check.
- `git diff --check`: passed.

## Performance baseline

Current Pocket CLI solo samples on Windows (`pocket-tts 1.1.1`, Python 3.13, `torch 2.7.1+cu118`), invoked with `--device cpu`:

| Language | Generated audio | Generation time | Relative speed | Whole CLI invocation |
|---|---:|---:|---:|---:|
| en | 2.88 s | 3.369 s | 0.85× real time | 10.02 s |
| fr | 5.60 s | 4.294 s | 1.30× real time | 10.88 s |
| es | 4.08 s | 3.551 s | 1.15× real time | 9.92 s |
| it | 4.48 s | 3.640 s | 1.23× real time | 10.01 s |
| de | 4.80 s | 3.728 s | 1.29× real time | 10.26 s |

The logs reported average generation steps of 19–20 ms and prompt processing of 41–97 ms. The model files were resolved as tokenizer revision `d4fdd22ae8c8e1cb3634e150ebeff1dab2d16df3` and TTS checkpoint revision `427e3d61b276ed69fdd03de0d185fa8a8d97fc5b` (`b6369a24`). Each language is a single short sample; startup/import time is included only in the whole-invocation column. TTFA, process CPU/RAM, VRAM, repeated-run variance, and LLM tokens/s were not measured. Although the CLI was forced to CPU, its installed PyTorch wheel is CUDA-enabled (`+cu118`); this does not qualify the target CPU-only managed runtime.

#### Local LLM baseline and Pocket coexistence

The local Bonsai 2 27B PTQ1_0 model was loaded with the existing `safe` profile values: `ngl=99`, context 8,192, Q4 KV cache, and projector disabled. I started a temporary local `llama-server.exe` process for this measurement only; no app, user server configuration, or profile was changed. The server returned HTTP 200 for each completion. GPU memory rose from 637 MiB at idle to 6,450–6,563 MiB after model load/inference on the RTX 4070 Laptop GPU. Per-process VRAM attribution was unavailable from NVML on this host.

Three solo 256-token completions measured 26.67–28.88 generated tokens/s. Prompt processing varied widely (13.06–103.55 tokens/s), so the solo observations do not establish a stable prompt-throughput average. A successful simultaneous run produced 256 LLM tokens at 28.90 tokens/s and a French Pocket sample of 5.36 seconds of audio in 3.936 seconds (`1.36×` real time); total invocation times were 11.48 seconds for the LLM request and 11.32 seconds for Pocket. In that run, prompt processing was 14.54 tokens/s. This single pair is too small and variable to claim that Pocket has no LLM impact. GPU total memory was 6,198 MiB after the run; peak per-process VRAM and complete system RAM were not measured.

One later Pocket retry stalled after logging tokenizer loading, with no network connection and no further CPU progress for more than 150 seconds; only the two benchmark processes started for that retry were terminated. Repeated `nvidia-smi` polling also intermittently failed during load, so it was removed from the successful timing run. These observations are retained as instability evidence, not averaged into the successful sample.

TTFA, Parakeet-under-load, Piper, Live conversation, interruption latency, process CPU/RAM, full-system RAM, and repeated variance remain unmeasured. The Voice Host, managed CPU-only Pocket runtime, and physical Android path do not exist yet. The temporary LLM process was stopped after measurement and port 8080 was verified free.

## Gate A status

Repository inventory, existing web behavior tests, architecture ADR draft, Pocket solo language samples, and one real Pocket+GPU-LLM coexistence run are recorded. **Gate A: PASS** for baseline characterization. The limitations above remain follow-up performance gates; this is not a production qualification.

## Wave B status

Shared contracts, safe provider resolution, language routing, VoiceRegistry, and a versioned v2 storage/migration boundary are implemented and tested. **Gate B: PASS** for the contract and migration boundary.

## Wave C status

Kokoro engine modules, Tauri command registrations, download/synthesis commands, mobile Kokoro playback, settings controls, localization entries, shared G2P/tokenizer crate, and its locked dependencies have been removed. The audio settings screen and desktop hook now use the v2 migration/storage boundary. Mobile dictation stays on local Parakeet; TTS displays a Voice Host unavailable message when no host path exists. Repository search finds Kokoro only in migration tests that must protect existing user settings.

Verification: mobile Rust `cargo check --lib` passed; app audio settings migration tests passed (5 tests / 16 assertions); media provider adapter tests passed (6 / 12); `git diff --check` passed. App and desktop typechecks reach only the known cross-worktree duplicate `OpaqueCursor` error under the shared `node_modules` junction. Desktop Rust binding export is blocked because `ort-sys` emits an empty native search path in this host environment; `CARGO_NET_OFFLINE=false` retry did not resolve it. The six stale generated Kokoro wrappers were removed mechanically from `packages/desktop/src/bindings.ts`; the Specta exporter could not be run here.

**Gate C: PASS for active Kokoro removal, with desktop exporter verification limited by the missing ONNX Runtime link path.** No runtime model files outside the repository were deleted. This is not a production qualification; Voice Host/Pocket managed runtime and remote TTS are still pending.
# Wave D qualification — managed Pocket worker (2026-09-23)

**Wave D: PARTIAL. Global status: NO-GO.** This implementation and qualification do not authorize Piper, merge, or production claims. In-memory PCM to the UI remains out of Gate D as stated in the continuation directive.

### Implemented and verified

- `packages/voice-host` pins Python 3.12, Pocket TTS 3.1.0 and CPU-only PyTorch through `uv.lock`. An isolated run (`gate-d-cold-04`) began with an empty Hugging Face model cache, installed managed Python 3.12.14 and 47 locked packages, and completed first-run inference for all five languages. The runtime probe reported `torch 2.14.0+cpu`, CUDA unavailable and no CUDA/NVIDIA packages. The pinned uv archive hash was checked against the runtime bootstrap.
- Worker health separates process liveness, runtime initialization, model loading and voice readiness. Model operations are serialized; IPC lines and synthesis input, pending request IDs and queue depth are bounded. Malformed input is rejected without terminating the worker. PyTorch/Pocket imports occur on the main thread before the operation thread, avoiding the observed import deadlock.
- Two real-model language-switch cycles completed in one worker process: EN → FR → DE → ES → IT → EN, repeated. RSS reached a measured peak of **6,183.7 MiB**, then fell to **1,303.4 MiB** after the final English synthesis. The two cycles show release/decline behavior but are insufficient to establish long-run memory stability or absence of leaks. CPU time observed during synthesis was about 320–454% of one core; this is process-wide CPU time and not a single-thread budget.
- Real-model English cancellation after first PCM acknowledged in **15.8 ms**, produced zero PCM frames after cancellation, emitted no completion event, and the same worker PID successfully synthesized again afterward. This qualifies worker cancellation/reuse, not Tauri process crash recovery.
- GPU sampler recorded 75 system-wide `nvidia-smi` samples: **1,426 MiB before, 1,426 MiB peak and 1,426 MiB after** (delta 0 MiB). This is system-wide only; driver permissions prevent attribution to the worker, so it does not prove per-process zero VRAM use.
- 23 Python unit/contract tests pass in the isolated managed Python environment, including persistent clone-state identity/cache behavior, corruption recovery, path/symlink containment, cancellation, queue saturation, health semantics and malformed/oversized IPC. Python byte-compilation passes. Rust `cargo check --lib` and `rustfmt --check` pass after the final edits.
- The real clone path fails closed when the selected model is the public no-cloning fallback (`pocket-tts-without-voice-cloning`). Persistent state cache logic is unit-tested, but real clone creation/reload/deletion is not qualified without authorized access to clone-capable weights.

### Remaining gates and blockers

| Gate D area | Status | Evidence / blocker |
|---|---|---|
| Cold managed install and first inference | PASS | Isolated managed Python/uv, empty model cache, locked CPU dependencies, first model downloads and inference completed. |
| Five language inference | PASS | Real nonzero 24-kHz output and model/voice readiness for EN, FR, ES, IT, DE. |
| Repeated language switching and RAM | PARTIAL | Two cycles completed; peak 6,183.7 MiB with later decline, but no long-duration leak/stability proof. |
| Cancellation and worker reuse | PASS | 15.8 ms acknowledgement, zero PCM after cancel, same process reused successfully. |
| Supervisor crash recovery | PARTIAL | One retry after observed worker exit is implemented; no live crash/restart qualification through the Tauri host. |
| Health/readiness semantics | PASS | Liveness/runtime readiness separated from model and voice readiness; exercised by harness and unit tests. |
| Persistent clone state and deletion | BLOCKED | Cache identity/persistence/deletion code and tests exist; selected public weights explicitly lack clone support. No real clone weights available. |
| CPU-only and VRAM delta | PARTIAL | CPU PyTorch and absence of CUDA packages proven. GPU total delta was 0 MiB over this run; per-process attribution unavailable. |
| Full packaged desktop install | BLOCKED | Canonical `predev` produced the required ignored CLI sidecar (167,675,392 bytes), and Rust check passes. `tauri build` stops at existing version mismatch: Rust `tauri 2.9.5` vs `@tauri-apps/api 2.10.1`, and Rust dialog plugin `2.4.2` vs JS dialog plugin `2.7.2`. No unrelated dependency upgrade was made. |
| Baseline TS and desktop typecheck | PARTIAL | `new-ui` baseline typecheck passes in its own worktree. Voice typecheck is blocked by the shared `node_modules` junction resolving app/contracts from `_a7-automate-memory`, producing duplicate `OpaqueCursor` and missing aliases. No captured diagnostic remains in the changed speech hook after its local corrections. |
| IPC and security bounds | PASS | Bounded line/request/text/queue handling and negative cases covered in the 23-test suite. |
| Python dependency vulnerability audit | PASS (pinned environment) | Online `uv audit --locked --project packages/voice-host` reported no known vulnerabilities or adverse project statuses in 48 packages. uv noted that the audit command is experimental and normalized an invalid upstream version specifier during audit; no project lockfile change was made. |

Desktop packaging remains blocked and the voice-worktree typecheck remains partial under the shared dependency mount, despite the full workspace typecheck passing before the successful branch push. Dependency audit passed for the pinned Python environment. A process-level VRAM measurement, real clone-capable checkpoint qualification, Tauri supervisor crash injection, and a package build with compatible Tauri Rust/JS versions are still needed before Gate D can pass. Do not begin Wave E until these gates are resolved.
