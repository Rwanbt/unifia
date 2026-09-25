<!-- SPDX-License-Identifier: MIT -->
# ADR-069: Voice Audio Routes and Bluetooth — behaviour matrix, no full-duplex parity claim (2026-09-26)

> Companion to the ADR chain
> [ADR-058](../adr/ADR-058-voice-runtime.md) through
> [ADR-068](../adr/ADR-068-voice-runtime-abi-onnx.md),
> and the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).

## Context

The v2 plan §16 requires an ADR titled "Audio Routes and Bluetooth"
defining behaviour for speaker, wired headset, USB headset,
Bluetooth, earbuds removal, route switch mid-turn, phone call,
notification/audio focus loss.

The v2 plan §13 explicitly forbids claiming full-duplex Bluetooth
parity until physically tested. Graceful degradation is acceptable
if explicit.

This is the operational counterpart to ADR-061 (VAD), ADR-062 (TTS
routing), and ADR-065 (Authority Boundary): once the providers are
chosen, the audio routes decide whether the providers can actually
serve the user.

## Decision

1. **Routes the engine must handle** (per the v2 plan §36 edge
   cases that apply to routes):

   - speaker (built-in)
   - wired headset (3.5 mm TRRS, USB-C analogue headset)
   - USB headset (USB audio class)
   - Bluetooth (HFP / A2DP / LE Audio)
   - earbuds removal mid-utterance
   - route switch mid-turn (headphone unplug → speaker)
   - phone call (Android)
   - notification / audio focus loss (Android)

2. **Behaviour matrix** (high level; details captured in
   `voice_runtime_baseline.md` once the runtime qualifies each
   path):

   | Event | Mic | Playback | TTS | Live session |
   |---|---|---|---|---|
   | Speaker (default) | capture | route to speaker | yes | yes |
   | Wired headset | capture | route to headset | yes | yes |
   | USB headset | capture | route to USB | yes | yes |
   | Bluetooth (HFP) | capture | route to BT | yes | yes (degraded) |
   | Earbuds removed | mute mic, raise event | switch to speaker | yes | cancel Live with `reason: route-loss` |
   | Route switch mid-turn | re-route capture | re-route playback | continue current segment | continue; emit `audio_route_changed` |
   | Phone call (Android) | mute mic, raise event | duck playback | yes | cancel Live with `reason: focus-loss` |
   | Notification focus loss (Android) | mute mic | duck playback | yes | continue Live with reduced priority |

3. **Bluetooth caveat (per the v2 plan §13)** — full-duplex over
   Bluetooth is **not** claimed. The matrix records the behaviour
   we measured on the Xiaomi once the hardware gates are reached.
   Until measured, the engine surfaces an explicit
   `provider_fallback` event if the route cannot sustain Live
   capture + playback simultaneously.

4. **Android audio focus** (per the v2 plan §6 "Only these should
   normally differ: ... Android audio focus"). The shared engine
   abstracts audio focus behind the `AudioOutputProvider`
   interface. The Android adapter implements focus loss as a
   `resource_pressure` event with `pressure: "network"` mapped to
   the focus-loss taxonomy; the desktop adapter implements the
   same interface but never raises focus-loss events on Windows
   (Windows does not have an equivalent transient-focus concept
   in the same shape).

5. **Route loss during Live**: the shared engine emits an
   `audio_route_changed` event with `route: AudioRoute` and an
   `interrupted: true` flag if the route loss is severe enough to
   break the current Live session. The Stage A barge-in
   measurement (per ADR-061 §6 and the v2 plan §13) is recorded
   separately from the route-loss notification; the two metrics
   are not combined.

6. **Bluetooth qualification gate** — a separate, recorded
   qualification gate per Bluetooth profile:

   - HFP (Hands-Free Profile) capture + SCO playback.
   - A2DP (Advanced Audio Distribution) playback only.
   - LE Audio (LC3 / Auracast) when supported by the Xiaomi and
     paired device.

   Each profile gets its own gate record: device, OS build,
   latency, AEC convergence, double-talk behaviour, dropouts,
   route-loss handling. The gate evidence is part of R9 (real
   full-duplex, per the v2 plan §30).

7. **Wired / USB headset behaviour**: no Bluetooth-style
   degradation. Capture + playback are reliable; the engine
   treats them as the default-equivalent route. The Stage A
   barge-in target (`p95 ≤ 150 ms` VAD-confirmed → audible mute)
   applies unchanged.

8. **Earbuds removal mid-utterance**: the engine detects the route
   change, mutes the mic, and emits `audio_route_changed`. The
   current utterance's `stt_final` is discarded (the user has
   stopped speaking into a working mic). The Live session
   continues if the user re-routes to another capture device
   within `EARBUDS_LOSS_GRACE_MS` (default 5 000 ms). After the
   grace period, the Live session is cancelled with
   `reason: route-loss`.

9. **Audio route changes that do not break Live**: switching
   between equivalent routes (speaker → wired headset while
   Live is active) emits `audio_route_changed` with
   `interrupted: false`. The session continues. The capture and
   playback handles are re-acquired; the lock-free ring buffer
   keeps its state.

10. **No implicit fallback**: a route change never silently falls
    back to cloud speech or to a different provider. The engine
    surfaces the change as an event; the UI can render it. If the
    new route cannot host the current provider (for example a
    Bluetooth HFP route that the local VAD cannot initialise on),
    the engine emits `voice_error` with `stage: "audio-input"`
    and the user is asked to re-route.

## Consequences

- The Android adapter adds `audio_route_changed` and route-loss
  handling to its existing audio focus surface.
- The desktop adapter documents Windows route changes
  (USB hotplug, default device change) and emits the same event.
- The R9 full-duplex gate records Bluetooth profile-specific
  evidence; the matrix above is updated as each profile
  qualifies.
- The contract test enforces that no route change silently
  falls back to a cloud provider.

## Open evidence requirements

- Each row in the matrix above must be measured and recorded
  before being marked PASS.
- Bluetooth profile gates (HFP / A2DP / LE Audio) each have
  their own recorded evidence package.
- Earbuds-removal grace period default (`5 000 ms`) is a
  parameter; the live measurement feeds the ADR amendment.

## Status

**DRAFT** — not adopted. The matrix is specified and the
behavioural policy is fixed. Adoption requires each row to be
recorded and each Bluetooth profile gate to be qualified.

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md) §6
- [ADR-061-voice-vad-strategy.md](ADR-061-voice-vad-strategy.md)
- [ADR-062-voice-tts-routing.md](ADR-062-voice-tts-routing.md)
- [ADR-065-voice-agent-authority-boundary.md](ADR-065-voice-agent-authority-boundary.md)
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)
- v2 plan §13, §16 (ADR campaign list), §30 (R9), §36 (edge
  cases)