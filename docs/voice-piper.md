<!-- SPDX-License-Identifier: MIT -->
# Piper TTS fallback

Unifia runs Piper through the supervised `piper-host` JSONL subprocess. The
application core communicates with that process over stdin/stdout; it does not
link the Piper runtime into the MIT desktop binary. The host pins
`piper-tts==1.8.0` under GPL-3.0-or-later and installs only locked Python 3.12
CPU dependencies. Voice files are downloaded on demand and are never bundled.

## Pinned voice catalog

All model and config hashes below are SHA-256 values from the immutable
`rhasspy/piper-voices` revision
`c10ece1aade47bb51c153c893d14e5bf8e5b7117`. The catalog in
`packages/piper-host/piper_host/catalog.py` is the runtime source of truth.

| Provider | Language | Voice | Model license and dataset | Model SHA-256 | Config SHA-256 |
|---|---|---|---|---|---|
| Piper | EN | `en_US-ljspeech-medium` | MIT repository artifact; LJSpeech dataset is public domain | `6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22` | `141d612cc0a95ed7efc1ca936b845c2364967f2e9217c5dbfcf69fc4d6c65860` |
| Piper | FR | `fr_FR-mls-medium` | MIT repository artifact; MLS dataset CC-BY-4.0, trained from scratch | `0ed223f78466917f2bae05ee90096ce69ab1fdeb251f55590d0e7422d234e162` | `252b0b0a6e4cc4949e23eccb956f9c779986c32f934f2f7e2191e5fdc2edca61` |
| Piper | ES | `es_ES-carlfm-x_low` | MIT repository artifact; public-domain dataset, trained from scratch | `d69677323a907cd4963f42b29c20a98b5d6bfa7f3e64df339915e4650c00d125` | `d9bdfa9ff01eb2bc9e62e7d2593939d1e4c4d8eb7cf75f972731539d12399966` |
| Piper | IT | `it_IT-riccardo-x_low` | MIT repository artifact; M-AILABS dataset terms allow commercial redistribution with attribution and prohibit endorsement | `1368de15f123275a7ef951c9e5e30be0f58a032daa14a0da44037443c1d1d21b` | `146ab9c634afe524e9fb7530f2510df7a42fb1db56b52658ca1fb3d98001a62a` |
| Piper | DE | `de_DE-mls-medium` | MIT repository artifact; MLS dataset CC-BY-4.0, trained from scratch | `69cd1d2aa5a35839a518966fcc4924b5f93e5f8c948ed0752b1a616ad53f65bf` | `b0af1c89ddfdc72d32e015729b0e89b99eec13c2c8caa1db7488d98e9e570b40` |

Each manifest links to its exact model card, which records its creator,
dataset, license, and source. The Italian model card points to the M-AILABS
dataset terms; preserve attribution and the no-endorsement condition wherever
that artifact is redistributed. This engineering record is not legal advice.

## Runtime guarantees

- Pocket remains primary in `auto`; Piper is attempted only after Pocket fails.
- An explicit provider selection stays explicit. Pocket voice clones are never
  represented as Piper voices.
- Runtime and voice artifacts are pinned, SHA-256 checked, and installed by
  atomic replacement. Failed or cancelled downloads leave no installed file.
- Only the selected language model is downloaded. Health checks require the
  ONNX `CPUExecutionProvider` and reject other execution providers.
- The worker has a bounded request queue, cancellation IPC, deterministic
  shutdown, and one restart attempt after an unexpected process exit.

Spanish and Italian currently use `x_low` catalog artifacts. Their quality
must be evaluated alongside medium voices before replacing these legal pins.

## Local qualification — 2026-09-24

The checked-in qualification runner is `scripts/voice/qualify-piper.py`; its
machine report and downloaded model files stay under `.build-temp/`. This run
verified the active session provider list was exactly
`CPUExecutionProvider`, generated non-silent PCM for all five languages, and
recorded:

| Language | Voice preparation | TTFA after preparation | RTF | CPU seconds | Peak worker RSS | Native sample rate |
|---|---:|---:|---:|---:|---:|---:|
| EN | 1,588.0 ms | 126.7 ms | 0.052 | 0.953 | 194.4 MiB | 22,050 Hz |
| FR | 1,105.3 ms | 120.5 ms | 0.030 | 1.234 | 283.8 MiB | 22,050 Hz |
| ES | 1,658.0 ms | 51.9 ms | 0.025 | 0.453 | 291.8 MiB | 16,000 Hz |
| IT | 1,727.7 ms | 57.6 ms | 0.024 | 0.625 | 291.8 MiB | 16,000 Hz |
| DE | 1,083.4 ms | 195.2 ms | 0.033 | 2.031 | 304.0 MiB | 22,050 Hz |

First-use time to audio is voice preparation plus TTFA after preparation; the
table reports both parts separately. Runtime installation and model download
are not included in these inference measurements. CPU seconds sum worker
threads, so CPU utilization can exceed 100% on a multicore CPU.

The GPU sampler observed a 0 MiB device-level delta and the worker itself has
no GPU execution provider. Device-level sampling can include unrelated GPU
activity. CPU time is summed across ONNX worker threads, so it can exceed wall
time. This run checks that audio is present and non-silent; it is not a
subjective pronunciation or voice-quality review.
