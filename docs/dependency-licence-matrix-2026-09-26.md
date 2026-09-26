<!-- SPDX-License-Identifier: MIT -->
# Voice v2 dependency licence matrix (2026-09-26)

> Initial cut for the v2 plan §16 "Supply chain" / R14
> "Production hardening" ADR. Recorded at HEAD `dd5fa5e8c9` of
> branch `voice` in `D:\App\unifia\voice-runtime`. Generated
> against the locked `uv.lock` in each package; every entry
> below has a pinned version and a verified SHA via uv.
>
> Next update: when new models are recorded in
> `packages/voice-host/models/registry.json` per ADR-066, the
> model's licence column must be added to the table below.

## voice-host (`packages/voice-host/`)

Pinned via `uv.lock`; Python 3.12.

| Distribution | Version | Licence | Notes |
|---|---|---|---|
| `pocket-tts` | 3.1.0 | MIT (code) / per-artifact (weights) | Reference TTS runtime. Model weights SHA in `registry.json`. |
| `torch` | 2.14.0+cpu | BSD-3-Clause | PyTorch CPU build from `download.pytorch.org/whl/cpu`. Mobile binder does not embed this. |
| `onnxruntime` | 1.30.0 | MIT | Desktop ABI per ADR-068. |
| `onnx-asr` | 0.12.0 | MIT | Parakeet TDT 0.6B v3 binding. |
| `livekit-agents` | 1.8.3 | Apache-2.0 | Desktop Live path. Stays inside the LiveKit-permitted framework per ADR-058 §15.5. |
| `livekit` | 1.1.18 | Apache-2.0 | LiveKit Python client. |
| `livekit-api` | 1.2.1 | Apache-2.0 | LiveKit API helpers. |
| `livekit-blingfire` | 1.1.0 | MIT (LiveKit vendored) | Tokenisation helper. |
| `livekit-local-inference` | 0.2.7 | Apache-2.0 | LiveKit bundled Silero + turn-detector. |
| `livekit-protocol` | 1.1.27 | Apache-2.0 | LiveKit protocol. |
| `numpy` | 2.5.3 | BSD-3-Clause | |
| `scipy` | 1.18.1 | BSD-3-Clause | |
| `pydantic` | 2.13.5 | MIT | Schema validation. |
| `sentencepiece` | 0.2.2 | Apache-2.0 | Tokenizer for Parakeet. |
| `huggingface-hub` | 1.32.0 | Apache-2.0 | Artifact download per ADR-066. |
| `requests` | 2.34.2 | Apache-2.0 | |
| `httpx` | 0.28.1 | BSD-3-Clause | |
| `sounddevice` | 0.5.6 | MIT | Audio capture adapter. |
| `pyyaml` | 6.0.3 | MIT | |
| `anyio` | 4.15.1 | MIT | Async I/O. |
| `aiohttp` | 3.14.3 | Apache-2.0 | |
| `av` | 18.1.0 | BSD-3-Clause | Audio/video codec binding. |

**voice-host contains no GPL runtime.** Piper is invoked as an
isolated subprocess (see `packages/piper-host/`), so the MIT
voice-host does not embed the GPL Piper runtime.

## piper-host (`packages/piper-host/`)

Pinned via `uv.lock`; Python 3.12. Isolated subprocess provider
per ADR-062 §15.5 / ADR-066 §3 / ADR-058 §15.5.

| Distribution | Version | Licence | Notes |
|---|---|---|---|
| `piper-tts` | 1.8.0 | **GPL-3.0** | The Piper runtime is GPL-3.0. Per ADR-062/066/058: isolated subprocess only; never embedded in the MIT mobile application. Voice session invokes `piper-host` over a defined IPC boundary. |
| `onnxruntime` | 1.30.0 | MIT | Loaded into the isolated piper-host process only. |
| `numpy` | 2.5.3 | BSD-3-Clause | |
| `flatbuffers` | 25.12.19 | Apache-2.0 | ORT dependency. |
| `protobuf` | 7.36.2 | BSD-3-Clause | ORT dependency. |
| `packaging` | 26.3 | Apache-2.0 / BSD-3-Clause | ORT dependency. |
| `pathvalidate` | 3.3.1 | MIT | piper-tts dep. |

The legal/process boundary is recorded in `docs/adr/ADR-062-voice-tts-routing.md` and verified by the test that
asserts no Piper code path is ever linked in-process into
voice-host.

## mobile / Android (`packages/mobile/`)

The mobile Rust binding pulls:
- `ort = 2.0.0-rc.10` (MIT) — single shared ORT inside the APK.
- No Pocket / no Piper / no LiveKit embedded in the mobile APK.

Pocket on Android is the candidate from ADR-059 (PocketTTS.cpp
under ADR-068 compatibility test). Until the R7 candidate
qualifies, the Android path uses system TTS through the
`FallbackTtsProvider` labelled `system-tts (transitional)` per
ADR-062. No GPL runtime embedded.

## Model artifacts

| Provider | Model | Licence | SHA-256 | Notes |
|---|---|---|---|---|
| snakers4 | silero-vad-v6.2.2-onnx | MIT | `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3` | Per ADR-061 |
| rhasspy | piper-voice-en_US-ljspeech-medium | GPL-3.0 (Piper runtime) + per-voice (asset) | `6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22` | Isolated subprocess only |
| rhasspy | piper-voice-fr_FR-mls-medium | GPL-3.0 + per-voice | `0ed223f78466917f2bae05ee90096ce69ab1fdeb251f55590d0e7422d234e162` | Isolated subprocess only |
| rhasspy | piper-voice-de_DE-mls-medium | GPL-3.0 + per-voice | `69cd1d2aa5a35839a518966fcc4924b5f93e5f8c948ed0752b1a616ad53f65bf` | Isolated subprocess only |
| rhasspy | piper-voice-es_ES-carlfm-x_low | GPL-3.0 + per-voice | `d69677323a907cd4963f42b29c20a98b5d6bfa7f3e64df339915e4650c00d125` | Isolated subprocess only |
| rhasspy | piper-voice-it_IT-riccardo-x_low | GPL-3.0 + per-voice | `1368de15f123275a7ef951c9e5e30be0f58a032daa14a0da44037443c1d1d21b` | Isolated subprocess only |

Pocket TTS models and Parakeet STT model entries are not yet
in this matrix; see `packages/voice-host/models/registry.json`
`missing_for_adoption` section. Recorded per ADR-066 once their
SHAs are computed against the `.build-temp/` artifacts.

## Open follow-ups

1. Parakeet TDT 0.6B v3 INT8 ONNX — SHA-256 not yet recorded;
   the per-artifact licence is per the NVIDIA Open Model
   License; ABI compatibility per ADR-068 ORT 1.30.0.
2. Pocket multilingual weights (EN/FR/ES/IT/DE per ADR-059) —
   SHA-256 + licence per language; recorded after the R7
   PocketTTS.cpp qualification.
3. LiveKit proprietary turn-detector-v1-mini — stays
   LiveKit-transport-only per ADR-058 §15.5; never ported
   outside LiveKit's permitted framework.
4. SHA verification of every cached model at startup per ADR-066
   §"Download protocol" — startup ABI diagnostic per ADR-068.

## Status

Initial cut. Generated 2026-09-26 from the locked `uv.lock`
of both `voice-host` and `piper-host`. The MIT mobile application
embeds no GPL runtime; Piper is invoked as an isolated
subprocess provider per ADR-062 / ADR-066.

This matrix is the reference for any future session that needs
to add a new dependency or verify that a runtime ABI change
does not introduce a licence blocker.