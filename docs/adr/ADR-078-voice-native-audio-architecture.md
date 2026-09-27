<!-- SPDX-License-Identifier: MIT -->
# ADR-078: Voice native audio architecture — Android Oboe rings + AudioClock

**Date**: 2026-09-27 | **Status**: Partially Implemented (G3 — physical consent / xrun / canonical playback / focus / routes / lifecycle / AEC remain open)

## Context

The pre-v2.2 Android Live path used WebView `getUserMedia` + deprecated `ScriptProcessorNode` + per-frame base64 WAV. That is unacceptable for production: the realtime callback sits in WebView JavaScript on the audio thread, frame transport through JS doubles latency, every turn re-wraps PCM as a WAV byte string, and there is no canonical audio clock, no xrun counter, and no path for AEC. §15 and §32 require a real native realtime path that compiles to Android and Windows, never blocks on model I/O, never allocates in the callback, and never carries raw audio through JavaScript frame strings.

## Decision

The realtime path is owned by `libvoice_audio.so` (Tauri/Android) using **Oboe** (Android AAudio/OpenSL ES backend) at **mono 48 kHz signed 16-bit little-endian PCM**, the canonical sample rate and format for the whole pipeline. Capture and playback each run in a bounded **lock-free PCM ring buffer** (single producer, single consumer, power-of-two capacity, monotonic read/write cursors, never `std::vector::push_back` in the callback). The canonical **AudioClock** is the Oboe monotonic position (`getFramesRead()` / `getFramesWritten()`), wrapped to milliseconds and exposed through the C ABI. Native stats (frames written, frames read, xruns, callback overruns) cross the C ABI and are mirrored into the TypeScript `audio` diagnostics surface once per second. Frames are retained by **utterance ID** in app data so the downstream Rust STT can read them directly — no per-frame transport through JavaScript, no WAV construction per turn, no base64.

The Tauri command surface exposes: `voice_audio_open` (mode: capture / playback / duplex, sample rate, channels, frames-per-burst), `voice_audio_read` (utterance id, max frames → PCM16), `voice_audio_write` (utterance id, PCM16), `voice_audio_close` (utterance id). All four are cancel-aware and never call model inference, filesystem I/O, logging, network, or the LLM from the Oboe callback.

The WebView `getUserMedia` path remains behind an explicit `legacy-webview-audio` flag for transitional builds only. The default Live path requires native audio; the flag is removed when G3 physical consent / xrun / canonical playback / focus / routes / lifecycle is green.

## Alternatives rejected

- **Direct AAudio via JNI without Oboe**: lower-level, requires re-implementing OpenSL ES fallback, drift buffer, and burst tuning per device.
- **WebAudio in WebView as the production path**: violates §15 — JS callback blocks, no canonical clock, no xrun, no AEC.
- **Java/Kotlin `AudioRecord`/`AudioTrack` with a Kotlin-side ring**: workable but bypasses the Tauri Rust core and forces a second platform-specific implementation. The Oboe Rust path already gives us a single realtime surface that compiles to Windows (via the WASAPI backend we wire next) and Android.

## Consequences

Android Live can stream native mono 48 kHz PCM into the Rust STT without JavaScript frame transport, retains canonical utterance-scoped buffers in app data, and exposes a monotonic clock for downstream cancellation, barge-in, and xrun accounting. Xiaomi Mi 10 Pro is the qualification device for this gate. The remaining gaps — physical microphone consent and frame movement, xrun proof, canonical TTS playback through the same Oboe path, audio focus, route switch (speaker / wired / Bluetooth), lifecycle (suspend / resume / screen lock), and AEC — are tracked in the G3 row of `docs/operations/voice-v2-autonomous-state.md` and block G9, G12, and the Windows Live path until closed.
