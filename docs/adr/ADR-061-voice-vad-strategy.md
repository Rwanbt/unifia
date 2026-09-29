<!-- SPDX-License-Identifier: MIT -->
# ADR-061: Voice VAD strategy — Silero ONNX portable + deterministic fallback (2026-09-26)

> Companion to [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md),
> [ADR-059-voice-portable-pocket-runtime.md](ADR-059-voice-portable-pocket-runtime.md),
> [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md),
> and the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).
> Drafts the VAD provider architecture for R4 of the v2 plan. The
> hardware-gated benchmark (UNIFIA-EOT-BENCH) remains open until a
> Windows microphone endpoint and the Xiaomi Mi 10 Pro are both
> available to record audio.

## Context

ADR-058 freezes Silero VAD as the baseline VAD candidate. The desktop
Python pipeline uses Silero via LiveKit Agents' bundled `SileroVAD`
plugin (path: `room audio → Silero VAD → turn detector v1-mini →
Parakeet → …`, see `voice_host/live/agent.py:1-3`). The Android
TypeScript path currently uses a simple RMS-threshold detector
(`packages/app/src/voice/turn-endpointing.ts`), not Silero.

The v2 parity RFC requires Android and desktop to share the same VAD
semantics. The plan §25 ("R4 — Common VAD and Turn Detection") requires
"one portable production candidate selected by evidence", with a
five-language benchmark and the deterministic endpointing policy as a
mandatory fallback.

The
[Silero VAD FAQ](https://github.com/snakers4/silero-vad/wiki/FAQ)
confirms:

- ARM / mobile / edge are supported via the ONNX export.
- The publicly documented model supports only **8 kHz** and **16 kHz**
  input sample rates. Anything else requires resampling.
- The same model revision and equivalent configuration must be used
  on both platforms whenever technically possible.

## Decision (proposed)

1. **VAD provider architecture** is canonical and live in the shared
   `VoiceTurnEngine` (per ADR-060). The provider is a TypeScript port
   of the Silero VAD ONNX inference; the model file is the same
   `silero-vad-v6.2.2.onnx` artifact already present in
   `.build-temp/silero-vad-v6.2.2.onnx` (2 327 524 bytes).

2. **Pin** (committed at qualification time):

   - Model: Silero VAD v6.2.2
   - Export: ONNX (FP32) — recorded SHA-256 in the model registry
     before any production use; the v6.2.2 ONNX export is the
     baseline and is the artifact already downloaded into
     `.build-temp/`.
   - Sample rate: 16 000 Hz mono (matches `OUTPUT_RATE` in
     `voice_host/live/agent.py`).
   - Frame size: 512 samples (32 ms per frame at 16 kHz).
   - Speech threshold: `0.5` (matches the existing TypeScript
     `DEFAULT_TURN_ENDPOINTING_OPTIONS.speechThreshold`).
   - Minimum speech duration: 280 ms (matches existing default).
   - Trailing silence: 650 ms (matches existing default).
   - Maximum utterance: 60 000 ms (matches existing default).
   - State handling: deterministic on `reset()`; probability stream is
     monotonically increasing sequence-numbered per the shared event
     contract.

3. **Deterministic endpointing policy** is mandatory and always
   available, even when Silero is loaded. The existing TypeScript
   `TurnEndpointing` class (`packages/app/src/voice/turn-endpointing.ts`)
   and its Python counterpart are the authoritative implementations.
   When Silero is unavailable (cold start, model download interrupted,
   model integrity failure), the engine falls back to the deterministic
   policy and surfaces a `provider_fallback` event.

4. **No RMS threshold on Android** as the primary VAD for Live. The
   current TypeScript RMS path is acceptable for the current
   transitional slice (per `voice-current-state-2026-09-25.md`) but
   must be retired as soon as the Silero ONNX integration is
   qualified. The existing `turn-endpointing.ts` keeps its place as
   the deterministic fallback and the unit test stays authoritative.

5. **Turn detection router** (companion to VAD): the same Silero
   probability stream feeds three candidates, ranked by measured
   quality (the v2 plan §25 rules):

   - Deterministic (`TurnEndpointing` policy) — always available.
   - Smart Turn v3.2 — initial portable favourite (small ONNX
     model, pinned to a specific Hugging Face revision + SHA-256).
   - TurnSense — investigated at qualification time, kept only if
     evidence supports it.
   - LiveKit `turn-detector-v1-mini` — desktop-only because the
     model licence is LiveKit-specific; per ADR-058 §5 it must not
     be ported outside LiveKit's permitted framework. The shared
     engine never sees it directly.

   The winner is selected by `UNIFIA-EOT-BENCH` evidence, not
   preference. The deterministic policy remains the maximum-silence
   fallback regardless of the winner.

6. **Barge-in timing** (per the v2 plan §13):
   - Stage A — acoustic reflex: VAD-confirmed speech start →
     audible playback mute `p95 ≤ 150 ms`. Acoustic onset → mute
     recorded separately. Both numbers must appear in the gate
     evidence; they must not be combined.
   - Stage B — semantic decision: after `stt_final`, decide whether
     the new utterance means correction / new request / acknowledgement
     / resume / permission answer / cancel agent work / noise. Only
     Unifia performs privileged effects.

## Consequences

- The Android `TurnEndpointing` becomes the deterministic fallback
  on Android. Silero ONNX inference is added behind a `VadProvider`
  contract; the contract owns the probability stream. The TS class is
  unchanged.
- The Python `voice_host/live/agent.py` keeps using LiveKit's
  bundled `SileroVAD` for the LiveKit-transport path because
  LiveKit Agents requires that interface. The shared engine does not
  depend on that interface — it consumes the probability stream
  produced by whichever Silero adapter is loaded. Cross-process
  parity is achieved by recording the probability stream in the
  desktop LiveKit session and replaying it through the Android
  `TurnEndpointing` + `VadProvider` fixture; identical
  `turn_incomplete` / `turn_complete` boundaries must result.
- `UNIFIA-EOT-BENCH` must exist before this ADR is amended from DRAFT
  to ADOPTED. The benchmark corpus is recorded in a deterministic
  fixture format, versioned alongside the model SHA-256.

## Open evidence requirements (R4 gate)

- Silero VAD v6.2.2 ONNX SHA-256 recorded in the model registry.
- `UNIFIA-EOT-BENCH` corpus created:
  - five languages (EN/FR/ES/IT/DE)
  - short statements, questions, long sentences, pauses,
    hesitations, fillers, false endings, conjunction continuation,
    enumerations, corrections, incomplete utterances, background
    noise, speech over assistant audio, whisper, clipping, rapid
    interruption, multilingual switch.
- Deterministic replay: same fixture through Python Silero and
  Android Silero must produce probability sequences within the
  allowed epsilon (recorded at qualification time).
- Barge-in p95 mute measurement on Windows and on the Xiaomi under
  the canonical load profile (no LLM, Pocket TTS, Parakeet STT,
  selected turn detector).
- Acoustic onset → mute timing recorded separately from
  VAD-confirmed → mute. Both numbers in the evidence package.

## Status

**DRAFT** — not adopted. The provider architecture is sketched, the
pins are committed to specific values (model v6.2.2, sample rate 16
kHz, frame 512, threshold 0.5, durations 280 / 650 / 60 000), and
the deterministic fallback is already implemented and tested.
Adoption requires the evidence above, which requires the physical
gates listed in
[CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md).

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md)
- [ADR-059-voice-portable-pocket-runtime.md](ADR-059-voice-portable-pocket-runtime.md)
- [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md)
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)
- `packages/voice-host/voice_host/live/agent.py` — desktop Silero +
  LiveKit turn-detector-v1-mini pipeline
- `packages/app/src/voice/turn-endpointing.ts` — deterministic TS
  fallback (authoritative)
- `packages/app/src/voice/turn-endpointing.test.ts` — fallback unit
  test (authoritative)
- `.build-temp/silero-vad-v6.2.2.onnx` — pinned model artifact
- [snakers4/silero-vad FAQ](https://github.com/snakers4/silero-vad/wiki/FAQ)
- [k2-fsa/sherpa-onnx VAD docs](https://k2-fsa.github.io/sherpa/onnx/vad/silero.html)
  (cross-reference for Silero ONNX embedding conventions)