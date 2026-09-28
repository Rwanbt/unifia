<!-- SPDX-License-Identifier: MIT -->
# ADR-064: Voice desktop convergence — staged migration to shared Voice core (2026-09-26)

> Companion to
> [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md),
> [ADR-059-voice-portable-pocket-runtime.md](ADR-059-voice-portable-pocket-runtime.md),
> [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md),
> [ADR-061-voice-vad-strategy.md](ADR-061-voice-vad-strategy.md),
> [ADR-062-voice-tts-routing.md](ADR-062-voice-tts-routing.md),
> [ADR-063-voice-fast-decision.md](ADR-063-voice-fast-decision.md),
> and the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).
> Drafts the desktop migration plan for R13 of the v2 plan.

## Context

The v2 plan §34 ("R13 — Desktop/Server Convergence") requires the
desktop nominal semantics to migrate to the shared `VoiceTurnEngine`
without removing the proven legacy path until the new path beats or
matches it. The legacy desktop path is
`voice_host.live.agent` (LiveKit Agents), which already implements
the documented pipeline:

```
room audio → Silero VAD → turn detector v1-mini → Parakeet →
VoiceAgentBridge (existing Unifia session) → SpeechSegmenter →
SpeechRenderer → TtsRouter (Pocket, Piper fallback) → room audio
```

See `packages/voice-host/voice_host/live/agent.py:1-3`. The legacy
path is what Wave D, E and F qualification campaigns measured; it is
authoritative for everything recorded as PASS through 2026-09-25.

ADR-060 specifies the new shared `VoiceTurnEngine` contract. This
ADR defines how the desktop Python path migrates to it.

## Decision (proposed)

1. **Stage 0 — land the shared package behind feature flags**, with
   zero behavioural change:

   - Land `packages/contracts/voice/turn-engine.ts` with the typed
     event vocabulary, the capability types, and the provider
     contracts (per ADR-060, ADR-061, ADR-062, ADR-063).
   - Implement the desktop Python adapter
     (`LivekitAgentTurnEngine`) that wraps the existing
     `voice_host.live.agent`. It accepts the same inputs and emits
     the same events as the legacy path. The legacy path is still
     authoritative.
   - Implement the Android TypeScript adapter
     (`WebViewTurnEngine`) that wraps the existing
     `live-controller.ts`. Same shape.
   - Tests: contract tests run against the adapters. They must pass
     against the legacy implementations with zero behaviour change.

   **Gate 0**: existing Voice still works through adapters. All new
   contract tests green. No UI regression.

2. **Stage 1 — desktop consumer of the shared engine behind a feature
   flag**:

   - The desktop Python process gains a `voice_engine_v2` switch.
   - When enabled, `LivekitAgentTurnEngine` is the live
     `VoiceTurnEngine`. The legacy `voice_host.live.agent` stays
     available as a fallback under `voice_engine_v2_legacy = true`.
   - The new path must beat or match the legacy path on the existing
     regression suite (Wave D through F) before the flag defaults to
     `true`.
   - Measure LLM coexistence (the v2 plan §20 LLM coexistence table)
     and record the regression in the gate evidence.

   **Gate 1**: desktop historical flows remain green (D/E/F). New
   `LivekitAgentTurnEngine` measures within the accepted latency and
   accuracy bands.

3. **Stage 2 — Android consumer of the shared engine behind a feature
   flag**:

   - The Android app gains a `voice_engine_v2` switch.
   - The new path replaces the WebView `LiveVoiceController` only
     when the parity fixture recorded in Stage 1 is met. The
     transitional slice (WebView `speechSynthesis` /
     `android-offline-tts.ts`) remains as the fallback until the R7
     candidate qualifies.
   - Barge-in Stage A (`p95 ≤ 150 ms`) is measured on the Xiaomi;
     the result is the gate evidence.

   **Gate 2**: Android unit flows remain green. Shared
   `VoiceTurnEngine` is canonical on Android. Parity fixture passes.

4. **Stage 3 — retire the legacy paths** (only after evidence):

   - Retire `voice_host.live.agent` and the
     `LiveVoiceController` `host` branch. The shared engine owns
     both.
   - The transitional WebView TTS path is replaced by the R7
     candidate once it qualifies. Until then, the transitional path
     is the Android fallback under an explicit UI label.
   - Gate evidence: 30-day soak with no regressions, no P0/P1
     defects, LLM coexistence within the recorded budget.

   **Gate 3**: shared architecture is canonical. No desktop
   regression above accepted limits.

5. **Rollback strategy** is non-destructive: the feature flags stay
   for the lifetime of the v2.x line. The legacy paths remain in
   source control and are not deleted; they are only stopped from
   being executed by default. A regression in production flips the
   flag back without a rebuild.

## Consequences

- The `voice_host.live.agent` LiveKit path stays authoritative
  until Gate 1 green. No interface changes to its public surface.
- The `LiveVoiceController` `host` branch on Android stays
  authoritative until Gate 2 green. No interface changes to its
  public surface.
- The desktop Python test suite (currently 71 tests collected,
  per the cold-managed `voice-host-test-runner.py`) gains a
  `LivekitAgentTurnEngine` parity suite that replays the recorded
  Wave D/E/F fixtures.
- The Android TypeScript test suite gains a `WebViewTurnEngine`
  parity suite that replays the recorded desktop fixtures on the
  Xiaomi emulator (or a real device when available).
- A new `LivekitAgentTurnEngine` lives next to the existing
  `voice_host.live.agent` for at least one release. It is not the
  default until Gate 1 green.

## Open evidence requirements (R13 gate)

- Stage 0 contract tests green with both adapters.
- Stage 1 desktop regression suite green. LLM coexistence recorded.
- Stage 2 Android parity fixture green. Barge-in p95 on Xiaomi.
- Stage 3 30-day soak with no regressions. No P0/P1 defects.

## Status

**DRAFT** — not adopted. The staged migration is sketched. Each gate
requires the recorded evidence above.

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md)
- [ADR-059-voice-portable-pocket-runtime.md](ADR-059-voice-portable-pocket-runtime.md)
- [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md)
- [ADR-061-voice-vad-strategy.md](ADR-061-voice-vad-strategy.md)
- [ADR-062-voice-tts-routing.md](ADR-062-voice-tts-routing.md)
- [ADR-063-voice-fast-decision.md](ADR-063-voice-fast-decision.md)
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)
- `packages/voice-host/voice_host/live/agent.py` — legacy desktop
  Python authoritative path
- `packages/app/src/voice/live-controller.ts` — legacy Android
  TypeScript authoritative path
- `scripts/voice/voice-host-test-runner.py` — cold-managed
  Python 3.12 venv provision
- `scripts/voice/android-live-trace-capture.sh` — Android trace
  collector pre-stage for the R12 gate