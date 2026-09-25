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

## First execution order

After this plan is written, ADR-058 and `docs/voice-live.md` have been updated.
Next trace the Android prompt/event and playback APIs before adding the local transport.
Do not embed LiveKit server/WebRTC in the same-device path. Validate all
third-party artifacts, hashes, licenses, and language support before bundling.
