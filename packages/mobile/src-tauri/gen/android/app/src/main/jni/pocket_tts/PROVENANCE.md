<!-- SPDX-License-Identifier: MIT -->
# Pocket TTS runtime — provenance

`pocket_tts.cpp` is the single-file runtime from
[VolgaGerm/PocketTTS.cpp](https://github.com/VolgaGerm/PocketTTS.cpp) (MIT, see
`LICENSE`), vendored at:

| | |
|---|---|
| Upstream commit | `e801e7d6c2692121a39e80ae525cb5265174a495` (2026-03-29) |
| Upstream file SHA-256 | `c9a844bd66c85d1a2831deb63b1ee61d0ab1c1a4810ce492378cb1c316fa289d` |
| Local patch | `scripts/voice/pocket-export/generated/pockettts-cpp-android.patch` |
| Vendored file SHA-256 | `c4795d6507fa00a8b60bbbfe98fb52a7a4d393cdfb00a36bb661bbf17b2417b8` |

The patch holds every local change; each is marked `UNIFIA` in the source:

- `flow_lm.bos_before_voice` is prepended to the voice prompt, as
  pocket-tts 3.1.0 does; without it the model stops speaking after a fraction
  of a second (see `docs/operations/voice-v2-autonomous-state.md`, G7).
- `ptt_set_text_options` sets a pack's text front-end: frames after EOS,
  short-input padding, `;` read as `,`, and sentences packed into chunks of
  at most N tokens. Upstream follows pocket-tts 1.x; the French 24-layer pack
  needs its pocket-tts 3.1 config (`french_24l.yaml`), set from
  `src/voice/pocket_tts.rs`.
- Terminal punctuation and capitalisation see two-byte Latin letters, so a
  sentence ending in "é" gets its period as it does in pocket-tts.
- An EOS trace behind `PTT_TRACE_EOS`, for diagnosis only.

`pockettts-cpp-bos-before-voice.patch` is the first change alone; it stays
because `docs/operations/pocket-onnx-export-evidence-2026-09-27.md` cites it.

The patch is generated (`git diff` from upstream to the vendored file), so it
lives under `generated/`. Reproduce: download the upstream file at the commit
above, run
`patch -p1 < scripts/voice/pocket-export/generated/pockettts-cpp-android.patch` next to
it, and compare the SHA-256.

Build dependencies are pinned by hash in `CMakeLists.txt`: the
onnxruntime-android 1.23.0 AAR (headers, matching the bundled
`libonnxruntime.so`), sentencepiece v0.2.1 and dr_libs `dfe83776`.
