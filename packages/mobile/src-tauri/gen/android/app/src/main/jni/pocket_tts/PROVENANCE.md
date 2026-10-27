<!-- SPDX-License-Identifier: MIT -->
# Pocket TTS runtime — provenance

`pocket_tts.cpp` is the runtime from
[VolgaGerm/PocketTTS.cpp](https://github.com/VolgaGerm/PocketTTS.cpp) (MIT, see
`LICENSE`), vendored at:

| | |
|---|---|
| Upstream commit | `e801e7d6c2692121a39e80ae525cb5265174a495` (2026-03-29) |
| Upstream file SHA-256 | `c9a844bd66c85d1a2831deb63b1ee61d0ab1c1a4810ce492378cb1c316fa289d` |
| Local patch | `scripts/voice/pocket-export/generated/pockettts-cpp-android.patch` |
| Vendored file SHA-256 | `0fedc4eb06ec81cefd9b91e873f648ba2914606305a1227fc58a963e182afbc2` |

The patch holds the local runtime changes, including the two helper headers:

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
- The noise generator is reseeded with a fixed value at each utterance, as the
  official runtime renders the same text identically; upstream seeds it once
  from the clock, so every reading of a message sounded different.
- Available-frame streaming batches, a 10 ms text-boundary overlap and
  exception-safe producer joining (`stream_audio.h`).
- Typographic apostrophes are canonicalized to ASCII before SentencePiece,
  so equivalent French elisions do not use byte fallback tokens
  (`text_normalization.h`). ASCII text and all other UTF-8 bytes are preserved.

`pockettts-cpp-bos-before-voice.patch` is the first change alone; it stays
because `docs/operations/pocket-onnx-export-evidence-2026-09-27.md` cites it.

The patch is generated (a unified diff from upstream plus helper headers), so it
lives under `generated/`. Reproduce: download the upstream file at the commit
above, run
`patch -p1 < scripts/voice/pocket-export/generated/pockettts-cpp-android.patch` next to
it, and compare the source SHA-256 and helper headers. Hash the LF-normalized
source if the checkout uses CRLF. Native regression tests are in
`stream_audio.test.cpp` and `text_normalization.test.cpp`; compile them as C++17
host executables (add `-pthread` for the streaming tests).

Build dependencies are pinned by hash in `CMakeLists.txt`: the
onnxruntime-android 1.23.0 AAR (headers, matching the bundled
`libonnxruntime.so`), sentencepiece v0.2.1 and dr_libs `dfe83776`.
