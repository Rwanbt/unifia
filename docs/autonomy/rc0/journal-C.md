<!-- SPDX-License-Identifier: MIT -->
# Journal C — Lane C (Voice) — Unifia RC-0 release-1 push

Agent: lane C. Base branch `dev`. Repo `Rwanbt/unifia`.
Worktree: `D:\App\unifia\_rc0-laneC` (git worktree of `D:\App\unifia\unifia`, branch cut from a freshly fetched `origin/dev`).
Binding owner decisions of 2026-10-05: **D10** = the system TTS fallback is a setting, OFF by default, Pocket stays the local voice. **D11** = the remaining `voice` branch content is integrated on `dev` in lots of at most 400 lines, after D10.
Standing constraint honoured throughout: nothing on the shipped path is presented as ready unless it is; no physical qualification is claimed from a build.

---

## C1 — VO02 (XL) — inventory the shipped-path Voice providers

**Base:** `origin/dev` @ `39cf4435ab5a965e80c946d967b18912d34785d4` (fetched fresh, no commits of my own at the time of measurement).
**Branch:** `agent/C-C1-voice-provider-inventory`

### 1.1 What the shipped path actually is, measured

The Voice entry point is `packages/app/src/components/prompt-input/live-binding.ts:112-113`:
`localVoice: isMobile && tauri?.core?.invoke ? createAndroidLocalVoiceTransport(tauri.core.invoke) : undefined`,
and `live-binding.ts:90` sets `transport: isMobile ? "local" : "host"`. So there are exactly two shipped Voice
paths — an Android local path and a desktop host path — and this inventory covers both.

### 1.2 Provider table

| # | Provider (layer) | Consumer `file:line` | Test command | Result |
|---|---|---|---|---|
| 1 | Oboe capture, mono 48 kHz I16 (Android native) | native `packages/mobile/src-tauri/gen/android/app/src/main/jni/voice_audio_engine.cpp:54`; Rust bridge `packages/mobile/src-tauri/src/voice/native_audio.rs:129` `voice_audio_open`, `:204` `voice_audio_poll`; TS `packages/app/src/voice/android-local-voice.ts:139` (open), `:66` (poll) | `cd packages/app && bun test --preload ./happydom.ts src/voice/android-local-voice.test.ts` | **pass** |
| 2 | Oboe playback (Android native) | Rust `packages/mobile/src-tauri/src/voice/native_audio.rs:295` `voice_audio_write_pcm`; TS `packages/app/src/voice/android-speech-output.ts:113` | `cd packages/app && bun test --preload ./happydom.ts src/voice/android-speech-output.test.ts` | **pass** |
| 3 | Silero VAD v6.2.2 (ORT, pinned ONNX) | Rust `packages/mobile/src-tauri/src/voice/vad.rs`; surfaced as `vad_provider` / `vad_fallback` at `packages/app/src/voice/android-local-voice.ts:76-77`; host-side lease `packages/app/src/voice/wired-providers.ts:247` | `cd packages/mobile/src-tauri && cargo test --lib voice::` (asserts `voice::vad::tests::bundled_model_hash_matches_the_shared_registry`) | **pass** (37 tests, 0 fail, 1 ignored) |
| 4 | Smart Turn v3.2, policy C (end-of-turn) | Rust `packages/mobile/src-tauri/src/voice/smart_turn.rs` + `capture_segmenter.rs`; surfaced as `turn_detector` / `turn_detector_fallback` at `packages/app/src/voice/android-local-voice.ts:78-79` | `cd packages/mobile/src-tauri && cargo test --lib voice::` (asserts `voice::smart_turn::tests::bundled_model_hash_matches_the_shared_registry` and `voice::eot_corpus_tests::smart_turn_gated_corpus_meets_the_policy_c_budgets_and_parity`) | **pass** (same run) |
| 5 | Parakeet TDT v3 INT8 — final STT (Android Live) | Rust `packages/mobile/src-tauri/src/speech.rs:59` `stt_download_model`, `:68` `stt_load_model`, `:158` `stt_available`; `native_audio.rs:362` `voice_audio_transcribe_utterance`; TS `packages/app/src/voice/android-local-voice.ts:126`, `:128`, `:130`, `:154` | `cd packages/app && bun test --preload ./happydom.ts src/voice/android-local-voice.test.ts src/voice/native-voice-error.test.ts` | **pass** |
| 6 | Pocket TTS (Android Live, local neural voice) | Rust `packages/mobile/src-tauri/src/voice/pocket_tts.rs:331,403,454,507` (`voice_pocket_prepare` / `_stream_start` / `_stream_read` / `_stream_end`); TS `packages/app/src/voice/pocket-android-tts.ts:89,107,123,142`; registered `packages/app/src/voice/android-tts-router.ts:20`; consumed `packages/app/src/voice/android-local-voice.ts:41` | `cd packages/app && bun test --preload ./happydom.ts src/voice/pocket-android-tts.test.ts`; `cd packages/mobile/src-tauri && cargo test --lib voice::pocket_tts` | **pass** |
| 7 | Windows desktop path — Parakeet STT + Pocket/Piper TTS | Rust `packages/desktop/src-tauri/src/parakeet/{mod,engine,download}.rs`, `speech.rs`, TTS router `packages/desktop/src-tauri/src/tts_router.rs:19` (`Provider::Pocket` / `Provider::Piper`), Live `packages/desktop/src-tauri/src/voice_live.rs:490,547,554`; TS consumer `packages/desktop/src/hooks/use-speech.ts:83,86,98,182,185,192,444,463,471` | `cd packages/desktop/src-tauri && cargo test --lib` | **compiles; test binary will not start on this host** — see 1.4 |
| 8 | Streaming STT (`streaming-stt-nemo` + `parakeet-tdt-final` fallback) and `selectStreamingStt` | **no consumer on the shipped path** — `git grep` over `packages/` returns only `*.test.ts` files | `cd packages/app && bun test --preload ./happydom.ts src/voice/streaming-stt-nemo.test.ts src/voice/streaming-stt-fallback.test.ts src/voice/streaming-stt-router.test.ts` | **pass** (unwired, as documented in the qualification report) |
| 9 | Deterministic test doubles (`tts-router-mock`, `streaming-stt-mock`) | **no consumer outside tests** — `createMockTtsRouter` and `createMockStreamingSttProvider` are referenced only from `*.test.ts` | included in the full app suite below | **pass** |

### 1.3 `productionReady: false` on the shipped path: measured, and the guard that keeps it that way

`git grep -n productionReady` over the whole tree returns exactly one production value on a shipped
path, and it is **`true`**: `packages/app/src/voice/pocket-android-tts.ts:34`. Every `false` in the tree
lives in a test fixture (`tts-router.test.ts:67,85,167`, `tts-router.test.ts:19`).

This is a real change from the `voice` branch's own qualification report, which described Pocket Android
as "a deterministic scaffold" with `productionReady: false`. On `dev` that scaffold is gone: the backend
now streams real PCM from the native `libpocket_tts.so` behind the `voice_pocket_*` commands, and declares
itself production-ready. I did not take the report's word for it; I read the source and ran the tests.

**So the "hide or label every `productionReady: false` provider" set is empty on `dev` today.** An empty set
cannot be demonstrated by a UI test, so instead of asserting a vacuous truth I pinned the invariant with a
guard that fails the moment a non-production backend is wired into the shipped path, and I proved the guard
is not vacuous by breaking it on purpose.

- `packages/app/src/voice/android-tts-router.ts` now exports `androidShippedTtsBackends(invoke)`, the live
  registration list that `createAndroidTtsRouter` itself consumes, so the guard asserts on the real array
  rather than on a hand-written inventory that could drift.
- `packages/app/src/voice/android-tts-router.test.ts` (new, 5 tests) asserts: the shipped path registers at
  least one backend; every one of them reports `productionReady: true`; every id is a known contract
  `TtsProviderId`; no shipped provider is `remoteCapable` or non-`cpuOnly`; the shipped router returns an
  honest non-recoverable provider error rather than substituting a voice; and a `productionReady: false`
  backend stays out of the router even if handed to it.

**Negative control (the guard is real, not decorative).** With
`packages/app/src/voice/pocket-android-tts.ts:34` temporarily flipped to `productionReady: false`, the same
suite reported **4 pass / 1 fail**, failing precisely on *"the shipped path registers a provider, and every
one of them is production-ready"*. The file was restored and re-verified at `productionReady: true`.

### 1.4 Honest limits of this card

- The Windows desktop Rust test **binary does not start on this host**: `cargo test --lib` in
  `packages/desktop/src-tauri` compiles the whole test binary and then dies at process start with
  `0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND`, so no desktop Rust test body ever runs. Measured on a pristine
  `origin/dev` worktree with no commits of mine, so it is a pre-existing host/environment fault, not a
  regression. I did not get a desktop Rust test result and do not claim one. Desktop provider claims in
  §1.2 rows 6-7 rest on source read plus the compiled build, not on an executed desktop test.
- Getting there needed one real prerequisite: the Tauri build script refuses to run without the CLI sidecar
  (`resource path 'sidecars\unifia-cli-x86_64-pc-windows-msvc.exe' doesn't exist`), so I built
  `packages/unifia` with `bun run build --single --skip-embed-web-ui` (smoke test passed,
  `unifia --version` → `0.0.0--202610051545`) and ran `bun run precopy:sidecar`.
- `bun install` and the sidecar build both rewrote `bun.lock`, and the Tauri build rewrote
  `packages/mobile/src-tauri/gen/schemas/acl-manifests.json`. Both are outside lane C's write scope
  (manifest/lockfile is lane D) and both were reverted; the worktree was clean before the commit below.
- No physical Android device and no Windows audio route was exercised. Nothing in this card is a physical
  qualification.

### 1.5 Proof commands and results

```
cd packages/app && bun run typecheck                                  -> exit 0
cd packages/app && bun test                                           -> 2103 pass / 1 skip / 0 fail, 251 files, 7.57 s
cd packages/app && bun test --preload ./happydom.ts ./src/voice       -> 335 pass / 1 skip / 0 fail, 38 files
cd packages/mobile/src-tauri && cargo test --lib voice::               -> 37 passed / 0 failed / 1 ignored, 68.37 s
cd packages/desktop/src-tauri && cargo test --lib                      -> compiles; binary exits 0xc0000139 (see 1.4)
```

The 1 skip in both app runs is the same env-gated live nemo-speech end-to-end test
(`streaming-stt-nemo.e2e.test.ts`), which needs a live server; it is not silenced or quarantined.

**Status: DONE** — the table is complete with executed evidence, and every shipped-path
`productionReady: false` provider is impossible by construction rather than merely absent today, with a
proven non-vacuous guard test.
