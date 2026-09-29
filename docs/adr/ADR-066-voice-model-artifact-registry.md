<!-- SPDX-License-Identifier: MIT -->
# ADR-066: Voice Model Artifact Registry — every artifact pinned, SHA-verified, never partially executed (2026-09-26)

> Companion to the ADR chain
> [ADR-058](../adr/ADR-058-voice-runtime.md) through
> [ADR-065](../adr/ADR-065-voice-agent-authority-boundary.md),
> and the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).

## Context

The v2 plan §15 ADRs (Model Artifact Registry) require every
downloadable Voice model and runtime artifact to ship with:

- provider, model ID, version, upstream revision
- SHA-256 (recorded **before** any production use)
- size, licence, languages, architecture, quantization
- redistributable status, source URL, minimum runtime
- compatibility metadata

Voice today loads:

- Silero VAD v6.2.2 ONNX (`packages/voice-host/voice_host/live/`,
  bundled via LiveKit Agents; also downloaded as
  `.build-temp/silero-vad-v6.2.2.onnx`)
- Parakeet TDT 0.6B v3 INT8 ONNX (desktop and Android Rust
  bindings, ONNX Runtime 1.30.0)
- Pocket TTS (pocket-tts==3.1.0, MIT) + Kyutai multilingual
  weights (downloaded on first use)
- Piper voices (5 ONNX files for EN/FR/ES/IT/DE, present in
  `.build-temp/`)

None of these is currently recorded in a single registry. The
artifacts are referenced by path inside the runtime code; their
SHA-256, licence compatibility, and version are scattered across
`pyproject.toml`, `Cargo.toml`, `uv.lock`, and per-module
comments.

This ADR formalizes a single model registry that records every
artifact before it is shipped in a production gate.

## Decision

1. **Single registry file** at
   `packages/voice-host/models/registry.json` (desktop) and
   `packages/mobile/src-tauri/voice_models/registry.json`
   (Android). Format below. Both files are tracked, not generated.

2. **Registry entry schema**:

   ```json
   {
     "provider": "kyutai",
     "model_id": "pocket-tts-v1-en-alba",
     "version": "1.0.0",
     "upstream_revision": "github.com/kyutai-labs/pocket-tts@<sha>",
     "sha256": "<hex>",
     "size_bytes": 12345678,
     "licence": "MIT",
     "languages": ["en"],
     "architecture": "flow_lm_main+mimi_decoder",
     "quantization": "fp32",
     "redistributable": true,
     "source": "https://huggingface.co/kyutai/pocket-tts-v1-en-alba/resolve/main/model.safetensors",
     "minimum_runtime": "pocket-tts==3.1.0",
     "compatibility": {
       "engine": "PocketTTS.cpp",
       "ort_version": ">=2.0.0-rc.10",
       "notes": "Requires bos_before_voice.npy conditioning. See ADR-059."
     }
   }
   ```

3. **Download protocol** (per the v2 plan §15 Model Artifact
   Registry):

   ```
   temporary file
     ↓
   SHA verification
     ↓
   metadata validation
     ↓
   atomic promotion (rename into the final cache location)
     ↓
   registry.json updated with the resolved path
   ```

   A partially downloaded model is **never** executed. If SHA
   verification fails, the partial file is deleted and the
   download is retried with exponential backoff. After
   `MAX_RETRY` failures, the engine emits a `voice_error` with
   `stage: "model-download"` and refuses to start Voice.

4. **No silent cloud fallback.** A network failure is not a
   license to use a cloud TTS or STT. The engine surfaces
   `voice_error` with the explicit reason.

5. **Registry hash enforcement**: at startup, the Voice engine
   reads `registry.json` and compares the SHA-256 of every cached
   artifact against the registry. A mismatch is a startup error
   with `stage: "integrity"`. The user is offered to re-download
   or to point the cache at the correct file.

6. **Registry change is a tracked commit**. Adding or updating an
   entry is a code change that goes through the same review
   process as any other tracked file. A new model entry without
   a verified SHA-256 is rejected at PR time by the registry
   schema validator.

7. **Registry contents at adoption time** (committed in this ADR
   as the target):

   | provider | model | sha256 (placeholder) | licence |
   |---|---|---|---|
   | snakers4 | silero-vad-v6.2.2 ONNX | `<recorded before adoption>` | MIT |
   | onnx-asr | parakeet-tdt-0.6b-v3 INT8 | `<recorded before adoption>` | MIT |
   | kyutai | pocket-tts-v1 (per language) | `<recorded before adoption>` | MIT (code), per-artifact (weights) |
   | rhasspy | piper voices (5 ONNX) | `<recorded before adoption>` | GPL-3.0 (Piper), isolated subprocess |

   The Piper licence note follows the v2 plan §15 Piper rule:
   Piper remains an isolated external-process provider on desktop
   only and is **never** embedded in the MIT mobile application.

8. **Privacy, logging and metrics** (per the v2 plan ADR on
   Privacy, Logging and Metrics — to be drafted in ADR-067):

   - Default: the registry records metadata, not voice
     embeddings or transcripts.
   - Content capture requires explicit debug/test mode at
     startup.

## Consequences

- `packages/voice-host/voice_host/live/` and
  `packages/mobile/src-tauri/src/speech.rs` change their model
  lookup to consult the registry first, and refuse to load any
  model whose registry entry is missing or whose SHA-256 does not
  match.
- A startup ABI diagnostic (per ADR-068) reports registry status
  alongside `ort_version`, `pocket_runtime_version`, etc.
- A new `voice_error` stage taxonomy includes `model-missing`,
  `model-download`, `integrity`, `model-load`. (See ADR-068.)
- The current scattered model references are consolidated into
  the two registry files. References that conflict with the
  registry are removed in the same change.

## Open evidence requirements

- SHA-256 recorded for every artifact above **before** adoption.
- Startup diagnostic green against the recorded registry.
- A failed-SHA test (corrupt one byte in a copy, attempt to
  start) that triggers `stage: "integrity"` and refuses to start.
- A registry-change PR template that requires a recorded SHA-256
  before review.

## Status

**DRAFT** — not adopted. The schema and the download protocol are
specified. Adoption requires every SHA-256 to be recorded against
the artifacts in `.build-temp/` and verified by the startup
diagnostic.

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md)
- [ADR-059-voice-portable-pocket-runtime.md](ADR-059-voice-portable-pocket-runtime.md)
- [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md)
- [ADR-061-voice-vad-strategy.md](ADR-061-voice-vad-strategy.md)
- [ADR-062-voice-tts-routing.md](ADR-062-voice-tts-routing.md)
- [ADR-063-voice-fast-decision.md](ADR-063-voice-fast-decision.md)
- [ADR-064-voice-desktop-convergence.md](ADR-064-voice-desktop-convergence.md)
- [ADR-065-voice-agent-authority-boundary.md](ADR-065-voice-agent-authority-boundary.md)
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)
- v2 plan §15 (Model Artifact Registry), §16 (ADR campaign list)
- `.build-temp/silero-vad-v6.2.2.onnx` (2 327 524 bytes)
- `.build-temp/{en_US,de_DE,es_ES,fr_FR,it_IT}-*.onnx` (Piper
  voices)