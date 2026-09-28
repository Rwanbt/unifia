<!-- SPDX-License-Identifier: MIT -->
# Pocket TTS 3.3.0 Windows Host Bakeoff

**Status:** host candidate evidence only. This does not qualify Android, the locked product package, or production TTS.

## Environment and method

- Source checkout: `voice` at `0630248ad81aeb8f917a8da36cb3a21435e6caa7`.
- Host: Windows x64; Python 3.12.13; PyTorch 2.14.0+cpu.
- Runtime: official `pocket-tts==3.3.0`, isolated from the product environment. The locked Voice Host remains on `pocket-tts==3.1.0`; `tokenizers==0.23.1` was reused from a separate local Python 3.12 environment because the locked venv does not contain it. This candidate environment is not yet reproducible from the product lock.
- Models: official six-layer language configs from the non-voice-cloning repository. HF artifacts were cached locally before measurement, so activation timings are warm-cache timings, not cold-install timings. The worker uses CPU PyTorch with `CUDA_VISIBLE_DEVICES` empty.
- Harness: the existing `scripts/voice/qualify-pocket-worker.py` protocol/stream/cancel/switch harness, run from an ignored temporary copy with `en`, `fr`, `es`, `it`, and `de` mapped to the six-layer configs. It generated non-empty 24 kHz mono PCM in all five languages, ran two 6-step language/voice switch cycles, cancelled an English generation, and synthesized again in the same worker.
- Benchmark JSON and worker log are retained under ignored `.build-temp/voice-v22/` for this workstation; they are not committed because they contain host-specific paths and process details.

## Immutable model identities

All five model files are 219,029,196 bytes. SHA-256 values below were computed from the downloaded files and match their HF cache blob identities. The upstream model repository reports `CC-BY-4.0`, `gated=false`, and language coverage `en`, `fr`, `de`, `pt`, `it`, `es` as of this run.

| Language | Weight revision | Weight SHA-256 | Tokenizer revision |
|---|---|---|---|
| English | `e7205b6ee50e654a5ea19f0e9df2b0813b05e921` | `916ccd2686e9311cb40054893a3c4284393d658825ffc714a276f3e9b152344f` | `00eac05ed3d16bdc3f6b5d598874019c34a89214` |
| French | `8843db76457a91db32077edf8dfcd1c0e3e755fd` | `32e575398f06a5dbca16a7dfb8048e3cd3440502d80b07089adfb3318f79dec2` | `8843db76457a91db32077edf8dfcd1c0e3e755fd` |
| Spanish | `4e1e0a3e611c51c0b4ed8174fc10f32a54644303` | `cbb0606d5d6976147f3343960b195ff94fde1f952e13ab6d9e097741ce5091c7` | `4e1e0a3e611c51c0b4ed8174fc10f32a54644303` |
| Italian | `4e1e0a3e611c51c0b4ed8174fc10f32a54644303` | `6af958c43372082b91af79d98d07d3fa3c2a2e41b628e5b119fdb46e19f0e49f` | `4e1e0a3e611c51c0b4ed8174fc10f32a54644303` |
| German | `4e1e0a3e611c51c0b4ed8174fc10f32a54644303` | `d2fabbc2c383d30ee29fcd374f8281406cc501b1d963fe687691f8573de3252b` | `4e1e0a3e611c51c0b4ed8174fc10f32a54644303` |

Upstream config and model card: [Kyutai Pocket TTS](https://huggingface.co/kyutai/pocket-tts), [non-voice-cloning weights](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning).

## Warm-cache CPU measurements

`RTFx` is generated audio duration divided by synthesis wall time. First PCM is measured from the beginning of each synthesis request. Activation time excludes the initial model download.

| Language | Activation | First PCM | RTFx | Peak worker RSS after activation |
|---|---:|---:|---:|---:|
| English | 1.123 s | 67 ms | 5.371x | 977 MiB |
| French | 5.942 s | 47 ms | 6.794x | 1,259 MiB |
| Spanish | 6.997 s | 52 ms | 5.454x | 1,274 MiB |
| Italian | 5.922 s | 51 ms | 7.007x | 1,274 MiB |
| German | 5.890 s | 47 ms | 6.950x | 1,274 MiB |

Across repeated language switches, observed worker peak RSS reached **1,781 MiB**. Cancellation was acknowledged **26.6 ms** after the request; **0 PCM chunks** arrived after cancellation, and the same worker synthesized successfully afterward. The discrete-GPU sample is system-wide and cannot be attributed to this worker.

## Findings and remaining gates

- Pocket 3.3 produces streaming PCM for all five mandatory languages on this Windows CPU host. First PCM was 47–67 ms and synthesis ran 5.37–7.01x faster than real time in this short-sentence fixture.
- A first isolated run failed loading the French YAML under Windows CP1252 (`UnicodeDecodeError` on a UTF-8 punctuation byte). The same five-language run passed after launching Python with `PYTHONUTF8=1`. The desktop managed-runtime launcher is being updated to set that mode for Python workers.
- The product lock still pins 3.1.0; this evidence is insufficient to upgrade the shipping runtime. Model quality/WER, sustained thermal behavior, and memory under a real desktop session remain unmeasured.
- No Android runtime was built or measured. Mi 10 Pro CPU latency, memory/thermal/battery, offline model installation, Android integration, and real audio output remain open. The result is not an Android or G7 PASS.
