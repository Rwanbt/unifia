<!-- SPDX-License-Identifier: MIT -->
# Live voice conversation

Normative decisions: [ADR-049](adr/ADR-049-voice-runtime.md). Earlier waves
(contracts, Kokoro removal, Pocket runtime, Piper fallback, playback and
capture ownership) are in [voice-runtime-baseline.md](voice-runtime-baseline.md),
[voice-piper.md](voice-piper.md), [voice-playback.md](voice-playback.md) and
[voice-capture.md](voice-capture.md).

## Two voice workflows

| Control | `data-action` | Behaviour |
|---|---|---|
| Microphone | `prompt-stt-toggle` | Record → stop → Parakeet → text inserted into the prompt. Never submits. |
| Live | `prompt-live-toggle` | Continuous conversation over WebRTC with the same Unifia session. |

Only one owner holds the microphone (`AudioCaptureCoordinator`). Starting Live
while dictating first finalizes the dictation (its text lands in the prompt),
then Live takes the microphone. While Live is active the microphone button is
disabled with the tooltip "Exit Live mode to use voice dictation"; it is usable
again as soon as Live stops.

## Architecture

```
Desktop / phone WebView (PromptInput)
  livekit-client: mic (AEC/NS/AGC) ──WebRTC──┐        ┌── agent audio
                                             ▼        │
Unifia Voice Host (desktop)                 livekit-server 1.13.7 (loopback, or one LAN IP)
                                             ▲        │
  python -m voice_host.live (LiveKit Agents 1.8.3)    │
    Silero VAD ─► turn detector v1-mini ─► Parakeet (int8, CPU)
                                             │
                                  VoiceAgentBridge ── HTTP ──► Unifia server (sidecar)
                                             │                  POST /session/:id/prompt_async
                                             │                  GET  /event   (SSE)
                                             ▼                  = the same session, provider,
    SpeechSegmenter ─► SpeechRenderer ─► TtsRouter                agent loop, tools, permissions
                                           ├─ Pocket (in process, quantized, CPU, streaming)
                                           └─ Piper  (separate GPL process, JSONL, CPU)
```

LiveKit owns transport, VAD, turn-taking and interruptions only. The LiveKit
session is given an `llm` adapter that forwards the finalized transcript to the
Unifia session and streams back Unifia's answer; no tool is registered with
LiveKit. The model/provider/agent are the ones selected in the composer when
Live starts (carried by the room binding), so local llama.cpp, MiniMax, Claude
or GPT are all used exactly as for a typed prompt.

### Key files

| Concern | File |
|---|---|
| Live state machine (9 explicit states) | `packages/app/src/voice/live-state.ts` |
| Controller (grant, connect, reconnect, mic/playback leases) | `packages/app/src/voice/live-controller.ts` |
| LiveKit transport | `packages/app/src/voice/livekit-room.ts` |
| Voice Host / grant client | `packages/app/src/voice/live-host.ts` |
| Prompt controls | `packages/app/src/components/prompt-input/voice-controls.tsx` |
| Settings | `packages/app/src/components/settings-audio-live.tsx` |
| Room grants and bindings (server) | `packages/unifia/src/server/routes/voice-live.ts` |
| Voice Host supervisor (desktop) | `packages/desktop/src-tauri/src/voice_live.rs` |
| LiveKit install, pin and config (exposure rules) | `packages/desktop/src-tauri/src/livekit_server.rs` |
| Agent entrypoint | `packages/voice-host/voice_host/live/agent.py`, `__main__.py` |
| Agent bridge | `packages/voice-host/voice_host/live/bridge.py` |
| Segmenter / renderer / language | `segmenter.py`, `renderer.py`, `language.py` |
| Streaming TTS router | `packages/voice-host/voice_host/live/tts.py` |
| Parakeet STT | `packages/voice-host/voice_host/live/stt.py` |

## Topology

**Desktop.** Pressing Live calls `voice_live_start` (Tauri). The supervisor
starts `livekit-server` and the Python agent in
the managed Voice Host environment. On first use the official LiveKit 1.13.7
release archive is downloaded from GitHub into `<app data>/speech/livekit/`;
the archive and the extracted executable are checked against SHA-256 pins in
`livekit_server.rs` before every start. API key and secret are generated per
start, zeroised on stop, and the generated `livekit.yaml` is deleted once the
server is up. The supervisor waits for `UNIFIA_LIVE_READY`, then writes
`<app data>/speech/live/livekit.json` (mode 0600). The Unifia server reads that
file through `UNIFIA_VOICE_HOST_DIR` to issue room tokens. The manual Pocket
worker is stopped while the Voice Host runs so Pocket is loaded once. The host
is stopped 5 minutes after the last Live conversation ends.

**Mobile.** The phone runs no speech model for Live. When the app is connected
to the desktop's Unifia server (the existing paired remote-server connection),
`POST /voice/live/session` on that server returns a token and the Voice Host's
LAN URL; the phone joins over WebRTC and hears Pocket (or Piper) generated on
the desktop CPU. Dictation on the phone keeps using its local Parakeet.

**No Voice Host.** On the phone's embedded server, or when the host is not
running, the server answers `503 voice_host_unavailable` and the Live button
shows "Voice Host unavailable. Start Unifia on your computer or check
Settings > Audio." No cloud voice service is used as a substitute.

### Network exposure

| Mode | Signal | Media | Notes |
|---|---|---|---|
| Local (default) | `127.0.0.1:7880/tcp` (+ `[::1]` when IPv6 loopback exists) | `127.0.0.1:7882/udp` | Verified listeners on Linux: nothing else is bound. |
| LAN (opt-in) | `127.0.0.1` + one private IPv4 | same UDP port on those addresses | Address = interface of the default route, only if RFC1918. |

TCP ICE (`tcp_port: 0`) and TURN are disabled: TCP ICE binds every interface.
`rtc.enable_loopback_candidate: true` is required — pion drops loopback
candidates otherwise and a local client never forms an ICE pair
(`wait_pc_connection timed out`, the failure recorded during Wave H on
Windows; reproduced on Linux by removing the option and fixed by adding it).
Without `rtc.stun_servers` LiveKit hands clients public Google/Twilio STUN
servers; the config therefore sets a dead loopback STUN endpoint
(`127.0.0.1:9`), so srflx gathering fails silently and nothing leaves the
host. Pointing it at LiveKit's own UDP port instead makes ICE time out (the
mux does not answer as a STUN server) — verified with the integration test.
`::1` is bound only when IPv6 loopback is available: livekit-server exits at
startup on a bind address of a missing family.
Internet exposure is never automatic.

## Turn handling

- VAD: Silero through `livekit.agents.inference.VAD` (bundled native model).
- End of turn: `inference.TurnDetector(version="v1-mini")`, local, CPU,
  multilingual (EN/FR/ES/IT/DE), combined with VAD endpointing.
- Interruptions: VAD mode, 0.3 s minimum speech, AEC warm-up 0.5 s (LiveKit's
  default 3 s would make early barge-in impossible).
- Turn identity: `vt_` + hash(room, participant, LiveKit item id); the Unifia
  message id is created once per turn (server id layout) and a turn is posted
  only if that message does not exist yet, so retries and reconnects never
  submit twice.
- Long tasks: if no text arrives within 2.5 s or a tool starts, a short
  localized acknowledgement is spoken and the agent publishes
  `unifia.task=working`. Barge-in cancels speech only; the Unifia run goes on.
  When a detached long task completes and no newer turn exists, its first
  three spoken segments are said as a summary.
- Speech output: `SpeechSegmenter` releases complete sentences as they stabilize
  (no fixed 8–15 character fragment), `SpeechRenderer` replaces code, tables,
  long lists, JSON, diffs, stack traces, URLs, hashes and secrets with short
  spoken references. Frames go straight to LiveKit; no WAV is written.

## Security review

| Threat | Mitigation |
|---|---|
| Unauthorized participant | Tokens only from the authenticated Unifia server (existing Basic/JWT auth = pairing); viewer accounts refused; `maxParticipants: 2`; agent dispatch only by token. |
| Token leak / replay | 10-minute JWT limited to one opaque room, microphone publishing only, no data publishing, no admin grants. Bindings expire after 12 h. |
| Secret exposure | LiveKit API secret stays on the desktop (0600 file, never in a response or the WebView). |
| Room/identity disclosure | Room `unifia-live-<24 random>`, identity `device-<16 random>`, binding `lvb_<32 random>`; no path, user or session in names. |
| Token flooding | 20 grants per minute per server. |
| Audio flood / oversized audio | Utterances capped at 60 s for STT; LiveKit limits participants and tracks. |
| TTS DoS | One synthesis per model, bounded queue (32 chunks) with backpressure, cancellation on barge-in. |
| Tampered runtime | `livekit-server` must match its pinned reproducible SHA-256; Python deps from the exact `uv.lock` with hashes. |
| LAN exposure | Off by default; only one RFC1918 address is added; no TCP ICE, no TURN. |
| Voice read-back of secrets | Renderer redacts API keys, tokens, passwords, private keys and URL credentials before synthesis. |
| Malicious binding / path | Binding ids validated by regex; directory must be absolute; the agent refuses a binding whose room differs. |

## Privacy

Microphone audio goes only to the local or LAN Voice Host. No audio or
transcript is logged: logs carry byte counts, durations, providers and
languages. LiveKit session recording is disabled (`record=False`). If the
selected Unifia model is remote, the transcript follows the same disclosure
policies as typed prompts. LiveKit Cloud is never enabled.

## Licenses

| Component | License | Distribution |
|---|---|---|
| livekit-server 1.13.7 | Apache-2.0 | Official release binary downloaded at first use, SHA-256 pinned, not redistributed in the installer. |
| livekit-agents 1.8.3, livekit, livekit-api, livekit-protocol | Apache-2.0 | Installed by uv from PyPI (locked). |
| livekit-local-inference 0.2.7 (Silero VAD, turn detector v1-mini) | Apache-2.0 **and LiveKit Model License** | Installed by uv. The model license allows free use only together with LiveKit Agents and forbids using its outputs to train other models; Unifia uses it only inside LiveKit Agents. |
| onnx-asr 0.12.0 | MIT | uv |
| onnxruntime 1.30.0 | MIT | uv |
| av 18.1.0 (bundles FFmpeg) | BSD-3-Clause (+ FFmpeg LGPL libraries in the wheel) | uv, not redistributed by Unifia |
| livekit-client 2.22.3 | Apache-2.0 | App bundle |
| Piper | GPL-3.0-or-later | Separate process and environment (unchanged boundary) |
| Pocket TTS, Parakeet | see [voice-runtime-baseline.md](voice-runtime-baseline.md) | unchanged |

## Troubleshooting

| Symptom | Check |
|---|---|
| "Voice Host unavailable" on desktop | Logs `[LiveKit]` / `[Live agent]`; port 7880 or 7882 in use by another program; LiveKit download or hash check failed (`<app data>/speech/live/livekit.log`); managed runtime install failed (see Speech toasts). |
| "Voice Host unavailable" on the phone | The phone must be connected to the desktop's Unifia server, and Live LAN access enabled on the desktop (Settings > Audio > Voice Host access). |
| Connects but never listens | Agent did not join within 20 s: Parakeet missing (`stt_unavailable`) or agent crash (supervisor restarts it up to 3 times per 5 min). |
| `wait_pc_connection timed out` | The LiveKit config lacks `enable_loopback_candidate: true`, `stun_servers` points at LiveKit's own UDP port, or a firewall/GPO blocks UDP 7882. |
| No barge-in | Headphones vs speakers: echo is cancelled by the platform AEC; interruptions need 0.3 s of speech. |

## Tests and measurements

Automated (this repository):

- Python: `python -m unittest tests.test_live_text tests.test_live_runtime` —
  segmenter, renderer (secrets), language routing, turn ids/ledger, TTS router
  (auto fallback, explicit providers, no restart after audio, cancellation),
  Pocket streaming backend (consumer-gone unwinds the producer), Piper JSONL
  backend, bridge against an HTTP/SSE double (one session, one submission,
  reasoning excluded).
- Real transport: `UNIFIA_LIVEKIT_SERVER_BIN=<livekit-server> python -m unittest
  tests.test_live_transport_integration` — real livekit-server, real LiveKit
  Agents pipeline with Silero VAD and turn detector v1-mini, real WebRTC client
  speaking espeak-ng French; only Parakeet/Pocket/Piper models and the Unifia
  server are doubles. Token minted by the server's TypeScript code.
- App: `live-state`, `live-controller`, `live-host`, `test/desktop-dictation`.
- Server: `test/server/voice-live-routes.test.ts`.
- Rust: `voice_live::config` tests.

Measured on the Linux CI container (loopback, 4 vCPU, no GPU), 4 runs of the
real-transport test:

| Metric | Result |
|---|---|
| `voice.connect.ms` (client join) | 191–217 ms (reconnect 167–200 ms) |
| Assistant audio stopped after user speech onset | 512–557 ms (includes the deliberate 0.3 s minimum) |
| Second turn submitted after end of speech | 2.37–2.46 s (VAD + turn detector endpointing; STT doubled) |
| Duplicate submissions after reconnect | 0 |

Not measured here (no model downloads, no GPU, no physical device): Pocket
TTFA on the target desktop, Parakeet latency on live turns, local LLM
throughput with Live active, VRAM, Android. See the final report in
ADR-049 for the production gates that remain open.
