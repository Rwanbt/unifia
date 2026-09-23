# Voice runtime baseline

Status: Wave A characterization, 2026-09-23. The baseline is measured, exploratory, and not production qualification.

## Repository and branch

- Checkout: `D:/App/unifia/voice-runtime`
- Branch: `voice`
- Base commit: `6ff80084c6e733c2fed199e9450a8ad0fd4919de` (`new-ui`, pushed to `origin/new-ui`)
- The implementation branch was created from the pushed `new-ui` commit. No voice implementation was present at that base.

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
# Wave D progress — managed Pocket worker (2026-09-23)

- Added `packages/voice-host` with Python 3.12 lock constraints, `uv.lock`, Pocket TTS 3.1.0, and PyTorch explicitly sourced from the CPU-only wheel index.
- Added a JSON-lines worker contract for health, language preparation, streaming float PCM, cancellation, and disposal. Model operations are serialized and only one language model is retained at a time.
- Verified the pinned package API from the installed Pocket 3.1.0 package. `generate_audio_stream` takes `(model_state, text)`; the implementation uses that order. Local PyTorch reports `2.14.0+cpu` and `torch.cuda.is_available() == False`.
- `uv lock` resolved 49 packages; after explicitly pinning CPU PyTorch it removed CUDA/NVIDIA packages from the lock. `uv sync --locked` passed and the worker tests pass (4 tests), including cancellation before dequeue and cancellation during generation. A real JSONL health/synthesis smoke returned 26 PCM frames at 24 kHz; an English CPU inference generated 63,360 samples in about 1.99 seconds from cached assets.
- Fixed the worker launch to use uv's `--directory` option and proved `uv run --locked --directory packages/voice-host ...` from the repository root returns `ready: true`. Desktop TTS now resolves language from the explicit audio language preference, then the application locale, and carries it through the Tauri command into the worker; the worker retains one loaded language model. Tauri cancellation is wired over a concurrent JSONL input path; it is unit-tested in the worker, but the real-model cancellation smoke did not reach synthesis before its 45-second warmup deadline, so interruption latency and continued worker reuse remain unverified.
- Tauri resources now include only the runtime manifest, lockfile, and worker module; Rust responsibilities are split into protocol, bootstrap, and WAV modules, each under 500 lines.
- Desktop `cargo check --lib` passes with the known Tauri config override for the absent CLI sidecar. The desktop package typecheck remains blocked by cross-worktree `node_modules` resolving `@unifia/app` from `_a7-automate-memory`, producing duplicate nominal `OpaqueCursor` types and missing aliased modules there; no errors remain in the changed speech hook.
- This is still an implementation tranche, not Gate D. First-run model/runtime downloads, multilingual inference on all five models, process restart/recovery, measured cancellation latency, live PCM to playback without WAV buffering, voice-state persistence, and packaged desktop installation remain open. No Gate D PASS is claimed.
