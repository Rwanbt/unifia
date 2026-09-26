<!-- SPDX-License-Identifier: MIT -->
# ADR-060: VoiceTurnEngine shared core — design (2026-09-26)

> Companion to [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md),
> [ADR-059-voice-portable-pocket-runtime.md](ADR-059-voice-portable-pocket-runtime.md)
> and the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).
> Original draft proposed a TypeScript-facing engine. The v2.2 campaign
> selects a portable Rust `VoiceCore` as the canonical owner, with Python
> and TypeScript as adapters during migration. This ADR remains DRAFT until
> production adapters and parity evidence are complete.

## Context

Today the desktop Live path and the Android local Live path are two
different implementations:

| Concern | Desktop (`voice_host` Python) | Android (`packages/app/src/voice/`) |
|---|---|---|
| Capture | LiveKit/WebRTC room | WebView `getUserMedia` and `ScriptProcessorNode` |
| Turn detection | Silero VAD + LiveKit `turn-detector-v1-mini` | RMS threshold + TypeScript `TurnEndpointing` |
| STT | Python `onnx_asr` + ONNX Runtime, Parakeet TDT 0.6B v3 INT8 | Rust `ort`, Parakeet TDT 0.6B v3 INT8 |
| Agent bridge | `prompt_async` + `/event` SSE; canonical Unifia session | `session.prompt`; canonical Unifia session, full answer awaited |
| Spoken text | Python `SpeechSegmenter` + `renderer` | Entire assistant response as text |
| TTS | Pocket managed Python; Piper subprocess fallback | WebView `speechSynthesis`, `localService` voice required |
| Audio result | PCM chunks over LiveKit | Android system speech output |
| LLM | Selected Unifia model/provider | Selected Unifia model/provider; local GGUF readiness not preflighted by Live |

Evidence:
`packages/voice-host/voice_host/live/{agent,bridge,renderer,segmenter,stt,tts,turns,language,config}.py`;
`packages/app/src/voice/{android-local-voice,android-offline-tts,live-controller,local-session,turn-endpointing,live-state,live-store,live-host,livekit-room,audio-capture-coordinator,audio-playback-coordinator}.ts`;
`packages/mobile/src-tauri/src/speech.rs`.

This duplication is acceptable as a transitional slice (per
`voice-current-state-2026-09-25.md`) but the v2 plan requires **one**
shared `VoiceTurnEngine` so that platform differences stop at the OS
audio adapter boundary.

## Decision (proposed)

A single shared `VoiceCore` is the canonical owner of platform-independent
Voice semantics. The portable Rust crate at `packages/voice-core` is the
canonical API; the desktop Python runtime and Android TypeScript/Tauri paths
become adapters that satisfy it. Provider implementations remain in their
best-supported runtime rather than moving into Rust solely for uniformity.

### Historical TypeScript projection (not the canonical core API)

The following TypeScript interface and event union preserve the original
draft's UI projection. They are not the engine implementation or a second
source of truth. Bindings and adapters must derive their behavior and wire
contract from `packages/voice-core`.

```ts
// packages/contracts/voice/turn-engine.ts (proposed)
export interface VoiceTurnEngine {
  // session lifecycle
  prepare(session: VoiceSessionContext): Promise<VoiceReady>
  startListening(session: VoiceSessionContext): Promise<void>
  stopListening(session: VoiceSessionContext): Promise<void>
  cancelCurrentTurn(reason: TurnCancelReason): Promise<void>
  dispose(session: VoiceSessionContext): Promise<void>

  // event subscription (typed, monotonic sequence)
  subscribe(session: VoiceSessionContext, listener: VoiceEventListener): Unsubscribe

  // runtime control surface for UI
  bargeIn(session: VoiceSessionContext): Promise<void>
  resumeAgent(session: VoiceSessionContext): Promise<void>

  // diagnostics (used by the runtime ABI diagnostic)
  diagnostics(): Promise<VoiceDiagnostics>
}

export type VoiceEvent =
  | { kind: "voice_preparing"; sessionID: string; turnID?: undefined; ts: number; seq: number }
  | { kind: "voice_ready"; sessionID: string; ts: number; seq: number; capabilities: VoiceCapabilities }
  | { kind: "speech_started"; sessionID: string; turnID: string; ts: number; seq: number }
  | { kind: "speech_ended"; sessionID: string; turnID: string; ts: number; seq: number }
  | { kind: "vad_probability"; sessionID: string; turnID?: undefined; ts: number; seq: number; value: number }
  | { kind: "turn_incomplete"; sessionID: string; turnID: string; ts: number; seq: number }
  | { kind: "turn_complete"; sessionID: string; turnID: string; ts: number; seq: number; transcript: string; confidence?: number }
  | { kind: "stt_partial"; sessionID: string; turnID: string; ts: number; seq: number; text: string; stable: boolean }
  | { kind: "stt_final"; sessionID: string; turnID: string; ts: number; seq: number; text: string }
  | { kind: "turn_submitted"; sessionID: string; turnID: string; ts: number; seq: number; messageID: string }
  | { kind: "agent_thinking"; sessionID: string; turnID: string; ts: number; seq: number }
  | { kind: "agent_working"; sessionID: string; turnID: string; ts: number; seq: number; tool?: string }
  | { kind: "tool_started"; sessionID: string; turnID: string; ts: number; seq: number; tool: string }
  | { kind: "tool_finished"; sessionID: string; turnID: string; ts: number; seq: number; tool: string; outcome: "ok" | "denied" | "errored" }
  | { kind: "permission_required"; sessionID: string; turnID: string; ts: number; seq: number; permission: string }
  | { kind: "assistant_text_delta"; sessionID: string; turnID: string; ts: number; seq: number; delta: string }
  | { kind: "speech_segment_ready"; sessionID: string; turnID: string; ts: number; seq: number; text: string; voice: VoiceId; lang: VoiceLang }
  | { kind: "tts_started"; sessionID: string; turnID: string; ts: number; seq: number; segment: number }
  | { kind: "tts_audio"; sessionID: string; turnID: string; ts: number; seq: number; segment: number; pcm: Float32Array; sampleRate: number; channels: 1 }
  | { kind: "tts_cancelled"; sessionID: string; turnID: string; ts: number; seq: number; reason: TurnCancelReason }
  | { kind: "assistant_speaking"; sessionID: string; turnID: string; ts: number; seq: number }
  | { kind: "assistant_interrupted"; sessionID: string; turnID: string; ts: number; seq: number }
  | { kind: "audio_route_changed"; sessionID: string; ts: number; seq: number; route: AudioRoute }
  | { kind: "provider_fallback"; sessionID: string; ts: number; seq: number; from: ProviderId; to: ProviderId; reason: string }
  | { kind: "resource_pressure"; sessionID: string; ts: number; seq: number; pressure: "memory" | "cpu" | "thermal" | "network" }
  | { kind: "voice_recovering"; sessionID: string; ts: number; seq: number; stage: RecoveryStage }
  | { kind: "voice_error"; sessionID: string; turnID?: string; ts: number; seq: number; stage: VoiceErrorStage; detail: string }
  | { kind: "voice_stopped"; sessionID: string; ts: number; seq: number; reason: StopReason }
```

### Adapters required

- **AudioInput** — platform PCM capture. Desktop: LiveKit
  `RemoteAudioTrack` decoded to Float32 PCM (Python side). Android:
  Oboe/AAudio or WebView `getUserMedia` + `AudioWorklet`, depending on
  the WebView qualification from R3.
- **AudioOutput** — platform PCM playback. Desktop: LiveKit
  `AudioTrack` publishing from Pocket PCM chunks. Android:
  `AudioTrack` PCM write or WebView `AudioContext` queue, with the
  same priority rule (Live > manual > autoplay) recorded in
  `voice-runtime-baseline.md`.
- **VAD** — Silero VAD ONNX, pinned revision, 16 kHz, 512-sample
  frames. Both sides expose the same probability stream so the engine
  can drive `vad_probability` events and `turn_incomplete` /
  `turn_complete` decisions identically.
- **TurnDetector** — deterministic endpointing policy + optional
  Smart Turn / TurnSense adapters. The LiveKit
  `turn-detector-v1-mini` model is **not** ported to the shared
  engine per ADR-058 §5; it remains LiveKit-transport-only.
- **SttStreaming + SttFinal** — two capability classes. Parakeet TDT
  0.6B v3 INT8 is the `SttFinal`. `SttStreaming` is selected by the R5
  bake-off (Nemotron 3.5, Moonshine, etc.). The engine streams
  `stt_partial` events and only commits a `stt_final` after
  `turn_complete` is signalled by the turn detector.
- **TtsRouter** — canonical router with `Pocket primary → Piper
  fallback → explicit error`. Per ADR-059, the Android Pocket runtime
  candidate is PocketTTS.cpp pending qualification. Piper remains the
  desktop fallback.
- **AgentBridge** — single Unifia session consumer. Uses
  `prompt_async` on desktop (already in
  `voice_host/live/bridge.py`) and the embedded-server equivalent on
  Android; both subscribe to `prompt_async` with a stable
  `messageID` and consume the `/event` SSE stream. The bridge
  propagates `assistant.info.error`, tool events, permission requests,
  and long-running work to the engine exactly the same way on both
  platforms.

### SpeechRenderer / SpeechSegmenter / LanguageRouter

These three components currently exist only on the desktop Python side
(`voice_host/live/{segmenter,renderer,language}.py`). They are pure
TypeScript-portable functions. Phase R2 of the v2 plan ports them to
the shared package with a fixture-driven parity test: the same Python
input text and Markdown produce the same list of segments and the
same voice identity on both sides. The Python implementation stays
authoritative for desktop until the parity fixture passes.

### State machine

The shared engine is responsible for the canonical voice states:
`idle → preparing → connecting (only when a remote transport exists)
→ listening → processing → thinking → speaking → working →
reconnecting → error`. Android must never appear "connecting" when it
is actually running locally (per the v2 plan invariant §11). The
existing `live-state.ts` reducer and the existing `voice_state.py`
state machine are the two reference implementations; the shared engine
imports neither directly — it owns its own reducer and the two
implementations are migrated to it.

### Interruption and barge-in

Per ADR-058 and the v2 plan §12: `cancel speech ≠ cancel agent work`.
The engine exposes `bargeIn()` which signals the TTS path to stop /
duck playback immediately; the `AgentBridge` keeps the running Unifia
operation alive unless the user explicitly cancels it through the
canonical Unifia permission/policy path. This invariant is enforced
by the engine — neither the VAD nor the turn detector nor any
`FastDecisionProvider` may directly cancel a privileged tool
operation.

## Migration strategy

The migration is staged behind feature switches so desktop and Android
can each run the new path independently while the legacy path stays
authoritative for the platform that has not yet proven parity.

1. Land the shared package and the contract tests with zero
   behavioural change. Desktop still calls
   `voice_host.live.agent`, Android still calls
   `live-controller.ts`. Tests pass.
2. Add a `VoiceTurnEngine` adapter that wraps the existing desktop
   `voice_host` (one thin Python shim if needed, or a Bun/Node
   wrapper that talks to it over the existing IPC). Feature flag
   `voice_engine_v2` enables it on desktop behind a per-user switch.
3. Build the Android `VoiceTurnEngine` adapter using
   `packages/mobile/src-tauri/src/speech.rs` for STT, Oboe/AAudio
   for capture and playback (per the v2 R3 plan), and a TypeScript
   port of the renderer/segmenter/language router. Feature flag
   `voice_engine_v2_android` enables it on mobile behind a per-user
   switch.
4. Record parity fixtures and require a green parity run on both
   platforms before removing either legacy path. Once green, retire
   `voice_host.live.agent` and the Android
   `LiveVoiceController` `host` branch; the engine owns both.

## Open questions requiring evidence

- Does the WebView capture/playback path meet interruption and
  sustained-use budgets on the Xiaomi, or does R3 require a native
  Oboe/AAudio pipeline? (Decision needs physical measurement.)
- After speech interruption, what should the engine do with the
  running agent run? Stop playback only (per ADR-058 §11), keep the
  run alive? Or interpret the barge-in as a fresh turn? (Decision
  needs an explicit product call — flagged as open.)
- Same timbre/voice asset on both platforms, or same selectable
  voice identity with potentially different timbre? The RFC assumes
  the same pinned asset; this is a product call.

## Status

**DRAFT — implementation in progress.** `packages/voice-core` now defines
typed error/event contracts and validation, and the Tauri crate links it.
The core also sequences events, deduplicates retried publications by
idempotency key, fences stale session/turn generations, cancels stale
speech output without cancelling agent work, and advances generation on
reconnect/recovery. Production event producers, durable
recovery storage, adapters, and cross-runtime parity remain unimplemented;
no adoption or qualification is claimed.

The historical feature flags `voice_engine_v2` and
`voice_engine_v2_android` may be used by adapters during migration, but do
not change the canonical ownership decision above.

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md)
- [ADR-059-voice-portable-pocket-runtime.md](ADR-059-voice-portable-pocket-runtime.md)
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [voice-current-state-2026-09-25.md](../voice-current-state-2026-09-25.md)
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)
- `packages/voice-host/voice_host/live/{agent,bridge,renderer,segmenter,stt,tts,turns,language,config}.py`
- `packages/app/src/voice/{live-controller,live-state,local-session,turn-endpointing,audio-capture-coordinator,audio-playback-coordinator,android-local-voice,android-offline-tts}.ts`
- `packages/mobile/src-tauri/src/speech.rs`
- `packages/contracts/speech` — current speech contracts
