<!-- SPDX-License-Identifier: MIT -->
# ADR-072: Voice Offline and Network Policy — local Voice = no mandatory network (2026-09-26)

> Companion to the ADR chain
> [ADR-058](../adr/ADR-058-voice-runtime.md) through
> [ADR-071](../adr/ADR-071-voice-language-voice-resolution.md),
> and the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).

## Context

The v2 plan §16 requires an ADR titled "Offline and Network
Policy". When local Voice + local LLM are selected:

- no network required after assets are installed
- no hidden telemetry dependency
- no cloud speech
- no external STUN requirement
- no remote Voice Host requirement

Remote provider use must be explicit.

The v2 plan §5 also reinforces this on Android: "no mandatory
Internet", "no mandatory LiveKit server", "no cloud STT/TTS".
When a remote LLM provider is explicitly selected by the user,
that provider may of course use its normal network path.

## Decision

1. **Local Voice = no mandatory network**. Once the model
   artifacts are downloaded (per ADR-066) and verified, the
   local Voice path operates entirely on-device:

   - Capture and playback use the OS audio adapter only.
   - VAD runs the pinned Silero ONNX inference on CPU.
   - STT runs the pinned Parakeet ONNX inference on CPU.
   - TTS runs the Pocket pipeline on CPU.
   - The AgentBridge talks to the local Unifia session; if the
     user has selected a local LLM, the session runs the local
     model. If the user has selected a remote LLM, the session
     uses that provider's network path.

   No other network call is required. No background telemetry
   upload, no remote STUN, no remote Voice Host, no remote TURN.

2. **No hidden telemetry dependency**. The Voice components do
   not phone home at any point. The privacy posture per ADR-067
   applies: default off, opt-in only. The startup diagnostic
   (per ADR-068) does not transmit anything off-device.

3. **No cloud speech fallback**. Per ADR-062 §2: "No silent
   cloud fallback. A network failure is not a license to use
   a cloud TTS or STT. The engine surfaces `voice_error` with
   the explicit reason." A network failure during local TTS
   synthesis emits `voice_error` with `stage: "tts"` and
   `code: "TTS_PROVIDER_ERROR"`; the engine does not silently
   redirect to a cloud provider.

4. **No external STUN requirement**. The local Voice path does
   not need STUN. The desktop Live path uses LiveKit, which
   needs STUN/TURN when remote; per ADR-058 §15.5 the
   LiveKit-specific `turn-detector-v1-mini` model and the
   LiveKit transport itself remain desktop-only and
   LiveKit-permitted-framework-only. Local Voice on Android does
   not touch LiveKit at all.

5. **No remote Voice Host requirement**. The desktop Voice
   Host (Python `voice_host`) is the only path on desktop. The
   Android local Voice path does not need a desktop Voice Host.
   When the user is on Android, the Voice Host on the desktop
   is irrelevant; the Android device is autonomous.

6. **Explicit remote provider use**. When the user selects a
   remote LLM, a remote STT, or a remote TTS, the engine
   surfaces a `voice_ready` event with `capabilities.remote:
   { provider_id, model_id, network_required: true }`. The UI
   shows a "remote provider in use" badge. The user can see at
   any time which paths are local and which are remote.

7. **Airplane mode after asset install**. Once the model
   artifacts are installed and verified, the user can flip the
   device to airplane mode. Voice continues to function
   normally. The R12 gate requires a physical test that
   demonstrates this on the Xiaomi (per the v2 plan §33).

8. **Network failure handling**. When the local Voice path
   detects a network failure that affects a remote provider,
   it emits `voice_error` with `stage: "network"`. The local
   Voice components do not depend on the network and continue
   to operate. The user is asked to confirm whether they want
   to keep the remote provider (with retry) or fall back to a
   local-only profile.

9. **Asset download requires network once**. The initial
   download of the model artifacts (per ADR-066 §3) is the
   only mandatory network step. The download protocol is
   `temp → SHA verify → metadata → atomic promote`. After
   promotion, the network is no longer required for Voice to
   function.

10. **No peer-to-peer discovery**. Local Voice does not use
    mDNS, Bonjour, BLE, or any other local-network discovery
    mechanism to find peers, services, or relays. The Voice
    Host address (when used on desktop) is configured by the
    user, not discovered.

## Consequences

- A `voice_ready` event includes a `capabilities.remote` block
  listing every active remote provider. A network call from a
  provider not in this block is a contract violation.
- The startup ABI diagnostic (per ADR-068) records
  `network_required: true|false` per provider. The diagnostic
  is the canonical place to verify "no hidden telemetry
  dependency".
- The R12 Android standalone qualification (per the v2 plan
  §33) requires an airplane-mode test that demonstrates
  Voice continues to function with no network.
- The voice-host pytest suite gains a test that asserts no
  network call leaves the process during a local Voice
  synthesis. The test mocks the HTTP client and asserts no
  request is made.
- The Android Rust binding test gains a similar test using a
  localhost netcat or a network monitor.

## Open evidence requirements

- A test that fails if any local-only Voice code path issues
  an outbound network request.
- A `voice_ready` payload recorded on Android with the device
  in airplane mode showing `capabilities.remote: []` (empty)
  for a local-only profile.
- A wire capture during a local-only Voice run showing only
  loopback traffic (no external IPs).
- An explicit consent dialog whenever the user opts into a
  remote provider, recording the consent timestamp in the
  session metadata.

## Status

**DRAFT** — not adopted. The policy is specified. Adoption
requires the offline test, the airplane-mode evidence, and the
wire capture to be recorded and reviewed.

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md) §5
- [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md)
- [ADR-062-voice-tts-routing.md](ADR-062-voice-tts-routing.md) §2
- [ADR-065-voice-agent-authority-boundary.md](ADR-065-voice-agent-authority-boundary.md)
- [ADR-066-voice-model-artifact-registry.md](ADR-066-voice-model-artifact-registry.md) §3
- [ADR-067-voice-privacy-logging-metrics.md](ADR-067-voice-privacy-logging-metrics.md)
- [ADR-068-voice-runtime-abi-onnx.md](ADR-068-voice-runtime-abi-onnx.md)
- [ADR-071-voice-language-voice-resolution.md](ADR-071-voice-language-voice-resolution.md)
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)
- v2 plan §5 (Android platform), §16 (ADR campaign list),
  §33 (R12 standalone qualification)