<!-- SPDX-License-Identifier: MIT -->
# RFC: One local Voice implementation on desktop and Android

**Date:** 2026-09-25  
**Status:** Draft, research and implementation plan  
**Branch and baseline:** `voice` at `535d49f5779b0f67674cb25406a89600d01c61ff`  
**Related:** [ADR-058](../adr/ADR-058-voice-runtime.md), [Android standalone plan](../PLAN-ANDROID-STANDALONE-VOICE.md), [Live Voice](../voice-live.md)

## Goal and exact meaning of parity

Desktop and Android must run the same local Voice turn orchestration and the
same pinned speech model families and voice assets. They must apply the same
language routing, endpointing thresholds, answer rendering, TTS preference and
fallback, interruption, error taxonomy, and Unifia session/agent/provider/tool
rules. Only operating-system audio capture/playback, packaging, and optional
network transport may differ. Identical bytes of PCM across x86 and ARM are
not a useful acceptance condition; equivalent transcripts, turns, selected
voices and audible output on a fixed corpus are.

The Android phone remains sufficient by itself. A selected local LLM and
downloaded speech assets must complete Live in airplane mode. Selecting a
remote LLM permits only the existing provider's network requests. Raw
microphone audio must not be sent to a PC or speech service. A paired PC and
LiveKit are optional remote transports, never a prerequisite for local Voice.

## Current implementation and cause of divergence

| Concern | Desktop today | Android today | Required common contract |
|---|---|---|---|
| Capture and turns | LiveKit audio, Silero VAD, LiveKit `turn-detector-v1-mini` | WebView `ScriptProcessorNode`, RMS threshold, TypeScript `TurnEndpointing` | One pinned Silero model and one endpointing policy; same bounded capture and barge-in semantics |
| STT | Python `onnx_asr` plus ONNX Runtime, Parakeet TDT 0.6B v3 INT8 | Rust `ort`, Parakeet TDT 0.6B v3 INT8 | Same pinned model archive, preprocessing and transcript normalization, qualified on both CPUs |
| Agent | `prompt_async` and `/event` stream; canonical Unifia session | `session.prompt`, full response before playback | One event-driven Unifia turn bridge with identical model, agent, variant, permission, tool and error handling |
| Spoken text | Python incremental segmenter, renderer, language router and long-task handling | Full response sent directly to TTS | One shared incremental segmenter, renderer and language router |
| TTS | Pocket managed Python primary, isolated Piper process fallback | Android WebView `speechSynthesis` offline voice | Same pinned Pocket model/voice per supported language, Piper fallback when qualified, explicit route and failure diagnostics |
| Settings | Pocket/Piper and selected voice used | Pocket/Piper settings displayed but ignored by local Voice | Capability-driven settings with the same effective provider, language, voice and speed |
| Errors | Host and route events | Startup/turn errors often mapped to `unknown` | Typed stage errors with actionable details and no silent assistant failure |

Evidence in this checkout: `packages/voice-host/voice_host/live/agent.py`,
`bridge.py`, `segmenter.py`, `renderer.py`, `tts.py`,
`packages/app/src/voice/android-local-voice.ts`, `android-offline-tts.ts`,
`live-controller.ts`, `local-session.ts`, and
`packages/mobile/src-tauri/src/speech.rs`. Android currently calls TTS
`prepare()` before microphone/STT startup, so failure to discover a WebView
offline voice can abort Live immediately. This is a code-supported failure
path, not yet an observed stack trace from the failing APK. `local-session.ts`
checks the SDK wrapper error but does not inspect assistant `info.error`.
Therefore a provider/model failure can also leave no spoken response. Neither
path alone proves the exact runtime cause of the reported failure.

## Research and constraints

1. Kyutai Pocket TTS currently advertises English, French, German,
   Portuguese, Italian and Spanish. The existing Unifia speech contract has
   five languages (EN/FR/ES/IT/DE). Portuguese is a separate product-contract
   extension, not implicit in this parity migration. Pin a specific upstream
   revision, model configuration, weights and voice assets. Source:
   [Kyutai Pocket TTS](https://github.com/kyutai-labs/pocket-tts).
2. `sherpa-onnx` provides Android arm64 and desktop native runtimes and APIs
   for VAD, Parakeet, Pocket and Piper. Its documented Pocket bundle is the
   January 2026 English INT8 export. The upstream French/newer-model support
   request is still open; this runtime does not currently prove five-language
   Pocket parity. Sources: [Android build](https://k2-fsa.github.io/sherpa/onnx/android/build-sherpa-onnx.html),
   [Pocket guide](https://k2-fsa.github.io/sherpa/onnx/tts/pocket.html),
   [multilingual compatibility issue](https://github.com/k2-fsa/sherpa-onnx/issues/3755).
   A pinned fork is a viable candidate: the issue reports FP16 KV-cache state
   incompatibility, missing `bos_before_voice` conditioning, and different
   end-of-speech behavior in newer exports. These are reporter findings to
   reproduce against a pinned Kyutai reference, not a verified patch recipe.
   Keep any fix narrow and propose it upstream to limit long-term fork drift.
3. Kyutai lists PocketTTS.cpp (ONNX Runtime/C++ API) and LiteRT Android ports,
   but listing does not certify multilingual equivalence, voice compatibility,
   licensing of all assets, or performance on the Xiaomi. Prototype against
   the pinned Python reference before selecting a runtime. Source:
   [Kyutai alternative implementations](https://github.com/kyutai-labs/pocket-tts#alternative-implementations).
4. Silero publishes an ONNX VAD and documents mobile/ARM use. Pin one version
   and verify its state, frame size, resampling and probability calibration on
   both platforms. Sources: [Silero repository](https://github.com/snakers4/silero-vad),
   [ARM/ONNX FAQ](https://github.com/snakers4/silero-vad/wiki/FAQ).
5. The LiveKit model license restricts its models to LiveKit Agents. The local
   shared engine must not copy or rehost `turn-detector-v1-mini`. Keep it only
   in an optional LiveKit transport, or replace it on both local platforms with
   the same Silero plus deterministic endpointing policy. Sources:
   [LiveKit model license](https://github.com/livekit/agents/blob/main/MODEL_LICENSE),
   [turn detector documentation](https://docs.livekit.io/agents/logic/turns/turn-detector/).
6. The mobile Rust STT already links `ort = 2.0.0-rc.10` and an Android
   ONNX Runtime shared library. Adding `sherpa-onnx` may add a second ORT
   binary with a different ABI. Choose one ownership strategy and inspect the
   produced APK native libraries before integration. Current project:
   `packages/mobile/src-tauri/Cargo.toml` and `speech.rs`.
7. Pocket code is MIT, while voice/model assets and Piper distributions need
   their own pinned license records. Existing desktop Piper isolation remains
   the boundary until an Android distribution approach is reviewed. Source:
   [Kyutai license](https://github.com/kyutai-labs/pocket-tts/blob/main/LICENSE).

## Proposed architecture

```text
shared UI + settings
        |
shared VoiceTurnEngine (TypeScript): state, session events, language,
  segmentation, text rendering, routing, cancellation, typed errors
        |
SpeechEngine interface: capture PCM -> VAD -> Parakeet -> Pocket/Piper PCM
        |
portable native core (Rust owner with one pinned ORT ABI and model manifest)
        |
desktop audio adapter                     Android audio adapter
Windows capture/playback                  AudioRecord/AudioTrack or proven WebView I/O
        |                                  |
existing local Unifia server/session/LLM on each device
```

Use one `VoiceTurnEngine` source for both local platforms; the current
`LiveVoiceController` can remain the UI state coordinator while its separate
`host` and `local` turn implementations are retired. The native speech core
owns model loading, VAD state, STT/TTS inference, PCM streaming, cancellation,
resource limits and a versioned model manifest. Inject audio and session
adapters; avoid a second agent implementation. The existing desktop Python
Voice Host and LiveKit remain available during migration and as an explicitly
selected remote mode. Default desktop local Voice switches only after its new
path passes the parity gates. Once proven, amend or supersede ADR-058;
do not silently rewrite an accepted decision while this RFC is draft.

`VoiceTurnEngine` should subscribe before submitting a stable message ID to
`prompt_async`, consume `/event` deltas, inspect assistant errors, feed one
incremental renderer/segmenter, and stream speakable segments to TTS. On
interruption, stop playback immediately; define separately whether the Unifia
agent run continues or is cancelled, and apply that choice on both platforms.
Permissions and questions remain handled by the canonical session UI. The
same bridge must work against the Android embedded server over loopback.

## Delivery plan and gates

### 0. Capture a trustworthy baseline

- Record the exact installed APK, desktop build and Git SHA; capture the
  Android Live startup exception by stage (TTS, STT, microphone, session).
- Inventory real model archives, SHA-256, voices, formats, current speech
  languages, effective settings and memory at idle/LLM/STT/TTS peaks.
- Define a fixed EN/FR/ES/IT/DE corpus with short/long turns, code, lists,
  errors, interruption, permissions and slow tool runs. Keep release behavior
  visible during every slice.

**Gate:** the current failure has a stage-specific trace, and no model or
voice is claimed installed without a verified artifact.

### 1. Prove portable speech inference before a production choice

- Spike one native Silero implementation using the existing ORT ABI on ARM64
  and Windows. Feed identical PCM and compare probabilities and turn events.
- Benchmark PocketTTS.cpp and sherpa-onnx against one pinned Kyutai Python
  reference for each of five languages, same prompts and authorized voices.
  Verify model conversion graph, tokenizer, streaming chunks and cancellation.
- For the sherpa-onnx candidate, prototype support for the new export protocol
  in an isolated pinned fork; verify FP16 state tensors, voice conditioning,
  generation termination and output audio against the reference. Retain the
  exact fork commit and prepare a focused upstream contribution if it works.
- Measure peak RSS, time to first audio, synthesis real-time factor and heat on
  the actual phone while local LLM and Parakeet coexist. Audit JNI/ORT
  duplication, APK size, hashes and licenses. Select a single production
  runtime only if every required language is covered.
- Qualify Piper model/voice packages and distribution separately. If Pocket
  cannot meet the five-language gate, keep the feature explicitly unqualified
  and either improve the export/runtime or seek an approved change to the
  product contract. Do not label Android system TTS as Pocket.

**Gate:** reproducible native models and five-language samples on both
platforms, with measured memory headroom on the Xiaomi. No unsupported
language can silently switch to a different voice.

### 2. Move shared turn semantics to one owner

- Extract desktop Python language routing, incremental segmentation,
  Markdown-to-speech and long-task cues into one shared implementation used
  by the desktop and Android local paths. Characterize existing behavior
  before replacing it.
- Add a shared event-driven Unifia bridge with stable message IDs, session
  reuse, full assistant `info.error` handling, typed failure stages and the
  same permission/tool event mapping.
- Preflight the selected provider/model on each device. For `local-llm`,
  verify that the matching GGUF is loaded and its server healthy before
  entering listening state; for a remote provider, report missing credentials
  or unsupported model as that provider's error, without substituting another
  model. Reuse the canonical model picker and credential storage.
- Make the TTS router, selected voice, fallback and playback ownership common
  to Live and manual read-aloud. Dictation uses the same Parakeet asset and
  capture contract without changing its user workflow.

**Gate:** on a recorded event/PCM corpus, both local platforms produce the
same turn transitions, spoken text, selected model/agent, TTS route and
error category.

### 3. Integrate native audio and switch local traffic

- Android: replace RMS with native Silero, remove `speechSynthesis` from the
  qualified Live/read-aloud path, and expose actual model/voice readiness.
  Use bounded PCM buffers rather than base64 WAV for streaming if measured
  WebView crossings cause delay or copies.
- Desktop: connect the same local `VoiceTurnEngine` and speech core; preserve
  the Python/LiveKit implementation as a selectable fallback until parity is
  proven. Keep OS audio adapters thin and cancellable.
- Model manager: load on demand, cap threads and buffers, serialize heavy
  inference as needed, unload idle models, and avoid loading Pocket, Parakeet
  and a local LLM simultaneously if the device has insufficient headroom.
- Expose exact effective provider/voice/language in the UI; hide or explain
  unavailable choices rather than accepting settings that are ignored.

**Gate:** local desktop and local Android use the same orchestrator and pinned
speech assets. Android needs no PC, LiveKit, Google TTS voice or remote speech
service; a remote LLM remains an explicit provider choice.

### 4. Physical qualification and migration closure

- Compare all five languages and voice IDs across Windows and Xiaomi, plus
  short, long and code-heavy answers, fallback, interruptions, manual TTS,
  dictation, errors, permissions and tool calls. Prove no duplicate prompt
  after restart/reconnect.
- Run phone-only airplane-mode local-LLM Live, then explicit remote-provider
  Live. Observe Android network calls, model memory, first-audio latency,
  sustained 10-minute conversation, thermal/battery behavior and crash logs.
- Set numerical latency/RSS/thermal budgets from measured baseline before
  declaring PASS. Record each APK/build hash and device log alongside the
  result; unexecuted paths remain unqualified.
- Update ADR-058, `voice-live.md`, settings help and the Android plan after
  the chosen architecture is implemented and qualified. Remove contradictory
  instructions that still imply a mandatory paired desktop.

**GO condition:** every required local flow has physical evidence on both
devices at the same revision; no generic Live failure masks the failing stage.

## Open decisions requiring evidence

1. Which portable Pocket runtime can reproduce the pinned multilingual
   model/voices with acceptable phone memory and latency? Current upstream
   `sherpa-onnx` documentation alone does not establish this.
2. Can the existing `ort` build own VAD, Parakeet and Pocket/Piper together,
   or is a single consolidated native runtime smaller and safer?
3. Does WebView capture/playback meet interruption and sustained-use budgets,
   or should native Android audio own the real-time PCM path?
4. What is the required behavior of an agent run after speech interruption?
   Current desktop semantics stop listening while the run continues; the
   Android abort signal may affect the request differently.
5. Does the product require the same timbre/voice asset on both platforms, or
   only the same selectable voice identity and quality? This proposal assumes
   the same pinned voice asset.
