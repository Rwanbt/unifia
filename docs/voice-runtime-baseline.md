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

- Existing browser speech characterization and audio settings migration tests: 8 passed, 18 assertions (`web-speech.test.ts` plus `audio-settings.test.ts`).
- Audio settings migration tests: 4 passed, 12 assertions.
- Speech contract, registry, and language-router tests: 6 passed, 17 assertions.
- Contracts TypeScript check: passed (`bun run typecheck` in `packages/contracts`).
- Whole app typecheck: blocked by the cross-worktree dependency mount loading `@unifia/contracts` from both worktrees, causing duplicate nominal `OpaqueCursor` symbols in an unrelated existing `workbench/provider.tsx` reference. The changed settings module passes an isolated strict TypeScript check.
- `git diff --check`: passed.

## Performance baseline

No reproducible voice-runtime latency or CPU/RAM/VRAM baseline is available yet. The required comparison is Pocket/Piper/STT and Live conversation while the selected local LLM is generating, with TTFA, interruption latency, CPU, RAM, VRAM, and LLM tokens/s recorded. The Voice Host and managed Pocket runtime do not exist at this baseline, and no physical Android run is represented here. These measurements remain explicit gates; unit-test duration is not substituted for runtime performance.
At inspection time, no Unifia/OpenCode app, local LLM server, or speech server process was running. An existing live service could not be sampled without violating the repository's no-restart instruction.

## Gate A status

Characterization inventory and existing behavior contract are recorded. Gate A remains **pending** until the live baseline above is measured. No Kokoro runtime or command has been removed in this wave.

## Wave B status

Shared contracts, safe provider resolution, language routing, and a pure v2 settings migration boundary are implemented and tested. The existing settings screen still consumes its legacy shape; finish its migration and close Gate B before starting destructive Kokoro removal.
