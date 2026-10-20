<!-- SPDX-License-Identifier: MIT -->

---
id: 1051
title: Audio processing runs on the CPU and on the device; the GPU is reserved for the local LLM
status: PROPOSED
date: 2026-10-20
related: [1050]
issue: 799
---

# ADR-1051: Audio processing runs on the CPU and on the device; the GPU is reserved for the local LLM

## Context

The owner requires that all audio processing (capture, voice activity
detection, turn detection, speech-to-text, text-to-speech) runs locally, on the
CPU, on the user's PC or phone. Speech audio must not leave the device for
privacy reasons.

The local LLM server (`llama-server`) runs on the GPU and needs its VRAM. Audio
models placed on the GPU would compete with it for the same memory, and a
GPU-resident audio model can starve the LLM during a dictation.

Current state, verified on 2026-10-20:

- Parakeet TDT 0.6B (speech-to-text), Silero VAD and Smart Turn run through
  ONNX Runtime on the CPU, in-process, on the device (`packages/mobile/src-tauri/src/speech.rs`,
  `packages/mobile/src-tauri/src/voice/`).
- Pocket TTS runs on the CPU (`PocketTTS.cpp`, ONNX Runtime CPU provider).
- Prompt dictation on Android does **not** use that engine. It uses the WebView
  `SpeechRecognition` API (`packages/app/src/hooks/web-speech.ts`), served on
  Android by the Google on-device recognizer, while the settings screen shows
  "Parakeet". This is issue #799.

`CLAUDE.md` currently says "GPU acceleration is mandatory. Never suggest
CPU-only as a solution." That rule conflicts with this decision for the audio
subsystem. It is recorded here as a policy conflict and is not resolved
silently: the owner decision below overrides it for audio only, and the
`CLAUDE.md` line must be updated by the owner.

## Decision

1. Every audio stage executes on the CPU. No GPU execution provider (CUDA,
   DirectML, CoreML, Vulkan) is registered for audio models, and no audio stage
   allocates VRAM.
2. Audio never leaves the device. Dictation and read-aloud must not use a
   browser or operating-system speech service that may be cloud-backed. The
   WebView `SpeechRecognition` API is not an allowed dictation engine on
   Android.
3. The GPU and its VRAM are reserved for the local LLM server.
4. The CPU thread budget for audio is bounded so the application and the LLM
   keep cores. The bound is set per platform and measured on device, not
   guessed.
5. The rule covers the mobile (Android) audio paths. The desktop dictation path
   is audited separately (to be filed as its own issue).

## Rejected alternatives

- **GPU execution provider for Parakeet, VAD or TTS.** Faster in isolation, but
  it competes with the local LLM for VRAM, which is the scarce resource here.
- **Browser or operating-system speech recognition** (WebView
  `SpeechRecognition`, Google on-device recognizer). Not under the application's
  control, can be cloud-backed, and bypasses the configured engine. This is the
  behaviour issue #799 corrects.
- **Cloud speech-to-text.** Violates the privacy requirement.

## Consequences

- Speech-to-text latency depends on CPU throughput. Parakeet TDT 0.6B on the
  CPU must be measured on the target devices. If it is too slow for dictation,
  the answer is a smaller CPU model, decided in a follow-up ADR, not a GPU
  path.
- The first dictation may download the model (about 670 MB) when it is missing.
  The app must say so and keep working offline once it is installed.
- `CLAUDE.md` needs the owner's update so that the GPU rule no longer covers
  audio. Until then this ADR stays `PROPOSED`.
- The acceptance criteria of issue #799 include a measured delay from stop to
  inserted text, on a real spoken sentence, on device.
