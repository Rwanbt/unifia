<!-- SPDX-License-Identifier: MIT -->
# ADR-062: Voice TTS routing — Pocket primary, isolated Piper fallback, Android fallback contract (2026-09-26)

> Companion to [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md),
> [ADR-059-voice-portable-pocket-runtime.md](ADR-059-voice-portable-pocket-runtime.md),
> [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md),
> [ADR-061-voice-vad-strategy.md](ADR-061-voice-vad-strategy.md),
> and the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).
> Drafts the TTS routing decision for R8 of the v2 plan.

## Context

ADR-058 freezes Pocket as the primary TTS and Piper as the desktop
fallback. The v2 plan §29 ("R8 — TTS Routing and Manual Voice Parity")
requires a single canonical `TtsRouter` used by Live, manual read-aloud
and preview, with explicit language/voice resolution, no silent cloud
fallback, and the priority `Live > manual > autoplay`.

The desktop Python implementation already exists at
`packages/voice-host/voice_host/live/tts.py:303 class TtsRouter` with
the documented behaviour:

- `preference` accepts `auto` (Pocket → Piper), `pocket` (force
  Pocket), `piper` (force Piper).
- The `auto` policy tries Pocket first; if Pocket is unhealthy
  (within `POCKET_COOLDOWN_SECONDS` after a failure), Piper is tried
  first.
- A backend that produced no audio before failing is never restarted
  in the middle of an utterance ("never restart an utterance that
  already started playing" — the explicit invariant in the existing
  implementation, line 352).
- Each successful synthesis records a `RouteRecord` with
  `requested`, `resolved`, `language`, `fallback_reason`, and
  `first_audio_ms`. `first_audio_ms` is the `tts_first_audio`
  metric anchor required by the v2 plan §21 instrumentation.

The Android TypeScript path currently uses the WebView
`speechSynthesis` API with the `localService` voice required as the
production voice. This is the transitional slice (per
`voice-current-state-2026-09-25.md`) and is not the v2 final
implementation.

## Decision (proposed)

1. **`TtsRouter` is canonical and lives in the shared
   `VoiceTurnEngine` package** (per ADR-060). The desktop Python
   `TtsRouter` and the Android `TtsRouter` both implement the same
   contract; parity is recorded by a fixture-driven test that drives
   the same synthesis requests through both implementations and
   compares `resolved`, `first_audio_ms`, and the PCM fingerprint
   within the recorded epsilon.

2. **Backend priority**:

   ```
   Pocket (primary)
   → validated local fallback (currently Piper on desktop)
   → explicit error (no silent cloud)
   ```

   - "Validated local fallback" means the fallback candidate has
     successfully passed the `UNIFIA-TTS-BENCH` parity gate for the
     target language and voice. A new fallback candidate is not
     admitted automatically.
   - "Explicit error" means the engine emits a `voice_error` event
     with `stage: "tts"` and a human-readable `detail`. The UI
     surfaces this error; the user can either retry, change language,
     or accept text-only mode. There is no implicit degradation to
     cloud speech.

3. **Android TTS candidates** are determined by the R7 bake-off
   (per ADR-059). Today the only officially released sherpa-onnx
   Pocket bundle is English `2026-01-26 INT8`; multilingual Pocket
   on Android requires `PocketTTS.cpp` (Kyutai official C++ ORT)
   qualification, which is an evidence-only decision. Until
   qualified, Android uses `FallbackTtsProvider` labelled
   `system-tts (transitional)` and the UI clearly states that the
   final Pocket parity gate is pending.

4. **Piper isolation** (legal/process boundary, ADR-058 §15.5):

   - Piper remains an isolated external-process provider on desktop
     only. It is invoked through the `piper-host` subprocess.
   - Piper is **never** embedded in-process on the MIT mobile
     application: the active Piper runtime is GPL, the mobile
     application is MIT, and embedding without an isolation strategy
     is forbidden by the v2 plan §15.
   - The `FallbackTtsProvider` interface on Android may not wrap
     Piper until the legal review documents the boundary.

5. **Playback priority** (per the v2 plan §29):

   ```
   Live > manual read-aloud > autoplay
   ```

   The shared engine owns the lease. Mic dictation and Live cannot
   simultaneously own capture; explicit leases are the only way to
   decide. The lease is recorded with sequence numbers and timestamps
   so the gate evidence can prove no duplicate turns under contention.

6. **Cancellation**:

   - The `tts_cancelled` event carries the same `sessionID` and
     `turnID` as the synthesis request, plus a `reason` matching
     the cancel taxonomy (user-barge, agent-cancel, error,
     route-change).
   - Mid-utterance cancellation of a backend that already produced
     audio stops playback immediately. The backend is **not**
     restarted — "never restart an utterance that already started
     playing" (existing invariant, line 352).
   - The Stage A barge-in target (`p95 ≤ 150 ms` VAD-confirmed →
     audible mute) is measured separately from
     `tts_cancelled.reason = user-barge`. The two metrics must not
     be combined.

7. **Streaming chunks**:

   - The Pocket backend streams PCM at the same rate as the
     desktop pipeline: 24 000 Hz mono, 16-bit signed little-endian.
   - First-audio latency (`tts_first_audio`) is reported per
     `RouteRecord`; the v2 plan target is `TTFA < 250 ms` warm
     (`RTF < 0.7`). Deviations are recorded, not silently absorbed.
   - Cancellation latency is the difference between
     `tts_cancelled.seq` and the last `tts_audio.seq` of the same
     `segment`. The fixture records both numbers.

8. **Language and voice resolution**:

   - Resolution order: explicit user setting → final STT language →
     conversation language → application locale → English fallback.
   - Never silently switch to a voice incompatible with the
     resolved language. The UI shows the voice identity at the
     top of the speech bar.
   - The TTS router records the resolved voice identity with each
     `RouteRecord`; parity tests compare both `resolved` and the
     voice's pinned asset SHA-256.

## Consequences

- The Android `tts-synthesis.ts` and any per-platform TTS wrappers
  must move behind the `TtsRouter` interface. The current
  `android-offline-tts.ts` is the transitional slice and is replaced
  by the new provider when the R7 bake-off produces a qualifying
  Pocket candidate. Until then, the transitional slice is
  explicitly labelled.
- The Python `TtsRouter` gains the language/voice resolution step
  and the explicit-error path; both are additive and do not change
  the recorded behaviour of `first_audio_ms` or the
  "no-restart-mid-utterance" invariant.
- A new `FallbackTtsProvider` interface is added for Android. The
  default implementation is `system-tts (transitional)` with the
  explicit UI label; production Pocket, when qualified, replaces it.

## Open evidence requirements (R8 gate)

- Five-language Pocket TTFA, RTF, cancellation latency on Windows
  with the pinned model SHAs.
- Five-language parity between desktop Pocket and the candidate
  Android runtime (per R7 outcome).
- Failure-mode tests: Pocket load failure, Pocket mid-stream
  failure, cancellation, fallback, language mismatch, voice
  missing, corrupt artifact, no-network mode.
- Lease test: Live and dictation cannot own the mic simultaneously;
  recorded evidence.
- Legal review recording the Piper isolation boundary on desktop
  and confirming the absence of any GPL embedding on Android.

## Status

**DRAFT** — not adopted. The contract is sketched and the priority
order is fixed. Adoption requires the R7 candidate to qualify, the
fixtures above to be recorded, and the legal review to confirm the
Piper isolation.

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md)
- [ADR-059-voice-portable-pocket-runtime.md](ADR-059-voice-portable-pocket-runtime.md)
- [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md)
- [ADR-061-voice-vad-strategy.md](ADR-061-voice-vad-strategy.md)
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)
- `packages/voice-host/voice_host/live/tts.py:303 class TtsRouter`
  — existing desktop Python implementation
- `packages/voice-host/voice_host/live/agent.py:1-3` — desktop
  LiveKit pipeline
- `packages/app/src/voice/android-offline-tts.ts` — Android
  transitional slice
- `packages/app/src/voice/android-local-voice.ts` — Android local
  transport (transitional)
- `packages/piper-host/` — desktop Piper subprocess isolation