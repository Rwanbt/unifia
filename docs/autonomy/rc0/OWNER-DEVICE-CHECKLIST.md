<!-- SPDX-License-Identifier: MIT -->
# OWNER-DEVICE-CHECKLIST — physical Voice qualification (RC-0, lane C)

**This file is a handoff, not a result.** Nothing in it has been executed by an
agent. Every gate below needs the owner's own hardware, and the agent side of
RC-0 has explicitly **not** claimed any of them. A checkbox here means "the owner
ran it and it behaved as written", never "an agent believes it would pass".

Written by lane C (card C5 / QA13). Companion evidence: `docs/autonomy/rc0/journal-C.md` §C5.

## What an agent already established, so you do not have to re-derive it

Full detail and evidence: `docs/autonomy/rc0/journal-C.md`. In short —

- Shipped Android Voice path: `packages/app/src/components/prompt-input/live-binding.ts:112-113`.
  Providers Oboe / Silero / Smart Turn / Parakeet, each with its consumer `file:line` and
  executed test result in journal §1.2.
- The Windows desktop Rust **test binary does not start on the agent host**
  (`0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND`), so no desktop Rust test result exists from the
  agent side (journal §1.4).
- The desktop **release binary builds** and **starts cleanly**: `Unifia.exe`, 47.5 MB,
  SHA-256 `DB3376F440ECF4EE6312814CBBE0484D18A12BDCD557C2A1F60112A8C93E7387`, ran 13m46s
  with 252/252 backend health checks green and zero panics. Installer bundling did not
  complete (DNS, os error 11001). See journal §5.1-5.2.
- The Android APK **builds** in CI (artifact `unifia-mobile-apk`, 909 687 883 bytes). A
  successful build is not a working APK; nothing was installed on a device.
- Decision **D10** (2026-10-05): the platform TTS is a **setting, OFF by default**, and
  Pocket stays the local voice. Implemented and unit-tested (journal §C2); the settings
  **toggle does not exist yet** (NEEDS-OWNER, journal §2.6).

## Prerequisites

| # | Requirement | Note |
|---|---|---|
| P1 | Android device, arm64-v8a, API 24+ (minSdk 24, target per `tauri.conf.json`) | Qualification report used a Xiaomi Mi 10 Pro, Android 13 / API 33 |
| P2 | `adb` on the host, device authorised | `adb devices` must list the device |
| P3 | A release-1 candidate APK | Ask lane C / the owner which SHA was built; do **not** assume `dev` head |
| P4 | Free disk on the build host | C: was at 7.5 GB free and D: at ~9 GB during lane C work; a desktop build needs ~5 GB more |
| P5 | A quiet room and wired headphones **plus** the phone speaker | Route change is one of the gates |

## How to read the diagnostics

The Android audio diagnostics are **not** rendered in the UI. They are emitted to
the WebView console:

```
[Live] Native Android audio diagnostics { audioClockMs, sampleRate, framesPerBurst,
  xrunCount, lastError, captureOverflows, playbackOverflows, playbackEmptySamples,
  vadProvider, vadFallback, turnDetector, turnDetectorFallback, turnGateEvaluations,
  turnGateVetoes, turnGateForced, ttsBackend }
```

Source: `packages/app/src/voice/live-controller.ts:199` →
`packages/app/src/voice/live-store.ts:81` (`console.info`). Capture them with:

```
adb logcat | grep -i "Native Android audio diagnostics"
```

`adb logcat` is the reliable surface; `chrome://inspect` works too but is easier to
lose. `ttsBackend` is the field that decides D10 questions: it must read `pocket`
when Pocket spoke, `fallback-android-tts` when the system voice spoke, and
`unavailable` when nothing spoke. **A `ttsBackend` of `pocket` while you clearly
heard a different voice is a defect — report it as one.**

---

## A. Android physical Voice gates

Install:

```
adb install -r <path-to-candidate.apk>
adb shell pm clear ai.unifia.mobile      # only if you want a clean first run
```

`pm clear` wipes the downloaded Parakeet model, so the first Live start after it
will download ~670 MB. Do **not** run it between sub-tests.

### A1 — First Live start, cold

| Step | Action | Expected result |
|---|---|---|
| A1.1 | Open the app, select a **local** model, open a session | Session loads; no crash |
| A1.2 | Tap the microphone / enter Live | Orb starts; **no** "voice unavailable" banner |
| A1.3 | Watch `adb logcat` | `vadProvider: "silero"`, `vadFallback: false` |
| A1.4 | Check `sampleRate` | `48000` — anything else means the Oboe stream is not at the canonical rate and Live must refuse (see `android-local-voice.ts:69`) |
| A1.5 | Check `lastError` | `0` |

- [ ] A1 PASS / FAIL — note the SHA of the APK and the `adb logcat` excerpt.

### A2 — Speech to text (Parakeet final STT)

| Step | Action | Expected result |
|---|---|---|
| A2.1 | In Live, speak one clear sentence in the configured language, then stop | Transcript appears in the composer/session |
| A2.2 | Compare transcript to what you said | Faithful; no duplicated turn from the same utterance |
| A2.3 | Check `xrunCount` | `0`. A rising count is an audio underrun defect (ADR-078), not a tuning knob |

- [ ] A2 PASS / FAIL

### A2b — Barge-in and turn endpointing (Smart Turn)

| Step | Action | Expected result |
|---|---|---|
| A2b.1 | Start speaking, then pause mid-sentence for ~1.5 s | Live does **not** submit a truncated turn |
| A2b.2 | Pause ~4 s | Turn is submitted once |
| A2b.3 | Repeat 5 times | Exactly 5 turns, no doubles |
| A2b.4 | Check `turnDetector` / `turnDetectorFallback` | `smart_turn` / `false`. If `turnDetectorFallback: true`, the bounded 128 ms fallback is carrying the conversation — record it, it is a DRAFT-class path |

- [ ] A2b PASS / FAIL

### A3 — Speech out (Pocket) and the D10 setting

| Step | Action | Expected result |
|---|---|---|
| A3.1 | Let the assistant answer in Live | Audible Pocket speech |
| A3.2 | Check `ttsBackend` | `pocket` |
| A3.3 | Switch **off** "use the device voice" in Settings → Audio (see A3.6) | Setting absent until the toggle lands — record which case you hit |
| A3.4 | With the setting **off**, choose a language whose Pocket pack is **not** installed | Live reports `ttsBackend: unavailable` and says speech is unavailable. **It must stay silent, not fall back to the phone's voice.** This is the D10 default and the single most important assertion on this page |
| A3.5 | Turn the setting **on**, repeat A3.4 | The phone's own voice speaks; `ttsBackend: fallback-android-tts`; `vadProvider`/`turnDetector` unchanged |
| A3.6 | If the toggle is missing | Expected today: **it is missing** (NEEDS-OWNER, `journal-C.md` §2.6). To exercise A3.5 without the UI, write the saved audio record directly in the WebView console: `localStorage.setItem("unifia-audio-settings.v2", JSON.stringify({ ...JSON.parse(localStorage.getItem("unifia-audio-settings.v2") ?? "{}"), ttsSystemVoiceFallback: true }))` then **fully restart** the app. Record that you used this path |

- [ ] A3 PASS / FAIL — and state which of A3.3/A3.6 applied.

### A4 — Audio routes and lifecycle

| Step | Action | Expected result |
|---|---|---|
| A4.1 | With Live speaking, unplug wired headphones | Playback moves to the speaker without a crash or a silent device |
| A4.2 | Replug | Playback returns |
| A4.3 | Enable Bluetooth, repeat | Route changes; if Bluetooth is out of release-1 scope (it is: VO06), record the behaviour as "not qualified", not as a failure |
| A4.4 | Background the app 60 s, return | Live either recovers or fails **honestly** (an error state), never silently frozen mid-turn |
| A4.5 | Screen off / on | Same as A4.4 |

- [ ] A4 PASS / FAIL, with per-route notes.

### A5 — Audio focus

| Step | Action | Expected result |
|---|---|---|
| A5.1 | Start Live playback, then start a third-party audio app | Unifia yields focus or pauses; it must not keep playing over it |
| A5.2 | Reverse order | Unifia requests focus and resumes |

- [ ] A5 PASS / FAIL

### A6 — Endurance (informational, VO06)

A 60-minute continuous Android session is **train 2 (VO06)**, not release 1. If you
run it anyway, report the total duration, any `xrunCount` growth, and whether the
app survived — but do not treat a short run as endurance evidence.

---

## B. Windows desktop Voice gates

The desktop Rust test suite cannot run on the agent host (§1.4), so these are the
first executed desktop Voice results anyone will have.

Build and start (from a clean clone, `TEMP`/`TMP` pointed at a **D:** folder — C: is
nearly full on this machine):

```
$env:TEMP = "D:\.tmp-opencode"; $env:TMP = "D:\.tmp-opencode"
bun --cwd packages/unifia run build --single --skip-embed-web-ui   # CLI sidecar; the Tauri build script refuses to start without it
bun --cwd packages/desktop run precopy:sidecar
node scripts/build-desktop.mjs                                    # preflight + tauri build
```

> `bun install` and the sidecar build both rewrite `bun.lock`, and the Tauri build
> rewrites `packages/mobile/src-tauri/gen/schemas/acl-manifests.json`. Lane C
> reverted all three as out of scope. If you run this, expect to revert them too.

### B1 — Cold start

| Step | Action | Expected result |
|---|---|---|
| B1.1 | Launch the built app with no prior profile | Window opens; no crash; no first-run hang |
| B1.2 | Open a session and speak into the mic (STT) | Transcript appears |
| B1.3 | Trigger read-aloud (TTS) | Audible speech |
| B1.4 | Quit and relaunch | Second start is as clean as the first |

- [ ] B1 PASS / FAIL

### B2 — Desktop TTS provider fallback

| Step | Action | Expected result |
|---|---|---|
| B2.1 | With provider = Pocket, request read-aloud | Pocket speaks |
| B2.2 | Make Pocket unavailable (stop its worker / point the provider at Piper), request read-aloud | Piper speaks, **or** an explicit error. A silent failure is a defect |
| B2.3 | Provider = auto, Pocket unavailable | Automatic fallback happens with a visible reason (the Rust router emits `voice-provider-fallback`) |

- [ ] B2 PASS / FAIL

### B3 — Desktop read-aloud parity with Android

| Step | Action | Expected result |
|---|---|---|
| B3.1 | Same text, same language, both platforms | Both intelligible; note any WER/latency gap you can measure |
| B3.2 | Toggle read-aloud mid-utterance | Pauses; double-click resets (the contract in `session-header.tsx:149-155`) |

- [ ] B3 PASS / FAIL

---

## C. What to send back

Please reply with, per gate, `PASS` or `FAIL` plus one line of evidence:

1. the APK SHA-256 (or the desktop `Unifia.exe` SHA-256),
2. `adb logcat | grep "Native Android audio diagnostics"` captured during A1/A2/A3,
3. the `ttsBackend` value you observed in A3.2, A3.4 and A3.5,
4. anything that failed, with the exact step number.

A `FAIL` is as useful as a `PASS` here: it is the measurement this programme
needs. What is **not** acceptable is a gate being reported as passed because a
build succeeded — a build is not a qualification, and lane C has not recorded any
of these gates as passed.
