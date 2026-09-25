<!-- SPDX-License-Identifier: MIT -->
# ADR-058: Unifia voice runtime

> Renumbered from ADR-049 on 2026-09-25: new-ui already uses ADR-049 for the
> Code inspector tools. Commits before that date cite this decision as ADR-049.

**Date**: 2026-09-23, decided 2026-09-24 | **Status**: DECIDED

## Context

Unifia needs two voice workflows in the existing prompt — non-live dictation
and a continuous Live conversation — on desktop and mobile, local-first, with
speech on the CPU so the GPU stays with the local LLM, and without creating a
second agent runtime next to the Unifia session.

## Decision

1. **Kokoro is removed** from every runtime path; legacy settings migrate to
   `ttsProvider=auto` (`unifia-audio-settings.v2`).
2. **Pocket is the primary TTS** (managed Python 3.12 + uv, exact `uv.lock`,
   CPU wheels, quantized, 2 threads by default, one language loaded).
3. **Piper is the automatic fallback**, behind the same router, in its own
   GPL-3.0-or-later process and environment.
4. **Parakeet TDT 0.6B v3 int8 stays the STT** for dictation and Live (Live
   reuses the model files dictation downloads).
5. **The Voice Host is Python**: LiveKit Agents 1.8.3 and Pocket run in one
   process (`python -m voice_host.live`); Piper stays out of process.
6. **LiveKit is the transport**: self-hosted livekit-server 1.13.7 built from
   the official release, downloaded at first use and SHA-256 pinned (archive
   and executable), with per-start ephemeral credentials,
   loopback by default, one private LAN address only on explicit opt-in, no
   TCP ICE, no TURN, no public STUN, never LiveKit Cloud.
7. **Unifia is the only agent authority.** Voice turns go through
   `POST /session/:id/prompt_async` and the event stream of the existing
   session with the model/agent selected in the composer. LiveKit gets no
   tools, permissions, memory or project state.
8. **Mobile TTS is host-executed**: the phone joins the desktop Voice Host
   over WebRTC; it runs no Pocket/Piper for Live. Without a Voice Host, Live
   reports "Voice Host unavailable"; dictation keeps local Parakeet.
9. **Room credentials come from the Unifia server** the client already
   authenticates to (the pairing): short-lived single-room tokens, opaque
   room/identity/binding ids, secret kept on the desktop.
10. **CPU-first speech**: CUDA hidden in every speech process; thread budget by
    CPU profile (`eco`/`balanced`/`fast`).

Implementation, exposure rules, security, privacy and license details:
[voice-live.md](../voice-live.md).

## Alternatives rejected

- Node LiveKit Agents: Pocket is Python-native; one Python process avoids a
  localhost HTTP layer between agent and TTS.
- LiveKit function tools or a LiveKit-side LLM: would duplicate Unifia's tools
  and permission gate.
- Building livekit-server from its Go module and bundling it as a sidecar:
  adds a Go toolchain to every desktop build and installer size for a feature
  used on demand; the official release with pinned hashes gives the same
  integrity guarantee.
- LiveKit's default 3 s AEC warm-up: blocks early barge-in; 0.5 s is used.
- On-device Pocket/Piper on Android for this delivery (frozen out of scope;
  the `TtsBackend` contract allows it later).

## Consequences

- First Live use needs network access to GitHub releases (one download, then
  offline); a pin update is required to move to a new LiveKit version.
- `turn-detector-v1-mini` is covered by the LiveKit Model License. The product
  decision is to use it only through LiveKit Agents, never standalone or with
  another framework, and never to develop unrelated models from the model or
  its outputs. See the [upstream license](https://github.com/livekit/agents/blob/main/MODEL_LICENSE).
- The Voice Host holds Pocket in RAM while Live is used; it stops 5 minutes
  after the last conversation, and the manual Pocket worker is released while
  it runs.

## Evidence and open production gates

Automated evidence (unit, server, Rust config, and a real-transport integration
test with real LiveKit/VAD/turn detector) is listed in
[voice-live.md](../voice-live.md#tests-and-measurements). GO PROD still
requires evidence that cannot be produced in CI: desktop Live on the target
Windows machine with real Parakeet and Pocket (EN/FR/ES/IT/DE), Android Live
through the Voice Host, manual mobile read-aloud through an authenticated host
route, Pocket TTFA and interruption latency on target hardware, and the
local-LLM coexistence benchmark (tokens/s and VRAM with Live active).
