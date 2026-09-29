<!-- SPDX-License-Identifier: MIT -->
# Pocket TTS runtime — provenance

`pocket_tts.cpp` is the single-file runtime from
[VolgaGerm/PocketTTS.cpp](https://github.com/VolgaGerm/PocketTTS.cpp) (MIT, see
`LICENSE`), vendored at:

| | |
|---|---|
| Upstream commit | `e801e7d6c2692121a39e80ae525cb5265174a495` (2026-03-29) |
| Upstream file SHA-256 | `c9a844bd66c85d1a2831deb63b1ee61d0ab1c1a4810ce492378cb1c316fa289d` |
| Local patch | `scripts/voice/pocket-export/pockettts-cpp-bos-before-voice.patch` |
| Vendored file SHA-256 | `53bc7dc20b85e4a34c1abe3b26ed8c3c01bfc274a166cfaf036a490be5c19cd7` |

The patch prepends `flow_lm.bos_before_voice` to the voice prompt, as
pocket-tts 3.1.0 does; without it the model stops speaking after a fraction
of a second (see `docs/operations/voice-v2-autonomous-state.md`, G7).

Reproduce: download the upstream file at the commit above, apply the patch
with `patch`, and compare the SHA-256.

Build dependencies are pinned by hash in `CMakeLists.txt`: the
onnxruntime-android 1.23.0 AAR (headers, matching the bundled
`libonnxruntime.so`), sentencepiece v0.2.1 and dr_libs `dfe83776`.
