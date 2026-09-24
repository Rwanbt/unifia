<!-- SPDX-License-Identifier: MIT -->
# Voice Host

CPU-first speech runtime for Unifia, installed and supervised by the desktop
app in a managed Python 3.12 environment (`uv sync --locked`).

| Entry point | Role |
|---|---|
| `python -m voice_host.worker` | Pocket TTS worker for manual read-aloud, previews and autoplay (JSONL over stdio). |
| `python -m voice_host.live serve` | Live conversation agent (LiveKit Agents): Silero VAD, turn detector v1-mini, Parakeet STT, VoiceAgentBridge to the Unifia session, Pocket streaming with Piper fallback. Prints `UNIFIA_LIVE_READY` once registered; exits when stdin closes. |
| `python -m voice_host.live check` | Prints which models are available (JSON). |

The worker's manual read-aloud command is currently desktop-only. Mobile Live
audio streams through the paired desktop agent; mobile manual read-aloud has no
authenticated Voice Host route yet and remains unavailable.

Configuration comes from the supervisor's environment: `LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `UNIFIA_SERVER_URL`,
`UNIFIA_SERVER_USERNAME`, `UNIFIA_SERVER_PASSWORD`, `UNIFIA_PARAKEET_DIR`,
`UNIFIA_PIPER_PROJECT`, `UNIFIA_PIPER_ASSET_DIR`, `UNIFIA_TTS_PROVIDER`,
`UNIFIA_VOICE_CPU_PROFILE`. CUDA is hidden in every speech process.

The LiveKit SFU itself is provisioned by the desktop app
(`packages/desktop/src-tauri/src/livekit_server.rs`: official 1.13.7 release,
pinned SHA-256).

Tests: `python -m unittest tests.test_live_text tests.test_live_runtime
tests.test_live_stt tests.test_worker tests.test_voice_state`; the real-transport test needs
`UNIFIA_LIVEKIT_SERVER_BIN` (see `docs/voice-live.md`).

Architecture and decisions: `docs/voice-live.md`, `docs/adr/ADR-049-voice-runtime.md`.
