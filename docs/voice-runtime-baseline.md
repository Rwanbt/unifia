# Voice runtime baseline

Status: Wave A characterization, 2026-09-23. This is a repository baseline, not production qualification.

## Repository and branch

- Checkout: `D:/App/unifia/voice-runtime`
- Branch: `voice`
- Base commit: `6ff80084c6e733c2fed199e9450a8ad0fd4919de` (`new-ui`, pushed to `origin/new-ui`)
- The implementation branch was created from the pushed `new-ui` commit. No voice implementation was present at that base.

## Existing behavior and ownership

| Concern | Current owner | Observed behavior |
|---|---|---|
| Web dictation and browser read aloud | `packages/app/src/hooks/web-speech.ts` | `stt-start` records final recognition text and inserts it into the prompt editor; it does not submit the prompt. `tts-toggle` uses browser speech synthesis. |
| Desktop dictation and TTS | `packages/desktop/src/hooks/use-speech.ts`, `packages/desktop/src-tauri/src/speech.rs` | Parakeet STT and direct Pocket/Kokoro commands; local WAV playback is used by existing paths. |
| Mobile dictation and TTS | `packages/mobile/src/hooks/use-speech.ts`, `packages/mobile/src-tauri/src/speech.rs` | Parakeet STT and direct Kokoro ONNX synthesis/playback. |
| Audio settings | `packages/app/src/components/settings-audio.tsx` | Unversioned local storage; includes `sttEngine`, `ttsVoice`, and `pocket|kokoro` provider values. Mobile forces Kokoro. |
| Shared contracts | None before this change | Wave B introduces provider-neutral speech types in `@unifia/contracts/speech`. |

Existing characterization tests are in `packages/app/src/hooks/web-speech.test.ts`. They cover cleaned spoken text, unsupported/denied browser dictation, final-transcript insertion without submission, and read-aloud pause/resume/cancel behavior.

## Baseline verification

- Existing browser speech characterization and audio settings migration tests: 9 passed, 20 assertions (`web-speech.test.ts` plus `audio-settings.test.ts`).
- Audio settings migration tests: 4 passed, 12 assertions.
- Speech contract, registry, and language-router tests: 6 passed, 17 assertions.
- Contracts TypeScript check: passed (`bun run typecheck` in `packages/contracts`).
- Whole app typecheck: blocked by the cross-worktree dependency mount loading `@unifia/contracts` from both worktrees, causing duplicate nominal `OpaqueCursor` symbols in an unrelated existing `workbench/provider.tsx` reference. The changed settings module passes an isolated strict TypeScript check.
- `git diff --check`: passed.

## Performance baseline

Current Pocket CLI solo sample on Windows (`pocket-tts 1.1.1`, Python 3.13, `torch 2.7.1+cu118`), invoked with `--device cpu`:

| Language | Generated audio | Generation time | Relative speed | Whole CLI invocation |
|---|---:|---:|---:|---:|
| en | 2.88 s | 3.369 s | 0.85× real time | 10.02 s |
| fr | 5.60 s | 4.294 s | 1.30× real time | 10.88 s |
| es | 4.08 s | 3.551 s | 1.15× real time | 9.92 s |
| it | 4.48 s | 3.640 s | 1.23× real time | 10.01 s |
| de | 4.80 s | 3.728 s | 1.29× real time | 10.26 s |

The logs reported average generation steps of 19–20 ms and prompt processing of 41–97 ms. The model files were resolved as tokenizer revision `d4fdd22ae8c8e1cb3634e150ebeff1dab2d16df3` and TTS checkpoint revision `427e3d61b276ed69fdd03de0d185fa8a8d97fc5b` (`b6369a24`). Each language is a single short sample; startup/import time is included only in the whole-invocation column. TTFA, process CPU/RAM, VRAM, repeated-run variance, and LLM tokens/s were not measured. Although the CLI was forced to CPU, its installed PyTorch wheel is CUDA-enabled (`+cu118`); this does not qualify the target CPU-only managed runtime.

At inspection time, no Unifia/OpenCode app, local LLM server, or speech server process was running. Therefore the required concurrency comparison—Pocket/Piper/STT and Live conversation while the selected local LLM is generating—remains open. The Voice Host, managed Pocket runtime, and physical Android run are also absent. No unit-test or solo CLI result is substituted for those measurements.

## Gate A status

Characterization inventory, existing behavior contract, and a solo Pocket language baseline are recorded. Gate A remains **pending** until LLM coexistence, memory/CPU, and live-path baseline measurements can be taken. No Kokoro runtime or command has been removed in this wave.

## Wave B status

Shared contracts, safe provider resolution, language routing, and a pure v2 settings migration boundary are implemented and tested. The existing settings screen still consumes its legacy shape; finish its migration and close Gate B before starting destructive Kokoro removal.
