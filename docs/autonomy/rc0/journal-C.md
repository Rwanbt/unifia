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

### 2.8 PRs and merge SHAs for C2

The card did not fit the 400-line lot limit in one piece, so it shipped as two
self-contained PRs, each green on its own. `merge-and-size` passed on both.

| PR | Lot | Lines | Merge SHA |
|---|---|---|---|
| #300 | the setting + the fallback that implements it | 371 | `f4f6a723595fdc706bdd6ea591cde86620d28c95` |
| #302 | the routing from the shipped Android speech output | 254 | `b56c7a1edd66fb09391d6a66dace102b9f4bece5` |

Gates on the exact heads `c85c7a0a9e43c49abac7012a56823c1bb564b418` (#300) and
`8804d5f0c1` (#302): all seven required checks plus `Analyze (javascript-typescript)` green.
Neither PR closes an issue, so there was nothing to close manually.

---

## C4 — D11 / VO05 (M) — integrate the remaining `voice` branch content

**Result: the diff is empty. No lot PR was needed, and no history was touched.**

This is the opposite of what `docs/autonomy/rc0/VOICE-DIVERGENCE.md` predicted, so
here is the measurement rather than the conclusion.

### 4.1 `git cherry`: all 20 commits are already on `dev`

```
git cherry -v origin/dev origin/voice
```

Every one of the 20 commits came back `+`, i.e. patch-equivalent to something already
on `dev` — including `db135fb583 feat(voice): add native Pocket Android runtime`,
`a687bd2c82 refactor(voice): Android speaks with Pocket or not at all` and
`5278425400 feat(voice): choose the speech language and the voice in the interface`.
There is no Voice commit on `voice` whose content is missing from `dev`.

### 4.2 Why: `voice` is behind, not ahead

`git diff --numstat origin/dev origin/voice` looks enormous, and the top entries are
`packages/mobile/src-tauri/assets/runtime/unifia-cli.js`, `task-panel.tsx`, `browser.ts`
and e2e specs. That is **dev being ahead**, not Voice content missing from dev. `voice`
forked at merge-base `f269f049de9c2f946dbdf533bddacb26715b369c`, which is the same
merge-base `VOICE-DIVERGENCE.md` recorded on 2026-09-29 against a `dev` that had not yet
been synchronised from `new-ui`. D10's promotion (`dev ← new-ui`) is what closed the gap.

### 4.3 Content-level check, because patch-ids can lie

`git cherry` can report "already applied" when a later commit has rewritten the same
lines, so the Voice paths were diffed directly against `78f9d01cfd` (the commit before
my own #296 merge, so my own work is not counted as a leftover):

```
git diff --numstat 78f9d01cfd origin/voice -- \
  packages/app/src/voice packages/mobile/src-tauri/src/voice packages/voice-core \
  packages/voice-host crates/unifia-voice-artifacts scripts/voice \
  packages/desktop/src-tauri/src/{voice_runtime.rs,voice_live.rs,tts_router.rs,parakeet,speech.rs,...}
```

Six files differ, and every one of them is `dev` being **better**:

| File | `voice` has, `dev` lacks | Why it is not a leftover to import |
|---|---|---|
| `packages/app/src/voice/live-controller.test.ts` | 6 lines: `await new Promise(r => setTimeout(r, 0))` / `setTimeout(r, 30)` in three tests | `dev` replaced these fixed sleeps with a `poll()` helper, and replaced a two-sleep reconnect placeholder with a real `reconnected` promise plus `expect(rooms).toHaveLength(2)` / `expect(requests).toHaveLength(3)`. Importing `voice` here would **delete** coverage |
| `packages/mobile/src-tauri/src/voice/eot_corpus_tests.rs` | 1 line: `let mut gate = \|window\| turn.predict(window);` | `dev` wraps `gate` to emit the `SMART_TURN_INPUT fixture=… sha256=…` diagnostic that the Spanish runaway was localised with (`77de890c46`). Plain `voice` is the pre-diagnostic form |
| `packages/mobile/src-tauri/src/voice/smart_turn.rs` | nothing (0 added) | `dev`-only |
| `scripts/voice/mobile_host_cargo.py` | nothing | `dev`-only |
| `scripts/voice/smart_turn_host_probe.py` | nothing | `dev`-only |
| `scripts/voice/test_mobile_host_cargo.py` | nothing | `dev`-only |

So there is nothing to import. Importing any of these hunks would be a regression, which
is why no lot PR was opened: D11 asks for lots "per remaining hunk", and there are none.

**Status: DONE** — diff measured empty at both the commit level (`git cherry`) and the
content level (`git diff` on every Voice path). `origin/voice` is now safe to leave as-is
or delete; lane C did not delete it, because branch deletion is D12's call and the owner
asked for merged `agent/*` branches to be cleaned up, not for `voice`.

---

## C3 — VO03 (L) — Voice CI status, and a tampered model artifact must be refused

### 3.1 The Voice CI jobs are **not** required on `dev`. This is the card's first claim, measured.

The card asked me to check that the Voice CI jobs are required. **They are not**, and the
proof is the branch protection rule itself rather than an inference from a badge:

```
gh api repos/Rwanbt/unifia/branches/dev/protection
  required_status_checks.contexts = [
    "check-compliance", "check-standards", "conformance",
    "rust unit tests", "sdk in sync with server", "unit (linux)", "unit (windows)"
  ]
```

Seven contexts, none of them a voice job. `voice-ci` appears in **zero** of them, and it
has been re-read from the API rather than cached from an earlier turn.

So the honest position on release 1 is: **a Voice regression can merge to `dev` today.**
Voice does not gate this release (the owner said so), but "does not gate" and "is not
even wired to block a merge" are different statements, and only the second one is true.

`voice-ci.yml` is internally sound — seven jobs, no `continue-on-error`, all blocking
*within* the workflow — so the gap is purely that `dev`'s required set does not include
its job names (`voice host python`, `voice app tests and typecheck`, `voice contracts
tests and typecheck`, `voice Rust scheduler`, `voice Rust core`, `voice model artifact
manager`, `voice docs sanity`).

### 3.2 Voice CI on `dev` is green, and I have newer evidence than the card's

The card cites run `37081782382` (2026-10-03) as the last known green `dev` run. That is
real and still `success`, but it was a `workflow_dispatch`, **not** a push-triggered run —
which is consistent with §3.1: nothing pushes a voice change and nothing blocks one.

`voice-ci` does trigger correctly on a PR that touches a Voice path, and all three of my
own PRs are green on it:

| Run | Branch / PR | Trigger | Result |
|---|---|---|---|
| `37081782382` | `dev` | `workflow_dispatch`, 2026-10-03 | success, 1m13s |
| `37336246552` | `agent/C-C1-voice-provider-inventory` (#296) | `pull_request` | **success**, 1m19s |
| `37344623674` | `agent/C-C2a-system-voice-setting` (#300) | `pull_request` | **success**, 1m04s |
| `37353913072` | `agent/C-C2b-system-voice-routing` (#302) | `pull_request` | **success**, 1m23s |

So "green" is current; "required" is not. Those are reported separately on purpose.

### 3.3 The tests: a model artifact with a tampered SHA-256 is refused

The card names four properties. Here is what already existed and what was genuinely
missing, read from the source rather than from the qualification report.

Already covered on `dev` before this card (`crates/unifia-voice-artifacts`):

| Property | Existing test | Verdict |
|---|---|---|
| verified hash (cached file) | `installed_model_is_rejected_after_a_cached_file_changes` | covered |
| verified hash (archive, hand-fed values) | `archive_summary_rejects_truncation_and_digest_mismatch` | covered but weak — feeds literal bytes, not a real artifact |
| atomic promotion | `extracted_archive_is_promoted_only_when_pinned_file_hashes_match` | covered |
| rollback (restores a good backup) | `recovery_restores_only_a_previous_integrity_checked_install` | covered |
| **rollback (refuses a tampered backup)** | *none* | **gap** |
| **tampered archive at the download boundary** | *none* | **gap** |
| **atomic download (a refused install leaves no partial state)** | *none* | **gap** |
| **immutable revision (the two digests in one entry must agree)** | *none* | **gap** |

Six new tests close those four gaps:

- `a_tampered_archive_is_refused_even_when_only_one_byte_differs` — builds a **real zip**,
  pins the registry to its honest digest, then flips **one byte** of the file on disk. The
  pinned size is unchanged, so this is the attack a size check cannot see, and it proves
  the refusal comes from the hash.
- `a_refused_install_leaves_no_partial_state_behind` — a download that got as far as
  writing a `.part` archive and a `.staging` tree: the destination was never created, and
  `cleanup_paths` removes both temporaries.
- `recovery_refuses_a_backup_whose_files_were_tampered_with` — a backup whose files were
  tampered *after* a legitimate install, so its manifest is self-consistent and only the
  pinned digest can catch it. Recovery must not promote it and must not consume it.
- `rejects_an_entry_whose_two_digests_disagree`, `rejects_an_entry_whose_two_sizes_disagree`,
  `rejects_a_digest_that_is_not_lowercase_hex` — the "immutable revision" half: one
  registry entry states the digest and the size twice, and if the two copies disagree one
  of them was edited after the other was pinned.

The first assertion of every test is that the honest artifact *does* verify, so a test
cannot pass by the check being broken.

### 3.4 One of these tests was vacuous when I first wrote it, and the negative controls are why I know

I mutation-tested each new test by removing the check it exists to defend:

| Mutation | Result |
|---|---|
| `recover_previous`'s `if is_installed(spec, &backup)` → `if true` | **FAILED** (after the fix) |
| `verify_archive_summary`'s digest comparison → `if true` | **FAILED** on both digest tests |

The rollback test **did not fail on the first attempt**, and that was a real defect in my
test rather than in the code: I had named the backup `.{model_id}-previous.{version}`,
while `recover_previous` only considers siblings matching `.{model_id}-*` **and** ending in
`.previous`. My directory was therefore never treated as a backup at all, so the test
asserted nothing about recovery. Fixed to `.{model_id}-old.previous`, and the comment now
says why the name shape matters so the next person does not reintroduce it.

### 3.5 Scope note, flagged rather than assumed

`crates/unifia-voice-artifacts/**` is not named literally in lane C's write scope, which
lists `packages/app/src/voice/**`, `voice-runtime`, `packages/mobile/**`,
`packages/desktop/src-tauri/**` and the RC-0 documents. I read `voice-runtime` as the voice
runtime — the qualification report lists this crate under its Voice providers table as the
"Artifact manager" — and it is the only correct home for an artifact-integrity test. If
the owner reads that scope differently, these four files are trivially separable from the
rest of the work. No manifest or lockfile was touched.

### 3.6 NEEDS-OWNER — make the Voice jobs required (`.github/**` is lane D's)

`.github/**` is outside lane C's write scope, so this is written out rather than applied.
The owner or lane D can do it in one call — read the current contexts, add the seven
voice job names from `voice-ci.yml` (`voice host python`, `voice app tests and typecheck`,
`voice contracts tests and typecheck`, `voice Rust scheduler`, `voice Rust core`,
`voice model artifact manager`, `voice docs sanity`), keep `strict=false`, and PATCH
`repos/Rwanbt/unifia/branches/dev/protection`. The exact per-context call is in the PR body.

Two caveats the owner should weigh before running it:

1. **Path filters mean the voice jobs often do not report at all.** `voice-ci.yml` only
   triggers on Voice paths (`packages/app/src/voice/**`, `packages/mobile/src-tauri/src/voice/**`,
   `packages/voice-core/**`, `crates/unifia-voice-artifacts/**`, `scripts/voice/**`,
   `docs/voice-*.md`, `docs/adr/ADR-0[567]*.md`, …). A required check that never reports
   blocks every PR that does not touch Voice. The usual fix is a second, always-running
   lightweight workflow, or dropping the filters. I did not choose between them because
   that is a policy call about how long a PR waits, which is the owner's.
2. **The job names must match exactly**, including capitalisation, or they will never
   satisfy the requirement.

### 3.7 Proof commands and results

```
cd crates/unifia-voice-artifacts && cargo test --locked
    -> 13 passed / 0 failed (was 7 before this card: +6)
cd crates/unifia-voice-artifacts && cargo fmt --all -- --check   -> exit 0
cd crates/unifia-voice-artifacts && cargo clippy --all-targets --locked -- -D warnings -> exit 0
```

`cargo fmt` was **not** clean on my first pass (three hunks reformatted); that is fixed and
re-verified, because `voice-artifacts` runs both gates in CI.

**Status: DONE** for the tests and for the CI measurement. **NEEDS-OWNER** for §3.6,
because the required-checks change is `.github`/branch-protection work owned by lane D.

---

## C5 — QA13 (L) — platform build evidence

**No physical result is claimed anywhere in this card.** A build is not a qualification.

### 5.1 Windows desktop — release binary built, installer bundling blocked

```
node scripts/build-desktop.mjs --check-only
  -> physical 7.50 GB free of 15.71 GB / commit 8.69 GB free of 31.71 GB / cargo jobs 1
  -> "build-desktop: preflight clear."
node scripts/build-desktop.mjs
  -> Finished `release` profile [optimized] target(s) in 43m 57s
  -> Built application at: packages/desktop/src-tauri/target/release/Unifia.exe
  -> SignTor Error: No signature found.
  -> failed to bundle project `io: Hote inconnu. (os error 11001)`
```

| Fact | Value |
|---|---|
| Binary | `packages/desktop/src-tauri/target/release/Unifia.exe`, 47.5 MB |
| SHA-256 | `DB3376F440ECF4EE6312814CBBE0484D18A12BDCD557C2A1F60112A8C93E7387` |
| Built from | `origin/dev` @ `b122d0c4b3` (this lane's C1 merge) |
| Installer | **not produced** |

The bundling failure is `os error 11001`, a DNS "host unknown" while the bundler reached
for a signing/bundling tool. Signing is owner-reserved regardless, and no signature is
claimed. This needs no code change from lane C; it is an environment condition, recorded
rather than worked around.

**Two prerequisites that are not obvious and cost real time**, so the owner does not repeat them:

1. The Tauri build script refuses to start without the CLI sidecar:
   `resource path 'sidecars\unifia-cli-x86_64-pc-windows-msvc.exe' doesn't exist`. Fix:
   `bun --cwd packages/unifia run build --single --skip-embed-web-ui` (smoke test passed,
   `unifia --version` gave `0.0.0--202610051545`), then
   `bun --cwd packages/desktop run precopy:sidecar`.
2. That build and `bun install` both rewrite `bun.lock`, and the Tauri build rewrites
   `packages/mobile/src-tauri/gen/schemas/acl-manifests.json`. All three are outside lane
   C's write scope and were reverted. **Expect to revert them too.**

### 5.2 Windows desktop — clean start, measured on a real launch

`Unifia.exe` was started with stdout/stderr captured and ran for **13m46s**
(20:24:59 to 20:38:45 local; the log timestamps carry a -2 h offset).

```
unifia_lib: Initializing app
unifia_lib: keychain endpoint listening at http://127.0.0.1:50183 (token redacted)
unifia_lib: Spawning sidecar on http://127.0.0.1:50185
sidecar:     took a lease on child process pid=3916
sidecar:     Database migration complete.   (24 migrations, 0 errors)
sidecar:     [auth] migrated 1 credential(s) from auth.json to OS keychain
sidecar:     GET /global/health  status=completed   x252 over the run
unifia_lib:  Received Exit
unifia_lib:  Killed server
```

**252 of 252 health checks completed successfully**, at about 10 s intervals across 14
minutes, and shutdown was clean. Zero panics.

The log holds 2 584 `WARN` lines and **8 `ERROR` lines**. Every one of the 8 is host
environment, not application behaviour, and I classified them rather than counting them:

| Errors | Cause |
|---|---|
| 4 | `rust` LSP client `EPIPE`, then `Operation timed out after 45000ms`; no rust-analyzer on this host |
| 2 | `keychain get minimax-coding-plan failed: 429 failed`; keychain service rate limit |
| 1 | `Provider does not exist in model list unifia`; the host's saved config names a provider absent from its own model list |
| 1 | `EPIPE: broken pipe, write rejection`; downstream of the failed LSP initialise |

**No Voice-related error of any kind**, and nothing attributable to the release build.
The remaining warnings are duplicate-skill-name notices from scanning `~/.claude/skills`.

This is a *startup* qualification only. It says nothing about STT, TTS, audio routing or
any Voice gate; those need the owner checklist in §5.5 and the owner's hardware.

### 5.3 Linux CI build

Measured on `dev` push run `37340908702`:

| Job | Runner | Result | Duration |
|---|---|---|---|
| `unit (linux)` | ubuntu | **pass** | 8m57s |
| `unit (windows)` | windows | **pass** | 22m34s |
| `rust unit tests` | ubuntu | **pass** | 1m59s |
| `e2e (linux)` | ubuntu | **fail: killed by its own 110-minute job timeout** | 1h51m28s |

The Linux build and unit jobs are green. The `e2e (linux)` failure is a **timeout, not a
test failure**: GitHub reports `The action 'Run app e2e tests' has timed out after 110
minutes`. This is the pre-existing condition already recorded in `EXECUTION-LOG.md`
(2026-10-04 16:20-17:10 UTC), it predates lane C, and `e2e (linux)` is **not** one of the
seven required checks, which is why PRs #296, #300, #302 and #305 all merged with it pending.

So the whole `test` run shows `failure` on every push to `dev` while every required Linux
and Windows job is green. Reporting that as "Linux CI is red" would be wrong, and
reporting "Linux CI is green" without naming `e2e (linux)` would also be wrong.

### 5.4 Android APK build

`android.yml` runs on every push to `dev` and uploads the APK as an artifact:

| Fact | Value |
|---|---|
| Run | `37342587784`, **success**, 33m28s |
| Head | `b122d0c4b34450c64d4c9a5151b35cf5994aa366` (this lane's C1 merge) |
| Artifact | `unifia-mobile-apk`, **909 687 883 bytes**, `expired=false` |

**A successful APK build is not a working APK.** No APK was installed, no Android process
started, and `libpocket_tts.so` was not exercised on any device. Nothing here qualifies a
single Voice gate.

### 5.5 The owner handoff

`docs/autonomy/rc0/OWNER-DEVICE-CHECKLIST.md` is written and carries every gate: the
prerequisites, the exact `adb install` and `adb logcat` commands, how to read the
`[Live] Native Android audio diagnostics` record including `ttsBackend` (which settles any
D10 question), per-step expected results, and a copy-pasteable reply format.

Its most important single assertion is A3.4: **with the fallback setting off, which is the
default, a language with no installed Pocket pack must report `ttsBackend: unavailable` and
stay silent.** It must not fall through to the phone's own voice. If it does, that is a
defect against D10 and the checklist says to report it as one.

The checklist also states the toggle does not exist yet (§2.6) and gives a `localStorage`
workaround for exercising A3.5 before the UI lands, explicitly flagged as a workaround so
the owner records that they used it.

**Status: DONE** for build evidence per platform and for the checklist. Every physical
gate is **NEEDS-OWNER**, by design.
