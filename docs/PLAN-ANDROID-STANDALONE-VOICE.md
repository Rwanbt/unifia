<!-- SPDX-License-Identifier: MIT -->
# Android standalone Voice implementation plan

**Status:** In progress · **Branch:** `voice` · **Date:** 2026-09-25

## Product contract

Android dictation, manual read-aloud, and continuous Live must work with the
phone as the only device. The phone owns capture, turn detection, Parakeet,
Voice orchestration, TTS, and playback. The existing Unifia session, selected
agent, provider, tools, permissions, project, and memory remain authoritative.
An explicitly selected remote LLM may use the network; no audio relay or
paired device is required. Local LLM plus local speech models must work offline.

## Feasibility findings

- Android already has Parakeet TDT v3 INT8 through ONNX Runtime and an embedded
  Unifia server plus a native `llama.cpp` service. Dictation currently records
  a complete clip; Live needs VAD-delimited finalized utterances.
- Pocket TTS upstream is MIT and documents EN/FR/ES/IT/DE. It has no official
  Android runtime; its upstream README lists community ONNX/C++ ports. The
  community C++ port documents an export/quantization/validation script, but
  that does not certify equivalence or establish an Android distribution
  contract. Pin a revision and independently compare all five languages to
  upstream. Sources: [Kyutai Pocket TTS](https://github.com/kyutai-labs/pocket-tts),
  [community PocketTTS.cpp](https://github.com/VolgaGerm/PocketTTS.cpp).
- sherpa-onnx documents Android arm64 shared-library builds and Kotlin APIs,
  including Silero VAD and Piper ONNX TTS. Its code license does not replace
  each voice model's license. Do not package the Python Piper worker. Sources:
  [Android build](https://k2-fsa.github.io/sherpa/onnx/android/build-sherpa-onnx.html),
  [Silero VAD](https://k2-fsa.github.io/sherpa/onnx/vad/silero-vad.html).
- **VAD integration choice:** first qualify Silero through the ONNX Runtime
  already used by `packages/mobile/src-tauri/src/parakeet/engine.rs`; this
  avoids adding another native runtime if the current ORT build accepts the
  model. Silero's upstream ONNX contract is stateful and consumes 512 samples
  plus 64 samples of context per 16 kHz step. Keep model acquisition pinned by
  version and SHA-256. sherpa-onnx remains the fallback if direct ORT
  integration is incompatible; its upstream publishes an Android AAR and
  arm64 libraries. Source: [Silero ONNX input contract](https://github.com/snakers4/silero-vad/blob/master/src/silero_vad/utils_vad.py).
- **Pocket Android path:** upstream lists both PocketTTS.cpp (ONNX Runtime)
  and sherpa-onnx implementations, but neither is the canonical Python
  runtime. PocketTTS.cpp provides an export, quantization, and validation
  script. Treat that as a candidate conversion only: pin its revision and
  prove numerical/audio behavior against upstream in EN/FR/ES/IT/DE before
  shipping. Source: [Pocket TTS upstream alternatives](https://github.com/kyutai-labs/pocket-tts#alternative-implementations).
- **Piper Android path:** sherpa-onnx provides Android-compatible JNI/Kotlin
  TTS APIs and native arm64 builds, so this is a viable separable runtime
  candidate; confirm the chosen model's license and the distribution boundary
  before bundling. The desktop Python worker is not portable to Android.
  Source: [sherpa-onnx Android build](https://k2-fsa.github.io/sherpa/onnx/android/build-sherpa-onnx.html).
- This environment currently cannot fetch GitHub raw files directly from the
  shell (`Invoke-WebRequest` connection refused). No model artifact or hash is
  fabricated; implementation must use a verified artifact source before
  enabling model download or packaging.
- The Xiaomi Mi 10 Pro is arm64 with 8 GiB physical RAM. A live ADB sample had
  about 0.8 GiB `MemAvailable`; model coexistence and thermal behavior must be
  measured on device before production claims.
- Existing `LiveVoiceController` requires a grant and LiveKit room. Keep that
  path for desktop and optional remote mode; Android standalone needs a local
  transport that submits turns through the existing session/provider flow.

## Delivery slices

1. **Architecture correction (complete):** supersede ADR-058's mobile-host
   requirement; document Android Local and optional Remote transports and the
   physical acceptance gates.
2. **Local session transport:** add Android local lifecycle and turn handling;
   use the existing session and selected provider, audio-capture/playback
   coordinators, and cancellation contracts. Preserve desktop LiveKit.
3. **Capture and endpointing:** acquire the microphone once, run local Silero
   VAD/endpointing, finalize bounded utterances, and reuse existing Parakeet
   assets/inference without changing dictation behavior.
4. **Android TTS:** qualify a reproducible Pocket ONNX conversion/runtime and
   compare audio/text-language behavior to the canonical source. Add isolated
   arm64 Piper fallback only after runtime and voice licensing review. Route
   both Live and manual read-aloud through the same local playback owner.
5. **Resource lifecycle:** serialize heavy inference where useful, unload on
   idle, bound buffers/threads, and measure memory, latency, CPU, thermals and
   battery. Avoid OOM under LLM + STT + TTS workloads.
6. **Qualification:** automated shared/desktop regressions, constrained
   Android build, airplane-mode local-LLM journey, no-PC Live turns and
   barge-in, FR/EN/ES/IT/DE, Pocket failure to Piper, manual TTS cancellation,
   and a sustained 10-minute device session. Report each unexecuted gate as
   unqualified; production GO requires physical evidence.

## Execution order

ADR-058 and `docs/voice-live.md` now define standalone-first Android with an
optional remote/offload transport. The local session bridge and controller
path have been traced and implemented; do not duplicate the agent/session
runtime or introduce LiveKit/WebRTC into same-device turns.

Next, acquire and verify a pinned Silero artifact, then integrate it with the
existing native ORT boundary and feed frame probabilities into the existing
bounded turn contract. Keep dictation unchanged. In parallel, prototype
Pocket's exported ONNX graph in an isolated Android arm64 harness, compare it
against the canonical implementation, and measure peak memory/latency on the
Xiaomi before selecting its production owner. Add Piper only after a tested
Android runtime and voice license are selected. Each step must keep its own
buildable commit and report physical gates separately from automated checks.

## Implementation progress

- Added a local transport branch to the shared Live controller. It bypasses the
  host grant and LiveKit room, while retaining the existing session/provider
  API, shared Live state, microphone lease and stop lifecycle.
- Added Android WebView capture with bounded endpointing, local Parakeet
  invocation, offline-installed Android system voice selection, and response
  interruption when speech resumes. Manual mobile read-aloud now uses the same
  offline-only TTS adapter, including pause, resume, cancellation and speed.
  Raw captured audio is passed only to the on-device Tauri command.
- Added session creation/reuse for voice-only chats and focused controller,
  session bridge, and endpointing tests.
- Load/download Parakeet before opening the microphone so the user is not
  recorded through model initialization and large first-use downloads.
- This is an implementation slice, not a qualified production path. The current
  VAD uses an RMS energy gate pending the Silero/native-runtime decision. The
  current TTS adapter requires an installed offline Android voice; Pocket TTS
  Android and licensed Piper fallback remain open. Android hardware execution,
  memory/thermal measurements, model language coverage, and a no-network local
  LLM conversation have not yet been verified.
