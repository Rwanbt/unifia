<!-- SPDX-License-Identifier: MIT -->
# Pocket TTS Android runtime portability study — 2026-09-27

**Status:** implementation study. Nothing here qualifies Android TTS.
Resolves campaign §23 (reopen the runtime bake-off) and §37 (portability
study). Supersedes the "Pocket Android deferred" ambiguity in the G7 row of
[voice-v2-autonomous-state.md](voice-v2-autonomous-state.md).

## 1. Upstream state (verified this session)

| Fact | Value | Source |
|---|---|---|
| Latest Pocket TTS | **3.3.0**, published 2026-09-24 | GitHub releases API, PyPI JSON |
| Product lock in repo | 3.1.0 (2026-09-03) — **2 releases behind** | repo lock |
| Code license | **MIT** | raw `LICENSE` on kyutai-labs/pocket-tts |
| Weights license | **CC-BY-4.0** | HF API `cardData` |
| Weights gating | `kyutai/pocket-tts` is `gated: "auto"` with a **Prohibited Use** clause; **`kyutai/pocket-tts-without-voice-cloning` is `gated=false`** | HF API |
| Architecture | **per-language models** selected by YAML config, not one multilingual model | 3.3.0 README `--language` |
| Languages shipped | en, fr, de, pt, it, es (+ nl in 3.3.0) | HF API `language` |
| Output rate | 24 kHz | sherpa-onnx `offline-tts-pocket-impl.h` |
| **Official ONNX export** | **none** | see §3 |
| **Official C/C++ runtime** | **none** | 3.3.0 README lists them as *community* projects |

The two architectural breaks are 2.0.0 (2026-04) and 3.0.0 (2026-08).
Anything built against ≤1.1.1 is stale.

## 2. Candidate runtimes — licences verified, not assumed

| Runtime | Licence | Android arm64 | Pocket-specific | Streaming | Verdict |
|---|---|---|---|---|---|
| **PocketTTS.cpp** | **MIT** | no CMake Android branch, but builds under NDK (proven by the JNI port below) | yes, single-file | **pipelined**, ~30 ms desktop TTFA, C API `ptt_stream_start/read/end` | **selected** |
| **PocketTTS-Android-Engine** | **MIT** | **yes** — ARM64-only, NDK 27.2, SDK 35, JNI + `TextToSpeechService` | yes | yes, streaming PCM | **adopted as the integration reference** |
| sherpa-onnx | **Apache-2.0** (not GPL) | partial — AAR published, but upstream does not claim Android for Pocket | yes | **sentence-level, not pipelined** | rejected for latency; viable fallback |
| ONNX Runtime | MIT | yes | runtime only | n/a | **selected host runtime** |
| LiteRT / AI Edge | Apache-2.0 | yes | yes | **no — "decode after generation (no streaming)"** | rejected (also GPU-first, EN-only) |
| Candle | MIT OR Apache-2.0 | no official Android target | partial, web-targeted port | unknown | rejected (highest effort, lowest certainty) |
| **Piper (maintained)** | **GPL-3.0** (`OHF-Voice/piper1-gpl`) | n/a | n/a | n/a | **excluded — cannot embed in the MIT app** |
| Piper (original) | MIT but **archived**, last push 2025-08-26 | n/a | n/a | n/a | excluded (dead) |

**Correction to a common assumption:** sherpa-onnx is **Apache-2.0, not GPL**.
The exclusion that actually binds is Piper, whose maintained line is GPL-3.0.
This confirms the repo's own contract note in
`packages/contracts/src/tts-router.ts` and campaign §26.

## 3. The blocking finding

`pocket-tts==3.3.0` **cannot export ONNX**. Verified by inspecting the installed
package used for the G7 bakeoff
(`.build-temp/pocket-v33-run/pocket_tts`):

- CLI entry points are `generate`, `serve`, `export-voice`
  (`main.py:395 export_voice` → `pocket_tts.models.model_state.export_model_state`).
- The only export serialises **voice embeddings** to safetensors. The neural
  weights stay in PyTorch/safetensors form.
- There is no `export-onnx` command and no ONNX symbol anywhere in the package.

**Consequence:** reaching Android requires a **third-party exporter** —
PocketTTS.cpp's bundled exporter (as used by PocketTTS-Android-Engine) or
sherpa-onnx's, whose own published Pocket models are v1-era (2026-01-26) and
therefore not compatible with 3.x graphs. Any such conversion is a *certified
artifact* obligation under campaign §38: canonical source, source revision,
conversion tool + version, conversion command, SHA-256, runtime ABI,
input/output contract, validation corpus, licence provenance.

## 4. The size finding

From the G7 bake-off
([pocket-tts-3.3-windows-bakeoff-2026-09-26.md](pocket-tts-3.3-windows-bakeoff-2026-09-26.md)),
every language weight is **219,029,196 bytes**:

| Language | Weight revision | Weight SHA-256 |
|---|---|---|
| English | `e7205b6ee50e654a5ea19f0e9df2b0813b05e921` | `916ccd2686e9311cb40054893a3c4284393d658825ffc714a276f3e9b152344f` |
| French | `8843db76457a91db32077edf8dfcd1c0e3e755fd` | `32e575398f06a5dbca16a7dfb8048e3cd3440502d80b07089adfb3318f79dec2` |
| Spanish | `4e1e0a3e611c51c0b4ed8174fc10f32a54644303` | `cbb0606d5d6976147f3343960b195ff94fde1f952e13ab6d9e097741ce5091c7` |
| Italian | `4e1e0a3e611c51c0b4ed8174fc10f32a54644303` | `6af958c43372082b91af79d98d07d3fa3c2a2e41b628e5b119fdb46e19f0e49f` |
| German | `4e1e0a3e611c51c0b4ed8174fc10f32a54644303` | `d2fabbc2c383d30ee29fcd374f8281406cc501b1d963fe687691f8573de3252b` |

Five mandatory languages therefore total **≈ 1.07 GB** of fp32 weights before
any ONNX conversion. This is the dominant packaging constraint and it must be
resolved by **on-demand per-language provisioning through the existing model
registry**, never by bundling weights in the APK. The registry already enforces
pinned SHA-256, size bounds, safe extraction and atomic promotion, so Pocket
enters through the same path as Parakeet rather than a bespoke downloader.

INT8 is available upstream (`quantize=True`, CPU-only dynamic quantisation) and
is the only credible way to bring this to a mobile-sane size, but it must be
measured for vocoder degradation rather than assumed.

## 5. What the weights are already doing on this machine

The five mandatory language models are **present in the local HF cache**, so
export experimentation needs no network and no HF gate acceptance:

```
C:\Users\barat\.cache\huggingface\hub\models--kyutai--pocket-tts-without-voice-cloning
  languages/<english|french|german|italian|spanish>/model.safetensors
  languages/<lang>/tokenizer.json
  languages/<lang>/embeddings/<voice>.safetensors
```

That layout is the **same per-language pack shape** PocketTTS-Android-Engine
imports. A pristine isolated `pocket_tts==3.3.0` install is also retained at
`.build-temp/pocket-v33-run` and `.build-temp/pocket-v33-site`.

Using the no-voice-cloning repository is also the honest choice for this
product: it avoids the upstream Prohibited-Use clause and means no capability
flag may ever advertise voice cloning (campaign §40).

## 6. CPU-first is validated by third-party device evidence

NekoSpeak (MIT, production Android app, ORT 1.18.0, CPU-only) reports that
**NNAPI and QNN are not viable for Pocket** because of dynamic shapes and
unsupported operators. That is independent confirmation of campaign §55/§6:
speech stays on CPU and must not attempt to steal accelerator headroom from the
local LLM.

## 7. Selected approach and the next exact experiment

**Approach:** PocketTTS.cpp (MIT) for inference, ONNX Runtime (MIT) on
Android arm64 CPU, integrated following the MIT PocketTTS-Android-Engine JNI
pattern, PCM surfaced through the canonical `TtsRouter` and native Oboe output.

**Risk accepted:** PocketTTS.cpp is a single-maintainer project (60★, last push
2026-03-29) and PocketTTS-Android-Engine self-describes as experimental
community software. The mitigation is that the repo owns the *certified
converted artifact* and its validation corpus, not the upstream wheel.

**Next exact experiment, in order (each step de-risks the next):**

1. Export English fp32 to ONNX with PocketTTS.cpp's exporter from the local
   cache, and record tool version + command + SHA-256 (§38 provenance).
2. Validate the exported graphs on the **host** against the eager PyTorch
   reference PCM before touching Android. Divergence here is 10× cheaper to
   debug than on-device.
3. Re-export as INT8 and A/B against the fp32 golden; measure vocoder
   degradation explicitly.
4. Repeat for fr/de/it/es, then register all five in the shared model registry
   with pinned digests so Android provisions them on demand.
5. Build the arm64 native library, wire JNI → `TtsBackend`, and measure TTFA,
   RTF, peak RSS and cancellation on Xiaomi Mi 10 Pro (`b7163823`).
6. Assert cancellation at ~200 ms into a long utterance: PCM callback stops,
   no further ORT session runs, native thread joins, next utterance unaffected.

## 8. Not verified this session

Stated plainly rather than assumed:

- No open-web discovery was available; all upstream claims came from direct
  fetches of GitHub/HF/PyPI APIs, so an unknown candidate may exist.
- `KevinAHM/pocket-tts-onnx-export` is linked from the official 3.3.0 README
  but **returns 404**; its fate is unknown.
- PocketTTS.cpp's source has **not** been compiled under the NDK here. ORT
  static-lib naming, `dl`/`pthread`, `dr_libs` and a patched SentencePiece are
  all plausible friction points.
- sherpa-onnx against 3.x Pocket graphs is untested; only 2026-01 v1-era models
  are published, and its config implies a v1 graph signature.
- Per-voice licences under `kyutai/tts-voices` were not checked individually;
  a community LiteRT card flags some derived voices as **CC BY-NC**, which
  would be disqualifying for distribution.
- No per-language APK size, Android RTF, TTFA or thermal figure exists yet for
  a 3.3.0 CPU build. Every Pocket number in this repository remains a **Windows
  host** measurement.
