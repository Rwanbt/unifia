<!-- SPDX-License-Identifier: MIT -->
# ADR-065: Voice Agent Authority Boundary — Voice is I/O, Unifia session is sole authority (2026-09-26)

> Companion to
> [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md),
> [ADR-059-voice-portable-pocket-runtime.md](ADR-059-voice-portable-pocket-runtime.md),
> [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md),
> [ADR-061-voice-vad-strategy.md](ADR-061-voice-vad-strategy.md),
> [ADR-062-voice-tts-routing.md](ADR-062-voice-tts-routing.md),
> [ADR-063-voice-fast-decision.md](ADR-063-voice-fast-decision.md),
> [ADR-064-voice-desktop-convergence.md](ADR-064-voice-desktop-convergence.md),
> and the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).

## Context

The v2 plan §16 requires the ADR titled "Agent Authority Boundary"
freezing Voice as an I/O subsystem and never a second agent. The plan
already records the canonical flow:

```
User
  ↓
Voice
  ↓
Unifia session
  ↓
selected provider/model
  ↓
existing agent loop
  ↓
tools / permissions / memory / project state
  ↓
response events
  ↓
Voice output
```

ADR-058 §3.1 repeats the rule but does not formalize it. This ADR
pins the boundary so it cannot be quietly crossed in a future patch.

## Decision

1. **Voice is an I/O subsystem.** It owns:

   - Microphone capture (the audio plane).
   - Playback output (the audio plane).
   - Voice Activity Detection.
   - End-of-turn detection.
   - Speech-to-text (STT).
   - Text-to-speech (TTS).
   - Speech rendering (markdown / code / secrets filtering).
   - Speech segmentation.
   - Barge-in (Stage A: acoustic reflex; Stage B: semantic decision).
   - Voice-only events (VAD probability, TTS PCM chunks, route
     changes, provider fallback, resource pressure).

2. **Voice MUST NOT independently own**:

   - Filesystem actions.
   - Shell / process execution.
   - Git operations.
   - Browser control.
   - MCP servers.
   - Secrets.
   - Project state.
   - Memory authority.
   - Permission decisions.
   - Tool execution.
   - Model selection (the selected provider/model is owned by the
     Unifia session).

   Each of these is owned by the existing agent loop inside the
   Unifia session. Voice emits input, proposals, and events; the
   Unifia session interprets and decides.

3. **FastDecision is non-privileged.** Per ADR-063, the
   FastDecision provider may:

   - Cancel TTS playback (Stage A barge-in).
   - Propose barge-in timing.
   - Suggest utterance intent (acknowledge / wait / cancel-speech /
     correction / permission-answer / noise) so the UI can render a
     localised state.

   The FastDecision provider may NOT:

   - Cancel a running tool operation.
   - Modify the agent's plan.
   - Change model or provider.
   - Touch secrets, files, Git, browser, MCP, memory, or project
     state.
   - Override Unifia permissions.

4. **Stage A vs Stage B barge-in**:

   - Stage A is the acoustic reflex. Triggered from VAD-confirmed
     speech start. Performs a non-privileged effect (mute TTS
     playback). Does NOT cancel the running agent work.
   - Stage B is the semantic decision. Triggered after
     `stt_final`. The decision is communicated to the Unifia
     session through the AgentBridge. The session decides whether
     to treat the new utterance as a correction, a new request, an
     acknowledgement, a resume, a permission answer, a cancel, or
     noise. The session may then invoke the existing
     permission/policy path; it never grants itself authority.

5. **VAD and turn detector are sensors, not actors.** They emit
   `vad_probability`, `speech_started`, `speech_ended`,
   `turn_incomplete`, `turn_complete`. They do NOT cancel
   privileged tool operations.

6. **TTS cancel vs Agent cancel**: cancelling speech is not
   cancelling agent work. The shared `VoiceTurnEngine` exposes
   `cancelSpeech()` (TTS playback stops, agent run continues) and
   `cancelAgent()` (TTS playback stops AND the Unifia session is
   asked to cancel the run through the canonical permission/policy
   path). `cancelAgent()` is gated by the session's authority —
   Voice cannot invoke it unilaterally; the session must accept
   the cancel request through the same code path that would cancel
   any other long-running work.

7. **Telemetry / privacy** (per the v2 plan ADR on Privacy,
   Logging and Metrics — to be drafted in ADR-067):

   - Default: no raw audio retention, no transcript content
     telemetry, no secret logging, no voice embedding telemetry.
   - Voice components never log `assistant_text_delta`,
     `stt_partial`, `stt_final`, `speech_segment_ready`, `tts_audio`
     content by default.
   - Content capture requires explicit debug/test mode at startup.

## Consequences

- Voice cannot call `Tool.run`, `Browser.act`, `Mcp.invoke`,
  `Git.commit`, `Memory.write`, `Permission.grant`,
  `Permission.deny`, `Project.write`, or `Secret.read`. Any code
  path that tries to do so fails the contract test.
- The contract test enforces the boundary. A new test asserts:
  Voice components cannot reach Unifia tools, cannot reach memory
  authority, cannot reach permission authority, cannot reach the
  filesystem authority. The test runs in CI.
- A new agent runtime is forbidden. Voice does not spawn an agent
  loop, does not plan, does not call tools.
- Voice never becomes a hidden prompt. The system prompt used for
  any LLM call is owned by the Unifia session; Voice only forwards
  user input through the session.

## Open evidence requirements

- A contract test that fails if Voice attempts any privileged call
  through the Unifia session boundary.
- An audit of every `import` in `packages/app/src/voice/` and
  `packages/voice-host/voice_host/live/` to confirm no path imports
  `Tool`, `Browser`, `Mcp`, `Git`, `Memory`, `Project`, or
  `Secret` modules.
- An audit of every event Voice emits to confirm no event payload
  contains privileged data (tool ids that bypass permission,
  memory references, etc.).

## Status

**DRAFT** — not adopted. The boundary is specified. Adoption
requires the contract test and the import audit to be recorded.

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md) §3.1
- [ADR-059-voice-portable-pocket-runtime.md](ADR-059-voice-portable-pocket-runtime.md)
- [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md)
- [ADR-061-voice-vad-strategy.md](ADR-061-voice-vad-strategy.md)
- [ADR-062-voice-tts-routing.md](ADR-062-voice-tts-routing.md)
- [ADR-063-voice-fast-decision.md](ADR-063-voice-fast-decision.md)
- [ADR-064-voice-desktop-convergence.md](ADR-064-voice-desktop-convergence.md)
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)
- v2 plan §3.1, §12, §13, §14, §31