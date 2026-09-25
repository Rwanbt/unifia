<!-- SPDX-License-Identifier: MIT -->
# ADR-059: Voice portable Pocket TTS runtime — research findings (2026-09-26)

> Companion to [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md) and the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).
> Drafts the runtime decision for Pocket on Android. The hardware-gated
> selection (Phase 1 of the RFC) remains open until a Xiaomi with rebuilt
> APK measures the actual candidates side-by-side.

## Context

ADR-058 freezes Pocket as the primary TTS, Parakeet TDT 0.6B v3 as the
STT, and the desktop Python `voice_host` as the reference implementation.
ADR-058 also documents the mobile standalone-first requirement
(recorded 2026-09-25, superseding the earlier "paired desktop is
mandatory" position). The Voice v2 parity RFC states that the Android
local path must run the **same** pinned speech model families and voice
assets as desktop, not an RMS threshold and a WebView `speechSynthesis`
voice as it does today. R1 of the v2 plan ("Prove portable speech
inference before a production choice") asks for an evidence-based
runtime decision before any code is shipped.

## Research findings from upstream primary sources (2026-09-26)

### Kyutai Pocket TTS — upstream languages

The Kyutai [`pocket-tts`](https://github.com/kyutai-labs/pocket-tts)
README confirms Pocket currently supports **English, French, German,
Portuguese, Italian, Spanish**. Five of these — EN/FR/DE/IT/ES — match
the existing Unifia five-language contract. **Portuguese is a separate
product contract extension**; it must not silently become the Italian
or Spanish voice. Pocket is licensed **MIT** (the code); the model
weights and voice assets carry their own pinned licences (downloaded
artifacts; recorded with SHA-256 before any production use).

The reference runtime is the pinned Python `pocket-tts` CLI / library
used today on desktop. Pocket supports voice cloning from a short
reference audio clip; it does **not** require a reference transcript.

### sherpa-onnx — official Pocket support (the cheapest portable path)

[k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) lists
Pocket TTS under `k2-fsa/sherpa-onnx -> Text-to-speech (TTS) ->
PocketTTS` in its documentation tree, alongside KittenTTS,
SupertonicTTS, ZipVoice, Piper, MMS, VITS, Coqui. Its Rust API has a
`pocket_tts.rs` example.

The **only** officially released sherpa-onnx Pocket bundle is
`sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2` and **only covers
English**. The library's `examples` for Pocket in Python, C, C++, Rust,
Kotlin, Swift, Go, .NET and JavaScript all reference the same January
2026 English export.

sherpa-onnx also has multi-language STT candidates: Whisper, Moonshine,
Omnilingual ASR, SenseVoice, Cohere, FunASR Nano, Qwen3-ASR, Paraformer,
NeMo, FireRedAsr, Dolphin. These are documented separately from the
Pocket TTS gap and inform the R5 streaming STT bake-off, not this
ADR.

### sherpa-onnx — multilingual Pocket: known incompatibilities

[k2-fsa/sherpa-onnx issue #3755](https://github.com/k2-fsa/sherpa-onnx/issues/3755)
filed by `kcilam-dev` on 2026-07-12 reports the current sherpa-onnx
implementation only works with the **January English** bundle. The
reporter's local French build (`KevinAHM/pocket-tts-onnx` ->
`onnx/french_24l`, 24-layer fp32/int8) loads and runs but **truncates
audio**: a sentence that should be ~4 s of speech comes out as ~1 s.
The cause is `eos_logit` crossing the hardcoded `-4` threshold too
early; passing `frames_after_eos=8` via `extra` helps a little but the
output is still cut. The Kyutai upstream config for `french_24l`
recommends `model_recommended_frames_after_eos: 8` (vs `3`
hard-coded in sherpa-onnx).

The same issue covers the `lookbe/pocket-tts-onnx-v2` distilled
English/French v2 bundles: the KV-cache state inputs/outputs of
`flow_lm_main` and `mimi_decoder` are exported as **float16**, and
loading fails with
`offline-tts-pocket-model.cc:CreateZeroTensorLike:62 Unsupported tensor
element type: 10`. After wrapping the fp16 state I/O with `Cast` nodes
(fp32 outside, fp16 inside) the models load and run fast (~5× real
time on a desktop CPU), but the output is garbage: French continuous
babble until `max_frames` (40 s of audio per sentence, EOS never
fires); English v2 near-silence (RMS ~0.003) with EOS firing after a
few seconds.

The reporter's working hypothesis: the newer Kyutai exports
(`english_2026-04`, the `*_24l` previews, and the v2 distilled
models) come with a `bundle.json` and a `bos_before_voice.npy` that
the original January export did not, and the reference runtimes
(`pocket-tts-onnx` python) inject this BOS embedding **before** voice
conditioning. sherpa-onnx implements the January protocol only, so the
model is conditioned incorrectly. This would explain both failure
modes (early EOS on 24l, never-EOS babble on v2).

The reporter offered to test any branch or candidate bundle and
explicitly asked for either (a) sherpa-onnx to support the newer
export protocol (BOS-before-voice + fp16 KV states), or (b) upstream to
publish official sherpa-onnx bundles for the new languages.

**Decision input** : without (a) or (b), sherpa-onnx **cannot** host a
five-language Pocket runtime today. Adopting sherpa-onnx therefore
means either forking it (with all the upstream-compatibility and
regression-test overhead that implies) or accepting that Pocket on
Android falls back to the January English bundle only. Neither fits
the v2 parity goal.

### PocketTTS.cpp and LiteRT — alternative implementations

Kyutai lists the following alternative implementations in the
[pocket-tts README](https://github.com/kyutai-labs/pocket-tts#alternative-implementations):

- **PocketTTS.cpp** — Kyutai official C++ implementation on top of
  ONNX Runtime (C++ API). It is the most likely candidate to host the
  full multilingual export protocol on Android because (a) it is
  Kyutai-maintained, (b) it shares the python reference protocol by
  construction, and (c) ORT is already a pinned dependency in
  `packages/mobile/src-tauri/Cargo.toml` (`ort = 2.0.0-rc.10`).
- **LiteRT Android ports** — listed as a category; qualification needs
  to confirm multilingual equivalence, voice compatibility, licensing
  of all assets, and performance on the Xiaomi.
- Various third-party ports (ComfyUI, PocketTTS-Server, Wyoming
  protocol, OpenAI-compatible streaming servers, Wyoming for Home
  Assistant Voice). These are out of scope for production runtime
  qualification but useful as reference behavior.

### Silero VAD — Android/ARM

The
[Silero VAD FAQ](https://github.com/snakers4/silero-vad/wiki/FAQ)
confirms ARM/mobile/edge are supported via the ONNX export. Sampling
rates other than 8 kHz and 16 kHz are **not** supported by the
publicly documented model; the v2 plan's "16 kHz capture" assumption
is therefore aligned with Silero's own constraints.

## Decision (proposed)

1. **Do not** adopt sherpa-onnx for Pocket TTS on Android as the
   five-language runtime. The issue #3755 evidence is unambiguous:
   the only officially released bundle is January 2026 English, and
   every other community port hits either the `eos_logit = -4`
   truncation bug or the `fp16` KV-cache failure. Forking sherpa-onnx
   to add the BOS-before-voice conditioning and the fp16 state Cast
   nodes is a non-trivial undertaking with no proof of five-language
   parity. It is documented as a possible future effort, not a
   primary candidate.
2. **Qualify `PocketTTS.cpp`** (Kyutai official C++ / ORT) against the
   pinned Kyutai Python reference for EN/FR/ES/IT/DE. Five languages,
   same prompts, same authorized voice assets. Measure TTFA, RTF, peak
   RSS, CPU thread budget, JNI/ORT duplication (the mobile crate
   already owns ORT 2.0.0-rc.10), and APK size delta.
3. **If PocketTTS.cpp fails parity** on the Xiaomi: fall back to the
   Kyutai Python reference through a separate managed runtime process
   for English only, and surface a per-language capability gate in the
   settings UI. **Never** silently downgrade to Android system
   `speechSynthesis`; that path is the current transitional slice
   documented in `voice-current-state-2026-09-25.md`.
4. **VAD**: continue using Silero VAD ONNX, pinned revision, 16 kHz
   capture, threshold parity between desktop Silero and Android Silero
   confirmed by a deterministic replay fixture (input PCM → expected
   probability sequence).

## Consequences

- PocketTTS.cpp pulls another ONNX Runtime binary into the APK. The
  existing `ort = 2.0.0-rc.10` Rust binding may force a version
  reconciliation. Add a startup ABI diagnostic that records
  `ort_version`, `pocket_runtime_version`, model SHA-256 and refuses to
  start if any check fails.
- Five-language parity becomes a documented gate, not a vague goal.
  Any language that fails parity is removed from the supported set in
  the audio settings UI; settings do not silently lie.
- The Android transitional slice (WebView `speechSynthesis` /
  `speechSynthesis` voice marked `localService`) remains the runtime
  until PocketTTS.cpp (or a future sherpa-onnx fork) passes parity.
  This keeps the current Android app usable on five languages while the
  portable Pocket work proceeds.

## Open evidence requirements (Phase 1 gate)

- Five-language Pocket samples through PocketTTS.cpp on the Xiaomi
  with the same prompt and reference audio as the Python reference.
- RMS comparison vs Kyutai Python reference output per language.
- TTFA, RTF, peak RSS, JNI/ORT conflict audit, APK size impact.
- ABI diagnostic added at startup, no false start.
- SHA-256 of every model artifact recorded before the parity run.

## Status

**DRAFT** — not adopted. This ADR is a research snapshot produced in
parallel with the R1 phase of the v2 parity plan. The PocketTTS.cpp
qualification requires a Xiaomi with rebuilt APK and real audio
playback; it is not exercisable from this 01:17 CEST session without
that hardware. The decision stands once the parity evidence is
recorded and a follow-up ADR amends it with measured numbers.

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md) — Voice runtime
  baseline (Pocket primary, Piper fallback, Parakeet STT, LiveKit
  transport, mobile standalone-first).
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
  — v2 parity RFC, sections 1 and 4 in particular.
- [voice-current-state-2026-09-25.md](../voice-current-state-2026-09-25.md)
  — verified current state, Android NO-GO / unqualified.
- [voice-runtime-baseline.md](../voice-runtime-baseline.md) — Wave A
  through Wave D evidence.
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)
  — physical gate blockers for this session.
- [kyutai-labs/pocket-tts](https://github.com/kyutai-labs/pocket-tts)
  — upstream reference.
- [k2-fsa/sherpa-onnx Pocket TTS docs](https://k2-fsa.github.io/sherpa/onnx/tts/pocket.html)
  — only the English January bundle is officially released.
- [k2-fsa/sherpa-onnx issue #3755](https://github.com/k2-fsa/sherpa-onnx/issues/3755)
  — multilingual Pocket incompatibility evidence.
- [snakers4/silero-vad FAQ](https://github.com/snakers4/silero-vad/wiki/FAQ)
  — mobile/ARM support, 8/16 kHz constraint.