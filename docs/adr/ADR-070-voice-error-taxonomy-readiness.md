<!-- SPDX-License-Identifier: MIT -->
# ADR-070: Voice Error Taxonomy and Readiness — staged errors, never "unknown" (2026-09-26)

> Companion to the ADR chain
> [ADR-058](../adr/ADR-058-voice-runtime.md) through
> [ADR-069](../adr/ADR-069-voice-audio-routes-bluetooth.md),
> and the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).

## Context

The v2 plan §16 requires an ADR titled "Error Taxonomy and
Readiness" replacing generic `unknown` errors with stage-tagged
errors. Stages:

```
audio input
audio output
permission
model missing
model download
integrity
model load
VAD
turn detection
STT
session
provider
LLM
tool
TTS
resource
thermal
network
unsupported capability
```

The plan also states: "Ready may only be displayed after required
providers for the selected profile are actually usable."

The current desktop `voice_host/live/agent.py` raises free-form
strings (`speech output unavailable: %s`, `voice live crashed`).
The Android TypeScript code uses typed codes like
`stt_unavailable`, `tts_unavailable`, `agent_unavailable`,
`binding_invalid`, `microphone_denied` (per
`packages/app/src/voice/live-controller.ts`), but the two
implementations are not aligned on a shared taxonomy.

This ADR freezes a single taxonomy used by both the desktop and
the Android paths through the shared `VoiceTurnEngine` (per
ADR-060).

## Decision

1. **`voice_error` event payload schema** is canonical:

   ```ts
   export type VoiceErrorStage =
     | "audio-input"
     | "audio-output"
     | "permission"
     | "model-missing"
     | "model-download"
     | "integrity"
     | "model-load"
     | "vad"
     | "turn-detection"
     | "stt"
     | "session"
     | "provider"
     | "llm"
     | "tool"
     | "tts"
     | "resource"
     | "thermal"
     | "network"
     | "unsupported-capability"
     | "abi"           // ADR-068 startup ABI diagnostic
     | "logging"       // ADR-067 secret redaction refused

   export interface VoiceErrorEvent {
     kind: "voice_error"
     sessionID?: string
     bindingID?: string          // pre-session correlation; opaque Live binding
     turnID?: string
     ts: number
     seq: number
     stage: VoiceErrorStage
     code: string                  // stable identifier, e.g. "TTS_UNHEALTHY"
     detail: string                // one-line human-readable, scrubbed
     recoverable: boolean
     cause_category: VoiceErrorCauseCategory
     provider_id?: ProviderId      // e.g. "pocket@3.1.0", "piper@2023.11.14"
     retry_after_ms?: number
   }
   ```

   Exactly one identity is required. Startup errors before an Unifia session
   exists use the already-issued Live binding ID; errors after binding use the
   canonical session ID. Clients accept a binding-scoped event only when its
   `bindingID` matches the active grant.

2. **No `unknown` stage**. Every `voice_error` event carries a
   `stage` drawn from the enumerated list. A bug that fails to
   classify falls back to `"unsupported-capability"` with
   `code: "UNCLASSIFIED_<file>:<line>"` so the bug is traceable
   to its source. The contract test enforces this rule.

3. **Codes** are stable, uppercase identifiers scoped to a stage:
   `AUDIO_INPUT_<...>`, `TTS_<...>`, etc. The current code inventory
   is documented in [ADR-070-voice-error-codes.md](ADR-070-voice-error-codes.md). A code is never
   removed without a deprecation cycle of one minor version.

4. **Readiness is a single boolean derived from the staged
   state**. `voice_ready` is emitted only when every provider
   required by the selected profile is loaded and usable:

   ```ts
   export interface VoiceReadyEvent {
     kind: "voice_ready"
     sessionID: string
     ts: number
     seq: number
     profile: "live"
   }
   ```

   The runtime may mirror the same validated envelope in participant
   attributes so a client joining after the reliable data packet can
   recover readiness. Both paths use the same sequence and session ID.

   | Profile | Required providers for `voice_ready` |
   |---|---|
   | Dictation | `vad`, `stt` |
   | Manual read-aloud | `tts` |
   | Live | `vad`, `turn-detection`, `stt`, `tts`, `agent-bridge` |
   | Voice + remote LLM | (Live profile) + `session` reachable |
   | Voice + local LLM | (Live profile) + `llm` reachable, model warm |

   A missing provider emits `voice_error` with the relevant
   stage and `code: "<STAGE>_UNAVAILABLE"`. The `voice_ready`
   event is the single source of truth; the UI never shows
   "Ready" before that event fires.

5. **Recoverable vs unrecoverable**. `recoverable: true` means the
   engine will retry with `retry_after_ms` backoff.
   `recoverable: false` means the engine has given up for the
   current session; the user must intervene (re-route, switch
   provider, re-install model). Recovery paths are documented
   per code.

6. **Codes never embed user content**. The `detail` field is
   scrubbed before emission: secrets are redacted, raw transcripts
   are replaced with length markers (`<transcript 142 chars>`),
   raw PCM is replaced with byte counts. ADR-067 governs.

7. **Provider fallback** is signalled separately. When the
   `TtsRouter` (ADR-062) falls back from Pocket to Piper, it
   emits `provider_fallback` with `from`, `to`, and
   `reason: <TTS code>`. The user sees a "switched voice" UI
   badge; the engine continues.

8. **Tool errors** propagate through `tool_started` and
   `tool_finished` events with `outcome: "denied"` or
   `"errored"`. The Voice component never short-circuits the
   tool; the existing Unifia permission/policy path stays
   authoritative per ADR-065.

9. **Mapping to existing free-form errors**:

   | Existing string | Stage | New code |
   |---|---|---|
   | `speech output unavailable: <X>` (desktop) | `tts` | `TTS_PROVIDER_ERROR` |
   | `voice live crashed` (desktop) | `unsupported-capability` | `UNCLASSIFIED_<file>:<line>` |
   | `stt_unavailable` (Android) | `stt` | `STT_UNAVAILABLE` |
   | `tts_unavailable` (Android) | `tts` | `TTS_UNAVAILABLE` |
   | `agent_unavailable` (Android) | `session` | `AGENT_UNAVAILABLE` |
   | `binding_invalid` (Android) | `provider` | `BINDING_INVALID` |
   | `microphone_denied` (Android) | `permission` | `MIC_PERMISSION_DENIED` |
   | `NotAllowedError` / `PermissionDeniedError` (Android) | `permission` | `MIC_PERMISSION_DENIED` |

   Each migration is recorded with the file and the new code.
   Legacy free-form strings are removed in the same change.

## Consequences

- A contract test enforces: every `voice_error` event has a
  `stage` from the enum; every code matches
  `<STAGE>_<...>`; `detail` is scrubbed.
- A startup ABI diagnostic (per ADR-068) surfaces
  `stage: "abi"` when the registry SHA-256 or runtime version
  is missing.
- The Android `live-controller.ts` typed codes map to the new
  taxonomy without breaking the existing UI (which already
  surfaces `LiveVoiceError` strings).
- The desktop Python free-form strings are replaced with
  `voice_error` events emitted through the `LivekitAgentTurnEngine`
  adapter.
- The voice-host pytest suite gains tests for every error stage
  and every code in the appendix.

## Open evidence requirements

- A complete `voice_error_codes.md` appendix listing every code,
  every stage, every retry policy.
- A contract test that fails if a `voice_error` event lacks a
  stage or has a stage not in the enum.
- A scrubber test that fails if the `detail` field contains
  raw transcripts, raw PCM, secrets, or any other content
  payload.
- A readiness test that fails if the `voice_ready` event fires
  before every required provider is loaded.

## Status

**DRAFT** — not adopted. The event carries stage, stable code,
recoverability, cause category, timestamp, optional provider identity,
and scrubbed detail across the Python-to-TypeScript LiveKit path.
Adoption requires every free-form error string in the desktop Python
code and the Android TypeScript code to be mapped, and the contract
tests above to be green. Selected LLM/provider health and Android/local
transport adoption are still open.

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md) §10
- [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md)
- [ADR-062-voice-tts-routing.md](ADR-062-voice-tts-routing.md)
- [ADR-065-voice-agent-authority-boundary.md](ADR-065-voice-agent-authority-boundary.md)
- [ADR-067-voice-privacy-logging-metrics.md](ADR-067-voice-privacy-logging-metrics.md)
- [ADR-068-voice-runtime-abi-onnx.md](ADR-068-voice-runtime-abi-onnx.md)
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)
- v2 plan §16 (ADR campaign list)
- `packages/voice-host/voice_host/live/agent.py` — legacy
  free-form errors
- `packages/app/src/voice/live-controller.ts` — existing typed
  error codes
