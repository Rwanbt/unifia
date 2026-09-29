<!-- SPDX-License-Identifier: MIT -->
# Unifia Voice v2 — Troubleshooting Guide

> Companion to `docs/voice-production-runbook.md`. Audience: on-call
> engineer. Updated 2026-09-26.

This guide covers the **observable** symptoms + recovery actions
for the v2 architecture. It does not replace the canonical
`KNOWN_FAILURE_PATTERNS.md` (deeper project-wide trap doc) or the
`TECHNICAL-DEBT.md` (known slow burns).

## 0. Diagnostic primitives

Before anything else, capture the scheduler diagnostics:

```python
rs = shared_resources(None).voice_resource_scheduler
print(rs.diagnostics())
# expected: { "mode": "desktop", "voice_gpu_alloc_bytes": 0,
#             "gpu_owned_by": "local-llm", "thermal": "<status>",
#             "memory": "<nominal|moderate|critical|low_memory>",
#             "platform_connected": true|false }
```

Then check evictions since process start:

```python
captured = []
rs.on_evention(lambda e: captured.append(e))
# drive a turn, then check `captured` for the recent EvictionEvent stream
```

For Android, `await invoke('voice_scheduler_diagnostics')` returns the
same shape over Tauri's IPC bridge.

## 1. Worker exits on startup

### Symptom

```
Traceback (most recent call last):
  File ".../live/agent.py", line 33, in build_resources
KeyError: 'LIVEKIT_URL'
```

or any of: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`UNIFIA_SERVER_URL`, `UNIFIA_SERVER_PASSWORD`.

### Cause

`voice-host.live.config.LiveConfig.from_env()` raises `RuntimeError
("Live Voice Host is missing configuration: ...")` if any of the five
required env vars is empty.

### Fix

```bash
export LIVEKIT_URL="wss://voice.example.com"
export LIVEKIT_API_KEY="APIkeyValue"
export LIVEKIT_API_SECRET="APISecretValue"
export UNIFIA_SERVER_URL="https://unifia.example.com"
export UNIFIA_SERVER_PASSWORD="<rotate-secret-in-vault>"
export UNIFIA_SERVER_USERNAME="${UNIFIA_SERVER_USERNAME:-unifia}"
```

Re-run the worker. Confirm `python -m voice_host.live check` returns exit 0 BEFORE starting the long-lived process.

## 2. `STT_ERROR: parakeet model is not installed`

### Symptom

Workers boot without crashing. First `transcribe_request` produces a
`stt_error` with code `STT_MODEL_LOAD_FAILED`.

### Cause

`UNIFIA_PARAKEET_DIR` either unset, or pointing at a path that does
not contain `encoder-model.int8.onnx` + `vocab.txt`. The
`voice_host.live.stt.load_parakeet` import is gated on `parakeet_ready`
checking for these files.

### Fix

```bash
ls "$UNIFIA_PARAKEET_DIR/encoder-model.int8.onnx" "$UNIFIA_PARAKEET_DIR/vocab.txt"
```

If absent, restore from the model registry. See
`docs/voice-model-update-procedure.md` §3.

## 3. TTS emits silence or wrong voice

### Symptom

The TtsRouter yields audio chunks but the consumer reports the stream
is empty / wrong voice / wrong language.

### Cause candidates

1. **Wrong provider selected**: `UNIFIA_TTS_PROVIDER=auto` picks the
   first available backend. If Pocket weights are missing on disk,
   the router falls back to Piper subprocess (desktop) or
   `fallback-android-tts` (Android). Either or both may be silent if
   the subprocess fails to spawn.
2. **Language not covered**: TTS router rejects
   `TTS_LANGUAGE_UNSUPPORTED` for languages outside EN/FR/ES/IT/DE.
3. **Voice clone conditioning corrupted**: Pillow / wav corruption.

### Fix

```python
# Inspect the router selection
from voice_host.live.tts import TtsRouter
print(router.available_providers())          # shows which backends loaded OK
print(router.diagnostics_for('pocket'))        # includes weights path + SHA
```

If a Piper fallback is in play and the user expects Pocket, fix
`packages/voice-host/models/registry.json` and re-download Pocket
weights via the model-update procedure.

## 4. `voice_error stage=audio-input code=LEASE_BUMPED_BY_LIVE`

### Symptom

While dictation is active, a Live button press preempts; the dictation
session gets a `voice_error` with this code, AND the transcript so far
is preserved for manual send (NOT auto-submitted).

### Cause

ADR-073 (Capture & Playback Arbitration). Live priority > manual
dictation; bumping is the documented behaviour, not a bug.

### Fix

This is correct behaviour. The transcript bytes are preserved in the
composer where the user can review + edit before manually sending.
Verify the composer is not auto-submitting (data-action `prompt-stt-toggle`
should NOT trigger send; check `composer.ts`).

## 5. Microphone permission revoked mid-session

### Symptom

`voice_error stage=audio-input code=PERMISSION_DENIED`. Session
recovers into `error` state.

### Cause

User revoked mic permission at OS level (Android Privacy / Windows
Settings).

### Fix

Re-request permission via the existing settings flow. Session
recovery is documented in ADR for `Session Recovery`; the worker
will re-attach STT/LLM/TTS once mic is granted again. If the worker
fails to recover:

```bash
# Restart voice-host worker; do NOT touch registry.json or models.
systemctl restart voice-host  # or your equivalent
```

## 6. STT partials not arriving

### Symptom

`SttPartial` events stop showing in the LiveKit room; only `SttFinal`
appears (or nothing at all).

### Cause candidates

1. **Streaming STT provider fallback**: the production streaming STT
   contract has 4 backend slots; one of them is the mock used in
   tests. Real backends (Nemotron 3.5 / Moonshine) are hardware-
   blocked (R5 bake-off pending). On hardware-unavailable builds the
   consumer may see only mock behaviour or block.
2. **Provider timeout**: `STREAM_INFERENCE_TIMEOUT` (5xx in
   `voice-error` taxonomy).
3. **Buffer overflow**: ring buffer overflows under load.

### Fix

```python
# Inspect last 100 evictions
rs = shared_resources(None).voice_resource_scheduler
evictions = rs.list()  # this sweeps expired leases too
```

## 7. TTS mid-stream error: `TTS_PROVIDER_OFFLINE`

### Symptom

TtsRouter yields one `TtsProviderError` chunk then exits.

### Cause

The active backend (typically Pocket on desktop) crashed mid-stream.
Per ADR-062, the router yields the error to the consumer and stops;
the next utterance will trigger a fresh prepare() → possible fallback.

### Fix

1. Check worker logs for the provider's exception traceback.
2. Re-prepare the model (`voice_host.live.tts.<PocketBackend>.prepare`).
3. If the provider cannot recover, swap to Piper subprocess via
   `UNIFIA_TTS_PROVIDER=piper`.

## 8. Thermal throttling on Android

### Symptom

Mobile `voice_scheduler_diagnostics` shows `thermal: critical` or
above. PRELOAD / IDLE-EVICT leases disappear from the consumer.

### Cause

ADR-074 §6: thermal Critical/Emergency triggers
`PressureState::ThermalCritical` which evicts preload + idle-evict.
Keep-warm realtime-audio + VAD survive.

### Fix

Verify hardware (sun exposure, fast charging, hot environment) is not
the cause. If persistent, lower CPU profile via OS settings. Software
has already done its job: heavy models have been evicted, realtime
audio is unchanged.

## 9. Memory pressure: not enough for STT model

### Symptom

`memory: critical` or `low_memory` in diagnostics; STT model evict
attempts repeatedly fail.

### Cause

Local LLM + STT + TTS models collectively exceed RAM budget. ADR-074
§6 policy: preempt idle STT before TTS to keep voice runtime
responsive.

### Fix

1. Verify desktop is not in `UNIFIA_LOCAL_LLM_OWNS_GPU=false` mode
   while a local LLM is actually running — that's a misconfiguration.
2. Lower `UNIFIA_VOICE_CPU_PROFILE` to `eco`.
3. Verify model registry SHA matches on-disk models; a corrupt
   model that re-downloads triggers spikes.

## 10. Missing keys / API OAuth errors

See `docs/voice-model-update-procedure.md` §6 (registry artefacts
with `redistributable: false` carry keys in `[REDACTED — <type>]`
form per the canonical redaction rule). Voice does **not** store
credentials; missing keys mean the registry artefact is corrupt or
the local file was deleted.

## 11. LiveKit server unreachable

### Symptom

`Failed to connect to LiveKit <url>` in worker logs. Worker exits.

### Fix

```bash
# Confirm reachability OUTSIDE voice-host:
curl -kv "$LIVEKIT_URL" 2>&1 | head -20

# If reachable, check API key/secret pair with livekit-cli:
livekit-cli token create --api-key $LIVEKIT_API_KEY --api-secret $LIVEKIT_API_SECRET \
    --room test --identity test
```

If the API key/secret pair fails, rotate via the LiveKit server admin UI.

## 12. Voice events stop firing without errors

### Symptom

`SttPartial` / `AssistantTextDelta` / `TtsAudio` all stop appearing but
the process is alive.

### Cause candidates

1. **LiveKit participant evicted**: the room shut down (admin action,
   token expiry). Look for `participant disconnected` in worker logs.
2. **AgentBridge backpressure**: assistant.max_tokens / context-budget
   throttling — Unity `voice_runtime.live.bridge` will queue events
   and may drop on overflow.

### Fix

```python
bridge.diagnostics()
# Look for "queue_size" + "drop_count"; if drop_count > 0, lower the
# UNIFIA_VOICE_CPU_PROFILE so the LLM does not outpace the renderer.
```

## 13. Test regressions

### Symptom

`bun test src/voice/` or `python scripts/voice/voice-host-test-runner.py --full` reports a failure after a code change.

### Fix

1. Bisect: `git bisect start && git bisect run bash -c 'cd packages/app && bun test src/voice 2>&1 | tail -5'`.
2. If only `pocket_tts.models.model_state` collection errors appear in `tests/test_live_stt.py` + `tests/test_voice_state.py`, that's the pre-existing venv gap (documented in `Session-Recap` final report). Not a regression.

## 14. When all else fails: rollback

`docs/voice-rollback-procedure.md`.

## 15. Capture for upstream diagnosis

Before opening an incident, collect:

- The `diagnostics()` snapshot.
- Last 100 evictions from the scheduler.
- Worker log snapshot (last ~2000 lines, around the failure time).
- LiveKit room + participant history (server-side).
- Commit SHA + APK/installer SHA where applicable.

This matches the **plan §41 evidence format**. Even when not at GO
PROD, every failure record should follow it.
