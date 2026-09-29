<!-- SPDX-License-Identifier: MIT -->
# ADR-073: Voice Capture and Playback Arbitration — explicit leases (2026-09-26)

> Companion to the ADR chain
> [ADR-058](../adr/ADR-058-voice-runtime.md) through
> [ADR-072](../adr/ADR-072-voice-offline-network-policy.md),
> and the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).

## Context

The v2 plan §16 requires an ADR titled "Capture and Playback
Arbitration" freezing the priority order:

```
Live
  >
manual read/preview
  >
autoplay
```

Mic dictation and Live cannot simultaneously own capture.
Explicit leases are required.

The desktop `voice_host/live/agent.py` already implements a
lease (the Live room reserves the mic for the session duration).
The Android `audio-capture-coordinator.ts` and
`audio-playback-coordinator.ts` implement capture and playback
leases separately. Neither path exposes a unified lease
contract; neither path records lease transitions as Voice
events.

## Decision

1. **Lease hierarchy** (canonical, single owner = the shared
   `VoiceTurnEngine` per ADR-060):

   ```
   priority(
     live:                3,
     manual_read_aloud:   2,
     preview:             2,    // same as manual_read_aloud
     autoplay:            1,
   )
   ```

   Mic capture and playback output each have their own lease
   stack. The two stacks do not interfere with each other: a
   high-priority capture lease never bumps a high-priority
   playback lease.

2. **Lease acquisition**:

   - A lease is requested via `requestLease(consumer,
     resource: "mic" | "playback")`.
   - The engine grants the lease if no higher-priority lease
     currently holds the resource. If a higher-priority lease
     holds it, the request fails with
     `voice_error.stage: "permission"` and
     `code: "LEASE_DENIED"`.
   - A same-priority lease request from a different consumer is
     a conflict; the new request fails with the same error.
   - A lease has a `ttl_ms` (default 5 000 ms). The owner must
     renew or release before TTL expires; an expired lease is
     released automatically and an
     `audio_route_changed` event is emitted with
     `reason: "lease-expired"`.

3. **Live always wins**:

   - When `Live` requests a mic lease while a `dictation`
     consumer holds the mic, the dictation consumer is bumped.
     The dictation consumer emits a `voice_error` with
     `stage: "audio-input"` and
     `code: "LEASE_BUMPED_BY_LIVE"`. The transcript being
     captured is preserved; the user can re-send it manually
     per the v2 plan §4.1 (the transcript MUST NOT auto-submit).
   - When `Live` requests a playback lease while `autoplay`
     holds the playback, autoplay is bumped. The autoplay
     consumer emits a `voice_error` with
     `stage: "audio-output"` and
     `code: "LEASE_BUMPED_BY_LIVE"`.

4. **Manual read-aloud vs Live**:

   - When the user invokes "read this response aloud" while
     `Live` is active, the manual read-aloud request is denied
     with `LEASE_DENIED`. The UI surfaces a clear message: "Live
     is active; stop Live to read aloud". A manual stop of
     Live is the only path forward. The existing manual read-
     aloud feature on desktop and the Android TTS preview
     surface this restriction.
   - When `Live` becomes active while manual read-aloud is
     playing, manual read-aloud is bumped per (3).

5. **Autoplay vs manual**:

   - When `autoplay` holds the playback and the user invokes
     manual read-aloud, autoplay is bumped. Manual read-aloud
     plays the requested response.
   - When manual read-aloud completes and autoplay was
     bumped, autoplay resumes from where it was interrupted.

6. **No lease for raw audio capture outside the engine**. Any
   Voice-adjacent component that wants to capture mic audio
   (e.g. a future ambient listening mode) MUST acquire a lease
   first. There is no implicit bypass.

7. **Lease visibility**:

   - Every lease acquisition, release, bump, and expiration
     emits an `audio_route_changed` event with the
     corresponding `reason`.
   - The UI shows the current lease owner at the top of the
     speech bar (Live / Dictation / Autoplay / Idle).

8. **Lease and provider_fallback are independent**. A provider
   fallback (per ADR-062) does NOT release leases. The new
   provider takes over the same lease.

9. **Lease persistence across app lifecycle**. A Live lease
   survives screen lock (Android) and app background
   transitions. The engine emits an event when the lifecycle
   transition affects the lease (e.g. backgrounded while Live
   is active — the lease is preserved; the UI is hidden).

10. **Resource pressure** (per ADR-072 and the v2 plan §32).
    Under memory pressure, leases are NOT revoked by the
    scheduler. The lease is independent of residency. The
    model under a Live lease may be evicted; the lease is held
    by the engine, not by the model.

## Consequences

- The desktop Python LiveKit path's existing lease is renamed
  from an implementation detail to the public
  `VoiceLease` interface. The contract test enforces the
  priority order.
- The Android adapter adds the same lease interface; the
  existing `audio-capture-coordinator.ts` and
  `audio-playback-coordinator.ts` are migrated to use it.
- A `lease` audit: any path that wants to capture or play
  audio without a lease is a bug. The audit is recorded per
  gate.

## Open evidence requirements

- A test that proves: a Live mic lease bumps a dictation
  consumer with the right `voice_error`.
- A test that proves: a manual read-aloud request is denied
  while Live is active, with the right `voice_error`.
- A test that proves: an autoplay lease is restored after
  manual read-aloud completes.
- A test that proves: a `provider_fallback` does NOT release
  the lease.
- A test that proves: a lease survives Android lifecycle
  transitions.

## Status

**DRAFT** — not adopted. The lease hierarchy and the
acquisition/release rules are specified. Adoption requires the
contract tests and the lease audit to be recorded.

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md) §6, §11
- [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md)
- [ADR-062-voice-tts-routing.md](ADR-062-voice-tts-routing.md)
- [ADR-064-voice-desktop-convergence.md](ADR-064-voice-desktop-convergence.md)
- [ADR-069-voice-audio-routes-bluetooth.md](ADR-069-voice-audio-routes-bluetooth.md)
- [ADR-070-voice-error-taxonomy-readiness.md](ADR-070-voice-error-taxonomy-readiness.md)
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)
- v2 plan §4 (target user flows), §16 (ADR campaign list)
- `packages/voice-host/voice_host/live/agent.py` — existing
  LiveKit lease
- `packages/app/src/voice/audio-capture-coordinator.ts` —
  Android capture lease
- `packages/app/src/voice/audio-playback-coordinator.ts` —
  Android playback lease