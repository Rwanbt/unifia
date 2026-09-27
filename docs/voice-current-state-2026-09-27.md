<!-- SPDX-License-Identifier: MIT -->
# Voice current-state and evidence report — 2026-09-27

**Scope:** repository truth discovery and implementation-gap verification for the
Unifia Voice v2.2 completion campaign.
**Checkout:** `D:/App/unifia/voice-runtime` (a `git worktree` of
`D:/App/unifia/unifia/.git`), branch `voice`.
**Rule applied:** this document records what was *observed in this session*, not
what previous reports or commit messages claim.

## 1. Authoritative starting state (observed)

| Fact | Observed value |
|---|---|
| Worktree | `D:/App/unifia/voice-runtime` |
| Branch | `voice` |
| HEAD at session start | `299a9062fc7d5bc324a4d9ab3cb69d62f9881b12` |
| `origin/voice` after `git fetch origin --prune` | `299a9062fc7d5bc324a4d9ab3cb69d62f9881b12` |
| `rev-list --left-right --count HEAD...origin/voice` | `0	0` |
| `origin/new-ui` | `99707e15a44941a524997cec1e20d42133ebe088` |
| `origin/main` | `207ff452b8056ae11d1f71e23198e520835f70ed` |
| Commits ahead of goal-stated baseline `261cef4135` | **109** |
| Commits ahead of v2 plan baseline `9fca2d73f8` | **142** |
| Other worktrees | `D:/App/unifia/unifia` (main), `D:/App/unifia/_a7-automate-memory` (new-ui), `D:/App/unifia/unifia-work-design` (work-design) |
| Stashes | 12, all pre-existing and unrelated to this tranche (`refs/archive/2026-09-08/...` etc.) |

**Conclusion on authority:** the local branch and `origin/voice` were *identical*
at session start. The remote is current; there was no unpublished remote-only
work and no divergence to reconcile.

## 2. Unpublished local work found and protected

The working tree carried **uncommitted** work that was not on any branch:

- `packages/voice-core/src/ffi.rs` — untracked, 302 lines
- `packages/voice-core/Cargo.toml` — `+[lib] crate-type = ["rlib","cdylib"]`
- `packages/voice-core/src/lib.rs` — `+mod ffi;`

This is a coherent C ABI for `voice-core` (`unifia_voice_core_create`,
`_begin_turn`, `_publish`, `_reconnect`, `_destroy`, `_string_free`) intended for
Python desktop and Android JNI adoption of the canonical core.

Verification run before committing:

| Check | Result |
|---|---|
| `cargo test --locked` (packages/voice-core) | **31 passed, 0 failed** (incl. 2 new FFI tests) |
| `cargo clippy --all-targets --locked -- -D warnings` | clean |
| `cargo fmt --check` | clean (exit 0) |

Committed as `6f95cee58a` — `feat(voice): expose voice-core through a stable C
ABI` — and pushed to `origin/voice` (`299a9062fc..6f95cee58a`).

Deliberately **left unstaged** (pre-existing generated artifacts, not campaign
output): `packages/app/AI_SUMMARY.md`, `packages/mobile/AI_SUMMARY.md`,
`packages/mobile/src-tauri/gen/schemas/acl-manifests.json`, plus untracked
`.build-temp/` and `__pycache__/` directories.

## 3. CI trust (§8 of the goal) — already satisfied, premise is stale

The goal text states Voice CI was red at the audited HEAD. That is **no longer
true**. `gh run list --branch voice` at session start:

| Workflow | Run | Head SHA | Conclusion |
|---|---|---|---|
| `voice-ci` | `36342174192` | `299a9062fc` | **success** |
| `unifia-conformance` | `36342174278` | `299a9062fc` | **success** |
| `voice-ci` | `36341132614` | `fd448376ac` | success |
| `unifia-conformance` | `36341132554` | `fd448376ac` | success |
| `voice-ci` | `36340745654` | `c7d7faddf4` | success |
| `unifia-conformance` | `36340745598` | `c7d7faddf4` | success |

Both mandatory workflows are green **on the exact branch head**, and the four
preceding runs are green as well. G0 is therefore closed; CI repair is not the
blocking first action it appears to be in the goal preamble.

## 4. Implementation verification — what is real vs. what is still scaffold

The goal's §1 "starting gap list" was written against `261cef4135`. Re-checking
against actual code at `299a9062fc` + `6f95cee58a`:

### Closed since the goal's baseline (verified in source, not by commit name)

| Goal claim at `261cef4135` | Observed at `299a9062fc` |
|---|---|
| "Silero is not the real Android Live VAD" | `packages/mobile/src-tauri/src/voice/vad.rs` — Silero v6.2.2 ONNX through Rust/ORT, SHA-checked against the shared registry, recurrent state across 512-sample frames |
| "Smart Turn is not implemented" | `voice/smart_turn.rs` + policy C integrated in `voice/capture_segmenter.rs`; 96-decision fixture replays under ORT 1.28.0 |
| "EOT corpus has transcripts but no audio fixtures" | `packages/voice-core/fixtures/turn-endpointing-parity.json` — 101 cases (91 corpus + 10 boundary), replayed identically by Rust and TypeScript |
| "streaming STT has only a contract/mock" | `packages/app/src/voice/streaming-stt-nemo.ts` — real nemo-speech WebSocket provider + honest final-only fallback + router |
| "R6 streaming controller path not supplied by `live-binding.ts`" | `voice/sdk-live-prompt-stream.ts` + `local-session.ts` feed `assistant_text_delta` into the shared `SpeechSegmenter` |
| "SpeechRenderer/SpeechSegmenter parity incomplete" | Ported to TypeScript with a Python-generated cross-runtime parity fixture; first segment reaches TTS before the answer completes |
| "FastDecision/Laya is not implemented" | `fast-decision-off.ts` (true bypass) + `fast-decision-rules.ts` (production default, language-tagged rules, EN/FR/ES/IT/DE) |
| "Rust ResourceScheduler not controlling residency" | `voice/resource_scheduler.rs` + `provider-lease.ts` / `wired-providers.ts` binding STT/VAD/FastDecision leases, with a 1000-cycle no-leak regression suite |
| "error taxonomy still contains `unknown`" | `packages/contracts/src/tts-router.ts` + `stt-errors.ts` carry closed code sets; `live-controller.ts` classification under active work |
| "no shared VoiceTurnEngine / architecture ambiguous" | `packages/voice-core` (Rust) is the canonical core, now **also exported over a stable C ABI** by this session's commit |
| "Android capture still WebView getUserMedia + base64 WAV" | `voice/native_audio.rs` — Oboe mono 48 kHz I16 ring buffers, `voice_audio_poll` reads frames, `getFramesRead()`-based AudioClock; the WebView path is legacy fallback only |

### STILL OPEN — the real remaining product gap

| Component | Observed reality | Evidence |
|---|---|---|
| **Pocket Android TTS** | `packages/app/src/voice/pocket-android-tts.ts` is a **deterministic fake-PCM scaffold**. `makeScaffoldSamples()` fills a fixed 8-value pulse pattern; `capabilities.productionReady: false`; the router explicitly skips it. **No neural Pocket synthesis exists on Android.** | direct source read, lines 88–111 and 228–237 |
| **Android TTS routing** | `voice/android-local-voice.ts` constructs `new AndroidOfflineTts()` and calls it **directly**, bypassing the canonical `TtsRouter` and `AudioPlaybackCoordinator` entirely | `android-local-voice.ts:3,35` |
| **Android spoken output** | `AndroidOfflineTts` uses WebView `speechSynthesis` with a `localService` voice. It is honest about being a system voice, but it is *not* Pocket and it is *not* routed. | `android-offline-tts.ts` |
| **Native TTS playback** | `voice_audio_write_pcm` exists in the native layer but is **not connected to canonical TTS**. `playTtsRequest()` (`tts-playback.ts`) is the correct seam and has no Android production consumer. | `native_audio.rs:295`, `tts-playback.ts:16` |
| **Android physical gates** | G3 (device PCM path, AEC, routes, lifecycle) and G12 (standalone/airplane-mode) remain unqualified. | campaign state file |
| **Windows physical Live** | No target-Windows physical Live/audio qualification recorded. | campaign state file |

**The decisive conclusion:** the campaign's remaining work is no longer
contract/architecture work. The shared core, VAD, EOT, streaming STT,
FastDecision and scheduler are implemented and host-verified. **The single
largest product gap is that Android has no real local neural TTS and does not
route speech through the canonical TTS pipeline at all.**

## 5. Hardware and toolchain (observed)

| Item | Value |
|---|---|
| `adb devices -l` | `b7163823 device product:cmi_eea model:Mi_10_Pro device:cmi transport_id:1` |
| adb | `...\Genymobile.scrcpy_Microsoft.Winget.Source_...\adb.exe` (also `...\Android\Sdk\platform-tools\adb.exe`) |
| java | `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot\bin\java.exe` |
| cargo | `C:\Users\barat\.cargo\bin\cargo.exe` |
| bun | `C:\Users\barat\.bun\bin\bun.exe` |
| rustup targets installed | `aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`, `wasm32-unknown-unknown`, `x86_64-linux-android`, `x86_64-pc-windows-msvc` |

**The decisive Android gate hardware is present and connected.** Prior sessions
left it usable; the physical gate is not blocked by absent hardware.

## 6. Correction to the goal's licence constraint

The goal (§26) states: *"Do not embed GPL Piper into the MIT mobile
application."* This **eliminates Piper-ONNX-on-Android as an option** for the
mandatory automatic TTS fallback. The Android TTS fallback chain must therefore
be:

```
real Pocket (neural, local)  →  Android system TTS, explicitly labelled emergency
```

`TTS_DEFAULT_FALLBACK_ORDER` currently reads `["pocket","piper","fallback-android-tts"]`.
The `piper` entry is unusable on Android under this constraint and must not be
mistaken for a working Android fallback.

## 7. Next exact actions

1. Re-open the Pocket TTS runtime bake-off (§23) against a **permissively
   licensed** arm64 CPU runtime; do not fork or embed GPL components.
2. Replace the fake-PCM `PocketAndroidBackend` with real neural synthesis, or
   delete the scaffold rather than leave it occupying the `pocket` slot.
3. Wire Android Live + Read Aloud through the canonical `TtsRouter` with a
   production `consume` that writes to native Oboe output via
   `voice_audio_write_pcm`; keep system TTS only as an explicitly labelled
   emergency fallback that never masquerades as Pocket.
4. Build the APK from the exact certified SHA, install on `b7163823`, and
   qualify the real device PCM path (G3), then standalone airplane mode (G12).

**Verdict:** repository truth is established and local work is protected. CI is
green. The remaining gap is a real missing product capability (Android neural
TTS + canonical TTS routing), not a planning or trust problem.
