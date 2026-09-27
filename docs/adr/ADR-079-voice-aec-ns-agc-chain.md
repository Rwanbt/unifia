<!-- SPDX-License-Identifier: MIT -->
# ADR-079: Voice echo cancellation / audio processing chain

**Date**: 2026-09-27 | **Status**: Partially Implemented host (capability negotiation / lease lifecycle only; no DSP adapter; G9 physical gate open)

## Context

§16 and §32 require the assistant to keep listening while it speaks. The native audio path from ADR-078 captures raw PCM from the microphone while the Oboe playback path is emitting TTS — without echo cancellation, every assistant utterance becomes a new user turn. The platform exposes hardware echo cancellation on most modern Android devices through the `VOICE_COMMUNICATION` or `VOICE_PERFORMANCE` AudioRecord presets, but its availability, quality, and behaviour vary by device, route (speaker / wired headset / Bluetooth), and double-talk. §16 also requires that the chain not assume Android WebRTC constraints equal a production AEC guarantee.

## Decision

The capability-detection chain, in priority order:

1. **Platform/hardware AEC** — request `VOICE_COMMUNICATION` (preferred) or `VOICE_PERFORMANCE` AudioSource and verify via the `android.media.audio.HwAudioSource` capability flag. If the platform reports hardware AEC on the active route, use it with no software overlay.
2. **Verified software AEC fallback** — when hardware AEC is unavailable (route, device, or capability flag), fall back to a software chain: WebRTC Audio Processing Module (`webrtc-audio-processing` / `apm`) running **AEC3 + NS + AGC**. The chain is built once per session, parameters are tuned for the canonical mono 16 / 48 kHz PCM, and the output buffer is exactly the same shape as the input (no resample inside the AEC).
3. **Explicit degraded mode** — when both platform and software AEC fail or are unavailable (insufficient CPU headroom, missing native library, known-broken device), the audio path emits a typed `audio_route_changed` event with `aec: "disabled"` and a typed `voice_error` carrying stable code `aec-fallback-failed`. VoiceCore keeps the microphone open, marks the route as **AEC-degraded**, suppresses assistant playback when the user speaks (acoustic barge-in still works), and exposes the degraded state in the diagnostics surface. The user sees a clear "echo cancellation unavailable" indicator; the product does not pretend to be duplex.

The chain is pluggable behind a Rust `AecChain` trait with three implementations: `HardwareAecChain`, `WebRtcAecChain`, `DegradedChain`. Capability detection runs once on session open and again on every `audio_route_changed` event. The chain never blocks the Oboe callback: AEC runs on a worker thread consuming the capture ring and producing a separate ring the STT reads. The worker is pinned at realtime priority and never blocks on model inference or logging.

NS (noise suppression) and AGC (automatic gain control) ride on the same chain. AGC targets a -3 dBFS speech RMS; NS targets -12 dB SNR improvement on babble / HVAC / room noise corpora.

## Alternatives rejected

- **Assume Android WebRTC constraints equal a production AEC guarantee**: false on most consumer devices — the WebRTC APM requires a known speaker-to-mic delay, which drifts with route changes and Bluetooth clocks.
- **Single AEC mode without an explicit degraded fallback**: §16 explicitly bans this; the chain must degrade honestly, not silently.
- **Per-device hand-tuned AEC**: not maintainable across the install base.

## Consequences

Until the chain is integrated, G9 (full duplex) and §32 (physical full-duplex) are blocked. The chain is the prerequisite for true two-stage barge-in (§27) and for any self-echo-free assistant playback during user speech. The capability detection runs cheaply and never fails closed silently — when AEC is unavailable, the user is told and the chain continues in degraded mode rather than disabling Voice entirely. Bluetooth limitations (HFP / A2DP / LE Audio) are explicitly documented per §33 and surfaced through `audio_route_changed` events; unsupported profiles are not claimed as PASS.
