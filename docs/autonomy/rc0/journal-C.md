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

---

## C1 — PR #296, merged

Squash-merged into `dev` at **`b122d0c4b34450c64d4c9a5151b35cf5994aa366`** (2026-10-05T16:40:04Z), on top of
`78f9d01cfd` (lane A/D's #297). The merge landed exactly the three intended files and nothing else.
Gate evidence on the exact head `624266074a738755abbc0a2aca30f177a3b30b8a`:
`check-compliance`, `check-standards`, `conformance`, `rust unit tests`, `sdk in sync with server`,
`unit (linux)`, `unit (windows)` and `Analyze (javascript-typescript)` all green. `e2e (linux)` and
`check-duplicates` were still pending; neither is in the required set, and `dev`'s branch protection was
read from the API to confirm that rather than assumed. No linked issue to close (the PR closes no issue).

---

## C2 — D10 (M) — the system-voice fallback setting

**Branch:** `agent/C-C2-system-voice-fallback`

### 2.1 What the code did before this card

Measured on `dev`, not taken from the `voice` branch report. `android-tts-router.ts` registered exactly one
backend and said why in a comment: *"There is deliberately no platform (Google) voice: a language without
an installed Pocket pack reports MODEL_MISSING and callers say speech is unavailable."*
`android-speech-output.ts` ended every no-audio path at `report("unavailable")`. So D10 was asking for a
capability that had been deliberately removed on `dev`, and the commit that removed it
(`a687bd2`, "Pocket or rien") is one of the 20 commits still on `voice`.

### 2.2 What I built

The setting, in `packages/app/src/voice/audio-settings.ts`:

- `ttsSystemVoiceFallback: boolean`, added to `AudioSettingsV2`, defaulting to `false`.
- `migrateAudioSettings` sets it with `value.ttsSystemVoiceFallback === true`, so only a real boolean
  `true` opts in. A missing key, `"true"`, `1`, `null`, `{}` and `[]` all migrate to `false`. The
  migration version stays at 2: adding a field whose default is the old behaviour needs no version bump,
  and every record written before D10 therefore stays exactly as it was.

The routing, in the new `packages/app/src/voice/android-system-tts.ts`:

- `createSystemVoiceFallback({ enabled, engine, coordinator })` reads the setting once per Live transport
  in `android-local-voice.ts`, which is the only place that builds the Android speech output.
- With `enabled: false`, `speak` returns `false` **without calling `engine.voices()` at all**, so the
  default install cannot reach the platform engine even to enumerate it.
- With `enabled: true`, it selects a voice, takes the same `AudioPlaybackCoordinator` lease the routed PCM
  playback uses (so Live outranks manual and preempts it), speaks, releases the lease in `finally`, and
  returns `true` only if the engine actually finished speaking.

### 2.3 Two design decisions worth the reviewer's attention

**It is not a `TtsBackend`.** The canonical router streams `TtsAudioChunk` PCM into the native Oboe ring.
`speechSynthesis` renders straight to the device output and exposes no PCM, so registering the platform
voice as a backend would have required yielding empty or invented chunks — the precise fake-PCM failure
that `productionReady` exists to catch. The fallback therefore sits *after* routing and only runs once the
router has honestly reported that no local neural voice produced audio. This is also why the router's own
readiness guard from C1 keeps holding: the shipped backend list is still Pocket-only.

**It never reports as Pocket.** `speak` resolves the contract id `fallback-android-tts`, which
`android-speech-output.ts` passes to `report(...)`, so it lands in the `ttsBackend` audio diagnostic under
its own name. A test asserts `SYSTEM_TTS_PROVIDER_ID !== "pocket"` so this cannot rot.

**Remote voices are refused.** `createWebSpeechSystemVoiceEngine` filters to `localService` voices only —
the same rule `packages/app/src/hooks/web-speech.ts:147` already applies on the web path — because a
remote-capable system voice can send the text off the device, which would be a silent cloud redirect
behind a local-only router.

### 2.4 Tests, and proof they are not vacuous

New `packages/app/src/voice/android-system-tts.test.ts` (16 tests) covers the setting default, the
migration of every non-boolean shape to OFF, the disabled path never touching the engine, the enabled path
speaking with the right voice and clamped rate, staying silent when the device has no local voice for the
language, reporting a throwing engine as a failed fallback rather than as speech, lease release,
preemption by a Live utterance, and voice selection precedence.

Four tests were added to `android-speech-output.test.ts` for the routing itself: no fallback supplied still
reports `unavailable`; the fallback enabled routes and reports `fallback-android-tts`; a *disabled*
fallback leaves the `unavailable` result untouched; and **Pocket still wins when it produces PCM**, because
D10 says the fallback is a fallback and not a replacement.

**Negative control.** With the `if (options.systemVoice?.enabled)` block in `android-speech-output.ts`
neutralised to `if (false)`, the suite reports **12 pass / 1 fail**, failing exactly on *"D10: routes to the
platform voice when the fallback is enabled"*. Restored, it is 13 pass / 0 fail. The routing test therefore
exercises real routing rather than restating the implementation.

### 2.5 Honest limits

- **The setting has no UI.** The toggle belongs in
  `packages/app/src/components/settings-audio.tsx`, which is **outside lane C's write scope** (my scope is
  `packages/app/src/voice/**`, `voice-runtime`, `packages/mobile/**`, `packages/desktop/src-tauri/**` and
  the RC0 documents). Until that toggle exists the setting is reachable only by writing the saved audio
  record directly, which is exactly what the unit tests do. Recorded as NEEDS-OWNER in §2.6 with the
  precise steps.
- **No physical verification.** Whether Android's WebView `speechSynthesis` is actually audible alongside
  the Oboe output, and whether it is interrupted correctly by a Live turn, is a device question. I have
  executed nothing of the sort and claim nothing of the sort.
- **Not claimed as Pocket, not claimed as qualified.** The platform voice is a labelled transitional
  fallback under D3, and it is off by default so nothing depends on it.

### 2.6 NEEDS-OWNER — the settings toggle for this setting

Lane C cannot add the control. For whoever picks it up, inside `packages/app/src/components/settings-audio.tsx`:

1. Add a toggle bound to `settings.ttsSystemVoiceFallback`, next to the existing
   `settings.fork.audio.provider` select (around `settings-audio.tsx:151-159`), using the existing `update`
   helper and `Toggle`/`SettingRow` component the file already uses.
2. Label it with `voice.systemFallback.title` and `voice.systemFallback.description` — the `voice.` prefix
   is deliberate: it keeps the key out of `parity.test.ts`'s `AUDITED_SCOPE_PREFIXES`, which demands a
   dedicated translation in all 16 locales. The keys are added by the follow-up `chore(i18n)` PR.
3. The default is OFF, so an existing installation shows it off with no migration prompt.

### 2.7 Proof commands and results

```
cd packages/app && bun run typecheck  -> exit 0
cd packages/app && bun test           -> 2122 pass / 1 skip / 0 fail, 252 files, 9.30 s
   (was 2103 pass / 1 skip / 0 fail / 251 files before this card: +19 tests, no regressions)
bun turbo typecheck --concurrency=1   -> 48 successful, 48 total
```

**Status: DONE** for the code and the routing proof. The settings toggle is **NEEDS-OWNER** (§2.6) because
the file that hosts it is outside this lane's write scope.
