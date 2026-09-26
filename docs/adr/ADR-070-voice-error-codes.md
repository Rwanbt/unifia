<!-- SPDX-License-Identifier: MIT -->
# ADR-070 Voice Error Code Inventory

This appendix is the initial stable code inventory for the `voice_error`
envelope defined by [ADR-070](ADR-070-voice-error-taxonomy-readiness.md).
Wire events carry `stage`, `code`, `recoverable`, `cause_category`, `ts`,
scrubbed `detail`, and an optional validated `provider_id`.

| Stage | Code | Recoverable | Cause category |
|---|---|---:|---|
| audio-input | `AUDIO_INPUT_UNAVAILABLE` | yes | device |
| audio-output | `AUDIO_OUTPUT_UNAVAILABLE` | yes | device |
| permission | `PERMISSION_MICROPHONE_DENIED` | no | permission |
| model-missing | `MODEL_MISSING_REQUIRED` | no | availability |
| model-download | `MODEL_DOWNLOAD_FAILED` | yes | network |
| integrity | `INTEGRITY_VERIFICATION_FAILED` | no | provider |
| model-load | `MODEL_LOAD_FAILED` | no | provider |
| vad | `VAD_PROVIDER_UNAVAILABLE` | no | availability |
| turn-detection | `TURN_DETECTION_UNAVAILABLE` | no | availability |
| stt | `STT_PROVIDER_UNAVAILABLE` | no | availability |
| session | `SESSION_AGENT_ERROR` | no | session |
| session | `SESSION_AGENT_UNAVAILABLE` | no | session |
| provider | `PROVIDER_VOICE_HOST_UNAVAILABLE` | yes | availability |
| provider | `PROVIDER_LAN_ACCESS_DISABLED` | no | provider |
| provider | `PROVIDER_BINDING_INVALID` | no | provider |
| llm | `LLM_UNAVAILABLE` | yes | availability |
| tool | `TOOL_EXECUTION_FAILED` | yes | session |
| tts | `TTS_PROVIDER_UNAVAILABLE` | no | availability |
| resource | `RESOURCE_PRESSURE` | yes | availability |
| thermal | `THERMAL_LIMIT` | yes | device |
| network | `NETWORK_CONNECTION_LOST` | yes | network |
| network | `NETWORK_RATE_LIMITED` | yes | network |
| unsupported-capability | `UNSUPPORTED_CAPABILITY_UNCLASSIFIED_RUNTIME_ERROR` | no | programmer |
| abi | `ABI_UNSUPPORTED` | no | provider |
| logging | `LOGGING_FAILURE` | yes | availability |

Legacy client codes `PERMISSION_MICROPHONE_DENIED`, `AUDIO_INPUT_UNAVAILABLE`,
`STT_PROVIDER_UNAVAILABLE`, `TTS_PROVIDER_UNAVAILABLE`,
`SESSION_AGENT_UNAVAILABLE`, `PROVIDER_BINDING_INVALID`,
`NETWORK_CONNECTION_LOST`, `NETWORK_RATE_LIMITED`, and
`UNSUPPORTED_CAPABILITY_UNCLASSIFIED_RUNTIME_ERROR` remain in the same
inventory; they are represented by the corresponding stage rows above.

The Python LiveKit encoder and TypeScript contract each reject unknown code
and stage combinations. This inventory does not claim that every listed code
has a production emitter or a qualified recovery path yet. Do not mark ADR-070
adopted until error producers across desktop, Android and local transport use
these envelopes and recovery behavior is verified.
