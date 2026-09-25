<!-- SPDX-License-Identifier: MIT -->
# ADR-067: Voice Privacy, Logging and Metrics — no content telemetry by default (2026-09-26)

> Companion to the ADR chain
> [ADR-058](../adr/ADR-058-voice-runtime.md) through
> [ADR-066](../adr/ADR-066-voice-model-artifact-registry.md),
> and the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).

## Context

The v2 plan §16 requires an ADR titled "Privacy, Logging and
Metrics" freezing the default behaviour of Voice telemetry:

- no raw audio retention
- no transcript content telemetry
- no secret logging
- no voice embedding telemetry

Metrics should use timings, sizes, counts, provider IDs, error codes,
and resource measurements. Content capture requires explicit debug
mode.

This ADR sits between ADR-066 (Model Artifact Registry — what we
**persist**) and ADR-068 (Runtime ABI / ONNX Ownership — how we
**load** it). It fixes what we **emit**.

This is also directly relevant to a hard rule Erwan enforces across
all sessions: secrets, OAuth tokens, refresh tokens, API keys,
client secrets, or any other secret material must never appear in
clear in vault / memory / log files. The Voice pipeline is
particularly sensitive because the entire content flow
(`stt_partial` → `stt_final` → `assistant_text_delta` →
`speech_segment_ready` → `tts_audio`) is content-bearing by nature.

## Decision

1. **Default: no content telemetry.** Voice components never log
   raw audio, transcript content, assistant text, or voice
   embeddings. They log:

   - **Timings**: monotonic sequence numbers, timestamps,
     `tts_first_audio`, `stt_partial_latency_ms`, `stt_final_latency_ms`,
     `turn_commit_ms`, `agent_thinking_ms`, barge-in stage A and B
     numbers (recorded separately per the v2 plan §13).
   - **Sizes**: PCM chunk byte counts, model file sizes, ring-buffer
     occupancy, RSS / PSS where available.
   - **Counts**: number of partials, number of retractions, number
     of tool events, number of permission requests, number of
     barge-ins per session.
   - **Provider IDs**: the resolved TTS/STT/VAD/turn-detector
     names (e.g. `pocket@3.1.0`, `parakeet-tdt-0.6b-v3-int8`,
     `silero-vad-v6.2.2`, `smart-turn-v3.2`). Provider IDs are
     not secrets.
   - **Error codes**: the canonical error taxonomy stages (per
     ADR-068) plus the error code and a one-line, scrubbed detail.
   - **Resource measurements**: CPU%, GPU VRAM (desktop only, never
     intentional Voice allocation per ADR-058 §15), RAM, NPU
     capability flag, thermal class.

2. **Voice components never log content payloads by default**.
   Specifically:

   - `stt_partial.text`
   - `stt_final.text`
   - `assistant_text_delta.delta`
   - `speech_segment_ready.text`
   - `tts_audio.pcm`

   The presence of these fields in log output is a code-review
   violation. The contract test enforces this rule.

3. **SpeechRenderer** (per ADR-058 §14 and the v2 plan §14) suppresses
   or summarises content unsafe or useless to vocalize. The
   suppressed categories are not logged at any verbosity. If the
   SpeechRenderer decides to summarise a 200-line stack trace
   instead of speaking it, neither the original stack trace nor
   the summary is logged by default.

4. **Voice embedding telemetry is forbidden.** Voice never
   persists embeddings, never sends embeddings to a remote service,
   never uses embeddings to drive routing decisions outside the
   local process.

5. **Vault / memory / log file rule**: secrets, OAuth tokens,
   refresh tokens, API keys, client secrets, MFA responses,
   session cookies, and any other secret material are redacted
   immediately. The redaction format is `[REDACTED — <type>]` plus
   a K-XXX link when the secret is referenced elsewhere. Voice
   components do not write to vault files; if a Voice error log
   path ever attempts to write a secret, the writer refuses and
   raises a `voice_error` with `stage: "logging"`.

6. **Debug / test mode**: a Voice startup flag `--voice-debug` (or
   the equivalent settings toggle) enables content capture for
   that session. The flag is recorded in `voice_error` events so
   the gate evidence can trace which sessions had content
   capture on. The default is **off**. There is no implicit
   "test" or "dev" mode that flips this on automatically.

7. **RT-thread ring buffer** (per the v2 plan §45 future-proofing
   + the audio thread safety contract from `audio-validate`):
   RT threads never log content. The RT thread pushes
   `(EventId, monotonic_ts, value)` to a lock-free ring buffer; a
   low-priority thread drains to log/UI. No string formatting, no
   PCM data, no transcript data leaves the RT thread.

8. **Metrics per ADR-066**: the model artifact registry records
   metadata only — provider, model ID, version, upstream revision,
   SHA-256, size, licence, languages, architecture, quantization,
   source, minimum runtime, compatibility. The registry never
   records downloaded test corpora (those live in
   `tests/voice/fixtures/` and are scrubbed of any user content).

9. **Telemetry opt-in**: users can opt-in to a separate "Voice
   metrics" channel that emits the timing/size/count/provider/error
   metrics to a local sink. Opt-in is a per-user toggle, recorded
   in the agent settings, and is the only path that emits Voice
   metrics to disk. There is no implicit on-by-default metrics
   sink.

10. **Telemetry sink hygiene**: even when the user opts in, the
    sink never receives raw audio or transcript content. The
    sink receives the structured metrics from (1). The sink is
    the local file system or an Unifia-managed local log; it is
    never a third-party service unless the user explicitly
    configures one.

## Consequences

- A contract test enforces (2): every Voice component is forbidden
  from logging content payloads. The test asserts the absence of
  forbidden log paths by source-code grep on the `packages/voice`
  and `packages/voice-host` directories.
- The startup flag `--voice-debug` (or settings toggle) is the
  only way to enable content capture. The default remains off.
- The RT-thread ring buffer drains to a low-priority thread that
  applies the (1) metric set; no content passes through it.
- The voice-host pytest suite gains tests proving that secrets
  are not spoken by `SpeechRenderer` (per the v2 plan §14
  requirement: "Add tests proving that secrets are not spoken").
- The Voice tests gain an assertion that the default log
  verbosity never emits `stt_partial.text` /
  `assistant_text_delta.delta` / `tts_audio.pcm` /
  `speech_segment_ready.text`.

## Open evidence requirements

- Contract test green against the current `live-controller.ts`,
  `voice_host.live`, and any new shared `VoiceTurnEngine` code.
- SpeechRenderer secret-vocalization tests passing for the
  canonical examples (API key, OAuth token, refresh token,
  client secret, password, raw JSON, large code block, diff,
  stack trace, hash, large table, file dump, raw log, long URL,
  binary-looking data).
- Default-log audit: no forbidden payload path is present in
  the Voice source tree.
- RT-thread ring buffer proof: a stress test asserts that no
  content is logged under sustained 30-minute load.

## Status

**DRAFT** — not adopted. The rule set is specified. Adoption
requires the contract test and the SpeechRenderer tests to be
recorded and green.

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md) §14
- [ADR-065-voice-agent-authority-boundary.md](ADR-065-voice-agent-authority-boundary.md)
- [ADR-066-voice-model-artifact-registry.md](ADR-066-voice-model-artifact-registry.md)
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)
- v2 plan §14 (Speech Rendering Security), §16 (ADR campaign list)
- `audio-validate` skill — audio thread safety contract for RT
  threads (no logging, no mutex, no I/O, no allocation)