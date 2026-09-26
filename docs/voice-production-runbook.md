<!-- SPDX-License-Identifier: MIT -->
# Unifia Voice v2 — Production Runbook

> Companion to the UNIFIA Voice v2.1 autonomous production implementation
> campaign. Audience: on-call engineer + production SRE. Updated 2026-09-26
> to match the v2 architecture (R8 TtsRouter, R11 tri-runtime scheduler,
> R13 desktop wiring, R13.2 PlatformSignals).

## 1. What runs where

| Runtime | Process / binary | Path | Sources from |
|---|---|---|---|
| Desktop voice-host | `voice_host.live.agent` (Python, LiveKit worker) | `packages/voice-host/voice_host/live/agent.py` | Pocket TTS 3.1.0 + Parakeet TDT v3 + Silero VAD v6.2.2 ONNX |
| Desktop voice-host | `voice_host.worker.PocketWorker` (Python, daemon) | `packages/voice-host/voice_host/worker.py` | Live in `voice_host.worker`, runs as long-lived Python process |
| Android voice runtime | `unifia_mobile_lib::voice::resource_scheduler` (Rust) | `packages/mobile/src-tauri/src/voice/` | Tauri 2.0 mobile shell, fires only when the app is foregrounded |
| Desktop LLM (separate process) | local LLM daemon | outside this repo | allocates discrete GPU first (Voice GPU = 0 by default, ADR-074 §4) |

Everything from §3 below applies to the desktop voice-host first.
The Android runtime is bound by the same contracts (`@unifia/contracts/*`,
`packages/voice-host/models/registry.json`); it consumes the same
`VoiceResourceScheduler` semantically. Hardware configuration
differences are called out in §6.

## 2. Environment variables

| Var | Default | Required? | Meaning |
|---|---|---|---|
| `LIVEKIT_URL` | (none) | **yes** | LiveKit server URL (e.g. `wss://voice.example.com`) |
| `LIVEKIT_API_KEY` | (none) | **yes** | API key issued by LiveKit server |
| `LIVEKIT_API_SECRET` | (none) | **yes** | API secret issued by LiveKit server |
| `UNIFIA_SERVER_URL` | (none) | **yes** | Control-plane Unifia server URL (e.g. `https://unifia.example.com`) |
| `UNIFIA_SERVER_PASSWORD` | (none) | **yes** | Bearer token for the control plane |
| `UNIFIA_SERVER_USERNAME` | `unifia` | no | Server username for basic auth fallback |
| `UNIFIA_PARAKEET_DIR` | (none) | conditional | Path to `encoder-model.int8.onnx` + `vocab.txt`. Required if STT = Parakeet. |
| `UNIFIA_PIPER_PROJECT` | (none) | conditional | Path to piper-project source. Required if desktop fallback = Piper. |
| `UNIFIA_PIPER_ASSET_DIR` | (none) | conditional | Path to piper ONNX voices. Required for Piper fallback. |
| `UNIFIA_TTS_PROVIDER` | `auto` | no | `auto` / `pocket` / `piper` — preferred TTS backend |
| `UNIFIA_VOICE_CPU_PROFILE` | `balanced` | no | OMP thread plan: `eco` / `balanced` / `performance` |
| `UNIFIA_LOCAL_LLM_OWNS_GPU` | `true` | no | `true` → desktop scheduler refuses to allocate Voice VRAM (ADR-074 §4); set false if Voice is the only GPU owner |
| `UNIFIA_VOICE_PLATFORM_SIGNALS` | (unset) | no | Set to `mock` to inject `MockDesktopSignals` (deterministic pressure readings) — useful for CI without psutil |

Do **not** set `UNIFIA_TTS_PROVIDER=cloud-*` or similar — there is no
silent-cloud-fallback path (ADR-062). The fallback chain is `pocket →
piper → fallback-android-tts` and terminates with a `TtsProviderError`.

## 3. Start / stop / restart

### Boot order

1. **Local LLM** (if co-located) — bind GPU first. Voice GU refuses to allocate VRAM on this profile.
2. **Unifia server** (control plane) — must already be reachable.
3. **Voice Host worker** — `python -m voice_host.live serve --config <config.json>`.
4. **LiveKit server** — separate concern, must already be reachable; voice-host connects outbound.
5. *(optional)* **Android clients** — start the Tauri mobile app; it dials LiveKit per user request.

### Start (foreground, dev)

```bash
cd packages/voice-host
UNIFIA_PARAKEET_DIR=$PWD/models/parakeet-tdt-v3-int8 \
UNIFIA_TTS_PROVIDER=auto \
UNIFIA_VOICE_CPU_PROFILE=balanced \
python -m voice_host.live serve
```

### Start (managed)

The `scripts/voice/run-packaged-qualification.ps1` PowerShell entry
covers production-style orchestration. For Linux deployments the
equivalent is the `voice-host-test-runner.py`-style uv-managed venv
plus a systemd unit (not shipped today; see §8 follow-ups).

### Stop

The voice-host traps SIGINT and exits cleanly. `kill <pid>` is fine;
the worker releases all open leases on the ResourceScheduler before
exit (verified by `test_live_text.py` shutdown hook).

### Restart

A restart is identical to a start. Resource leases are in-memory only;
they evaporate on process exit. Active LiveKit rooms are reconnected
by the LiveKit server itself; the worker re-enters each room on
`start()` and the half-turn recovery path (R6) handles re-connect
without duplicate-turn submission.

## 4. Health checks

The voice-host does not currently expose HTTP `/healthz` (architecture
intent: in-process scheduler diagnostics are sufficient). Use one of:

### From the controlling process

```python
from voice_host.live.agent import shared_resources
rs = shared_resources(None)
print(rs.voice_resource_scheduler.diagnostics())
```

Expected output on healthy startup:

```python
{
    "mode": "desktop",
    "voice_gpu_alloc_bytes": 0,
    "gpu_owned_by": "local-llm",
    "thermal": "none",
    "memory": "nominal",
    "platform_connected": True,   # psutil present
}
```

### From outside the process

```bash
ps -ef | grep voice_host.live
# Look for: the worker should be alive, OMP_NUM_THREADS env honored,
# CPU% modest (<10 % when idle), RSS modest (<1 GB desktop idle).
```

### LiveKit server-side

`livekit-cli room list --url $LIVEKIT_URL --api-key ... --api-secret ...`
— voice workers register as room participants; the count should match
expected active rooms.

## 5. Logging conventions

- Logger name: `voice_host.<module>` (e.g. `voice_host.resource_scheduler`).
- Default level: `INFO` in production, `DEBUG` in dev (set via `LOG_LEVEL=DEBUG`).
- Stage events emitted at INFO with structured `extra={ stage, duration_ms, ... }`.
- RT threads (audio capture/playback) DO NOT log directly; they push to a lock-free ring buffer (ADR-067). Consumers log from a low-priority thread.

No content is ever logged by default: no transcripts, no audio. To
enable verbose logging for a debug session, set `--voice-debug` /
`VOICE_DEBUG=1`. Even with debug on, secrets are redacted before
they reach the logger (ADR-067).

## 6. Android-specific

The Android voice runtime ships inside the mobile Tauri shell. It
imports:
- `voice::VoiceResourceScheduler` (R11 Rust mirror)
- `voice::resource_scheduler::PlatformSignals` trait — production
  Android implementation will provide a JNI bridge reading
  `ActivityManager.getMemoryInfo()` + `PowerManager.getCurrentThermalStatus()` (R13.x follow-up).

Diagnostic snapshot on Android is exposed via Tauri's `invoke()` bridge:

```ts
await invoke('voice_scheduler_diagnostics')
  // returns Diagnostics snapshot over the IPC bridge
```

The Android target itself was not exercised from this campaign (R3 / R12 hardware gates pending). The pure-logic Rust scheduler is verified on the host binary (`cargo test --lib voice::` → 15/15) but the aarch64-linux-android cross-compile + on-device run is hardware-blocked.

## 7. Common operational commands

```bash
# Voice-host test suite (regression gate)
python scripts/voice/voice-host-test-runner.py --full

# App-side voice suite
cd packages/app && bun test src/voice/

# Android Rust scheduler (host-compiled)
cd packages/mobile/src-tauri
cargo test --lib voice::

# Static typecheck (full monorepo)
node node_modules/@typescript/native-preview/bin/tsgo.js -b  # in packages/app

# Pre-push gate (run by husky's turbo pre-push)
pnpm turbo typecheck
```

## 8. When something breaks (prelude to troubleshooting.md)

Common symptoms and where to look:

| Symptom | Likely cause | First file to inspect |
|---|---|---|
| Voice worker exits immediately | Missing `LIVEKIT_*` or `UNIFIA_SERVER_*` env | the worker logs the missing key on first import |
| High CPU at idle | OMP thread budget not capped per `UNIFIA_VOICE_CPU_PROFILE` | `voice_host.worker.OMP_NUM_THREADS` |
| STT transcribes gibberish | Wrong `UNIFIA_PARAKEET_DIR` (stale vocab.txt) | worker startup logs |
| TTS emits nothing | Pocket weights not on disk | `docs/voice-troubleshooting.md` §3 |
| Mobile app crashes on first live | Rust Tauri build missing | see `MOBILE-IDE-ROADMAP.md` |

The full troubleshooting matrix lives in `docs/voice-troubleshooting.md`.

## 9. Rollback procedure

See `docs/voice-rollback-procedure.md`. Voice component versions are
pinned via the model registry (`packages/voice-host/models/registry.json`)
and via the Cargo.lock / bun.lock lockfiles. Rollback is two-step:
freeze the registry + revert the lockfile.

## 10. Source of truth

Canonical authority, in priority order:
1. The code at HEAD on `voice` branch (R11 commit `1ac38fc0bc`).
2. Frozen ADRs `058`-`074` (frozen at 2026-09-26).
3. The Plan `RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md` and its 13 gate sections (R0-R14).
4. Honest physical-gate boundary `docs/CHECKPOINT-VOICE-V2-2026-09-26.md`.
5. Session-Recaps under `D:\Documents\Obsidian\IA_Dev_Brain\projects\unifia\sessions\`.
