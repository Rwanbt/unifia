<!-- SPDX-License-Identifier: MIT -->
# ADR-077: Voice streaming STT selection — Nemotron 3.5 via nemo-speech, honest final-only fallback (2026-09-27)

> Companion to [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md),
> [ADR-066-voice-model-artifact-registry.md](ADR-066-voice-model-artifact-registry.md),
> and the `StreamingSttProvider` contract in
> `packages/contracts/src/streaming-stt.ts`. Campaign §20 (streaming
> STT — real provider, not mock) and §10 (Streaming STT Selection
> ADR, separate from the generic STT contract).
>
> **Status: IMPLEMENTED host-side, PRODUCTION QUALIFICATION OPEN.**
> The provider, fallback and router are implemented and tested; the
> model is pinned in the registry; the live five-language host e2e
> passes. §20 Android constraints (size, RAM, CPU, thermal, battery,
> coexistence with the local LLM) and Windows/Android physical
> evidence are **not yet measured** — this ADR does not claim them.

## Context

The `StreamingSttProvider` contract and a deterministic mock existed
since R5, but no real provider implemented it. Campaign §20 forbids
"faking streaming": until a candidate passes Android resource limits,
the interface must stay honest and fall back to the best final-only
transcriber rather than emit synthetic partials.

The G5 host bake-off (commit `1b8b53c757`, harnesses in
`scripts/voice/g5_*.py`, evidence in
`.build-temp/g5-streaming/results/`) compared three paths over the
91-fixture UNIFIA-EOT-BENCH corpus after a validity screen (45 valid
/ 46 invalid; the corpus contains degenerate TTS fixtures, proved by
two independent ASRs failing the same files):

| Path | Valid-WER | First partial (wall) | Final | Errors | Notes |
|---|---|---|---|---|---|
| nemo-speech 0.1.0 WS, q8_0 GGUF | 0.3013 | 1,243 ms | 171 ms mean | 0/91 | RTF 0.22; 7 valid fixtures render empty finals (runtime streaming-path defect) |
| transformers F32 streaming (Python host reference) | 0.3356 | 1,483 ms | 120 ms mean | 0/91 | recovers 4 of the 7 drops; not an Android-packaged runtime |
| Parakeet TDT v3 INT8 batch (final reference) | 0.0176 (EN n=20) | n/a (batch) | n/a | 0 | preserved as final/batch reference per §20 |

## Decision

1. **Canonical contract.** `StreamingSttProvider` in
   `packages/contracts/src/streaming-stt.ts` remains the single
   streaming interface. The contract gained the honest final-only
   provider id `"parakeet-tdt-final"` and the error codes
   `STREAM_EMPTY_FINAL` and `STREAM_TRANSCRIPTION_FAILED`.

2. **Streaming winner (provisional, host-qualified): Nemotron 3.5
   streaming via the native nemo-speech runtime.**
   - Model: `nvidia/nemotron-3.5-asr-streaming-0.6b` q8_0 GGUF,
     741,548,352 bytes, SHA-256
     `a5c435f294eea8f88ce68dd27b8c3bfea7f777cb2fbba04fcd30eaa555f429ae`,
     HF revision `1c8deaecc64b91f034d73e08dd8b64625eb3395d`.
   - Licence: **OpenMDW-1.1** (verified from the licence text on
     2026-09-27; redistribution permitted with the agreement and
     origin notices retained).
   - Runtime: nemo-speech 0.1.0 WebSocket
     (`/v1/audio/transcriptions/realtime`, PCM16 mono, session
     configured before the first audio frame) plus the offline
     endpoint as a per-turn route-around.
   - Registry entry: `nvidia:nemotron-3.5-asr-streaming-0.6b-q8-0-gguf`
     in `packages/voice-host/models/registry.json` (validator green).

3. **Honest fallback: `parakeet-tdt-final`.** A final-only provider
   (`createFinalSttFallbackProvider`) buffers the turn, emits exactly
   one trimmed final, advertises `partials: false`, and never
   synthesizes partials. `selectStreamingStt` prefers a healthy
   streaming provider and falls back with a classified reason
   (`streaming_provider_absent`, `STREAM_LANGUAGE_UNSUPPORTED`,
   `prepare_failed:<code>`); an abort during streaming prepare
   rethrows instead of silently degrading.

4. **Empty-final route-around, never a silent lie.** The bake-off
   proved 7 valid fixtures end in an empty streaming final (runtime
   defect, recovered offline on 5/7). The provider reacts to a
   non-trivial turn ending in `""` by transcribing the buffered PCM
   through the offline endpoint: success yields the recovered text
   plus `STREAM_EMPTY_FINAL` with `recovered: true`; failure yields
   an honest empty final with `recovered: false`. Short audio and
   silence are plain empty finals without an error.

5. **Capacities recorded with evidence.** `nemotron-streaming`
   advertises `partialLatencyMs: 1300`, `finalLatencyMs: 200` — the
   measured bake-off means (1,243 ms / 171 ms). The §45 target of a
   first useful partial < 800 ms is **not yet met** (live e2e warm
   run: en 1,265 / fr 807 / es 736 / it 925 / de 1,636 ms) and stays
   an open optimization, tracked in the autonomous state file.

6. **Evidence pointers.** Bake-off: `.build-temp/g5-streaming/results/g5-nemotron-full.json`
   (ignored). Live provider e2e: `packages/app/src/voice/streaming-stt-nemo.e2e.test.ts`,
   gated on `G5_E2E_URL`, results in
   `.build-temp/g5-streaming/results/g5-e2e-provider.json` — five
   nominal languages, realtime pacing, WAV SHA verification, PASS
   2026-09-27 (46 assertions, finals 162–235 ms, zero provider
   errors).

## Rejected alternatives

- **Faking streaming** (emitting staged partials around a batch
  call) — explicitly forbidden by §20; would violate the contract's
  honesty invariant.
- **transformers F32 streaming as the shipped path** — better WER on
  two drop fixtures, but it is a Python/PyTorch host reference with
  no stable Android packaging story; kept as a benchmark reference.
- **Vosk / ufal whisper_streaming** — recorded from primary sources
  as C3 candidates; not corpus-run in this session, therefore not
  selectable on evidence yet.
- **Dropping the Parakeet batch reference** — §20 requires keeping
  Parakeet TDT v3 INT8 as the final/batch reference until evidence
  justifies replacement (its EN valid-WER 0.0176 still beats every
  streaming candidate).

## Consequences

- The streaming provider, fallback and router are unit-tested (41
  tests) and live-e2e-tested on the host; the honest fallback keeps
  the system correct on machines where the nemo runtime is absent.
- Android cannot yet run this provider: the nemo-speech runtime is
  not packaged for Android, and §20 mobile constraints are
  unmeasured. Android Live therefore stays on batch Parakeet with
  the honest final-only fallback available through the router — no
  streaming claim is made for the phone until measurements exist.
- Production consumers (dictation, Android Live, desktop supervisor)
  are not wired to the new provider yet; wiring and the desktop
  endpoint decision (including webview CORS for any in-app fetch)
  are recorded as open actions in
  `docs/operations/voice-v2-autonomous-state.md`.
- The first-partial < 800 ms target, Android packaging, and physical
  Windows/Xiaomi evidence remain the open qualification path before
  this selection can be called final.
