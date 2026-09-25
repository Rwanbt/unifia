<!-- SPDX-License-Identifier: MIT -->
# ADR-068: Voice Runtime ABI / ONNX Ownership — one ABI owner per process (2026-09-26)

> Companion to the ADR chain
> [ADR-058](../adr/ADR-058-voice-runtime.md) through
> [ADR-067](../adr/ADR-067-voice-privacy-logging-metrics.md),
> and the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).

## Context

The v2 plan §16 requires an ADR titled "Runtime ABI / ONNX
Ownership" freezing the rule: one ABI owner per process unless
compatibility is explicitly demonstrated.

Voice today loads:

- **Desktop Python (`voice_host`)**:
  - ONNX Runtime 1.30.0 (`onnxruntime==1.30.0` in
    `packages/voice-host/pyproject.toml`).
  - PyTorch 2.14.0 CPU-only (CPU index pin in
    `pyproject.toml [tool.uv.sources]`).
  - Pocket TTS 3.1.0 (MIT) — pulls its own ONNX runtime stack
    internally for the model inference.
  - LiveKit Agents 1.8.3 — bundles its own Silero VAD ONNX,
    Parakeet STT model, and turn-detector-v1-mini.
  - Piper (subprocess isolation, see ADR-062).

- **Android Rust (`packages/mobile/src-tauri/`)**:
  - `ort = "2.0.0-rc.10"` Rust binding for ONNX Runtime.
  - Shared `.so` ONNX Runtime library packaged inside the APK.
  - The Kyutai Pocket TTS candidate (per ADR-059) would bring a
    second ONNX Runtime copy via `PocketTTS.cpp` if we adopt it.

Two problems this addresses:

1. **Symbol ownership** — two ONNX Runtime copies in one process
   can collide, fail to initialise, or silently pick the wrong
   model format. Each ABI has its own initialisation order, its
   own thread pool, and its own memory allocator.
2. **APK size and cold-start cost** — duplicating ONNX Runtime in
   the APK bloats the binary and slows cold launch.

## Decision

1. **One ABI owner per process.** A process exposes exactly one
   ONNX Runtime instance, one Pocket runtime instance, one
   Silero VAD instance, one turn-detector instance, one Parakeet
   STT instance. New runtimes are admitted only after the
   compatibility test below passes.

2. **Compatibility test** for admitting a second ABI in the same
   process:

   - The second ABI loads a known fixture (the test asset for
     that model class) without colliding with the first ABI's
     symbols.
   - The first ABI continues to function with no regression on
     the existing tests (the voice-host pytest suite plus the
     Android Rust binding test).
   - Memory and thread-pool contention is measured and recorded.
   - Cold-start cost delta is measured and recorded.

   If the test passes, the second ABI is admitted with a
   `compatibility: { runtime_a: "name@version", runtime_b:
   "name@version", shared_init: "..." }` entry in the model
   registry (per ADR-066). If the test fails, the second ABI is
   **not** admitted; the project either accepts the runtime
   duplication cost or refactors to share.

3. **Default architecture**:

   - Desktop Python: ORT 1.30.0 is the canonical owner for
     Parakeet STT. Pocket TTS 3.1.0 uses its own internal
     stack — that is intentional because Pocket's protocol
     requires its own execution semantics. LiveKit Agents uses
     its bundled Silero + turn-detector. PyTorch CPU is its own
     ABI owner for the LiveKit Agents Parakeet adapter
     plumbing.
   - Android Rust: `ort = 2.0.0-rc.10` is the canonical owner
     for Parakeet STT. The candidate Pocket runtime
     (PocketTTS.cpp per ADR-059) uses the same ORT where
     compatibility is demonstrated (recorded in ADR-066); if
     not, PocketTTS.cpp loads its own ORT as a separate
     `.so`/package.
   - Piper remains an isolated subprocess provider (per ADR-062
     and ADR-066); it has no in-process ABI.

4. **Startup ABI diagnostic**. The Voice engine records at
   startup and emits a structured `voice_startup` log entry:

   ```
   ort_version: <string>
   ort_path: <path or library name>
   pocket_runtime_version: <string>
   pocket_ort_version: <string or "n/a">
   silero_vad_version: <string>
   silero_vad_sha256: <hex>
   parakeet_stt_version: <string>
   parakeet_stt_sha256: <hex>
   turn_detector: <name@version> | "deterministic"
   fast_decision: <name@version> | "rules" | "off"
   model_artifact_registry_status: "ok" | "missing:<name>" | "sha_mismatch:<name>"
   ```

   The diagnostic is the first thing the user sees when
   reporting a "Voice doesn't work" issue. A missing field is a
   startup error with `stage: "abi"` (per ADR-068).

5. **Documented ORT versions**:

   - Desktop: 1.30.0, dynamic linking from `pip`. Symbol
     ownership: `onnxruntime.capi.*`. Update path: bump
     `pyproject.toml` and `uv.lock` together; never pin
     separately.
   - Android: 2.0.0-rc.10, packaged as a single `.so`
     (CPU) inside the APK. Symbol ownership:
     `onnxruntime::OrtApiBase`. Update path: bump
     `packages/mobile/src-tauri/Cargo.toml` and rebuild the APK;
     never ship a `.so` whose version differs from the binding.

6. **Pocket runtime ABI**:

   - `PocketTTS.cpp` (Kyutai official C++ / ORT) is the
     Android candidate. If admitted, it must use the same ORT
     as the Rust binding (2.0.0-rc.10) and demonstrate
     compatibility. The model artifact registry records the
     `compatibility` block.
   - The Kyutai Python `pocket-tts` library is the desktop
     reference. It uses PyTorch 2.14.0 CPU; the Pocket model
     itself is the same, only the runtime differs.

7. **Audio thread ABI**: the audio callback thread does not link
   against the model runtimes. It links against the OS audio
   adapter only (LiveKit `AudioFrame` on desktop, Oboe/AAudio
   on Android per the v2 plan §24 / R3). The probability stream
   is shipped through a lock-free ring buffer, not through a
   shared ONNX Runtime instance. This is the same rule that the
   `audio-validate` skill enforces for CLAP plugins.

## Consequences

- Two runtimes in the same process are an explicit exception,
  recorded in the model artifact registry and supported by a
  compatibility test. The default is one runtime per process.
- A `voice_startup` diagnostic is mandatory; a missing field
  refuses to start.
- The desktop Python venv and the Android APK each pin one ORT
  version. Drift is a tracked build break.
- The Android `.so` packaging strategy is `single .so` per ABI;
  no per-model `.so` packing. Model files live in the artifact
  cache, not in `lib/`.
- The Piper subprocess isolation boundary (ADR-062, ADR-066) is
  reinforced: Piper has no in-process ABI in either platform.

## Open evidence requirements

- Compatibility test green for any new second ABI before
  admission (the `PocketTTS.cpp` qualification per ADR-059 is
  the first such test).
- Startup ABI diagnostic present at Voice startup and printed
  in the gate evidence package.
- A test asserting that no second ORT copy is loaded by the
  voice-host Python process (the existing 70 tests should
  pass without modification).
- A test asserting the Android APK ships exactly one ORT
  `.so` (the next session's APK rebuild with verified SHA-256
  is the proof point).

## Status

**DRAFT** — not adopted. The ABI rule is specified. Adoption
requires the startup diagnostic and the compatibility test to be
recorded and green.

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md) §15
- [ADR-059-voice-portable-pocket-runtime.md](ADR-059-voice-portable-pocket-runtime.md)
- [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md)
- [ADR-061-voice-vad-strategy.md](ADR-061-voice-vad-strategy.md)
- [ADR-062-voice-tts-routing.md](ADR-062-voice-tts-routing.md)
- [ADR-063-voice-fast-decision.md](ADR-063-voice-fast-decision.md)
- [ADR-064-voice-desktop-convergence.md](ADR-064-voice-desktop-convergence.md)
- [ADR-065-voice-agent-authority-boundary.md](ADR-065-voice-agent-authority-boundary.md)
- [ADR-066-voice-model-artifact-registry.md](ADR-066-voice-model-artifact-registry.md)
- [ADR-067-voice-privacy-logging-metrics.md](ADR-067-voice-privacy-logging-metrics.md)
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)
- v2 plan §16 (ADR campaign list)
- `packages/voice-host/pyproject.toml` — ORT 1.30.0, Pocket
  3.1.0, PyTorch 2.14.0 CPU
- `packages/mobile/src-tauri/Cargo.toml` — `ort = 2.0.0-rc.10`
- `audio-validate` skill — RT-thread ABI separation