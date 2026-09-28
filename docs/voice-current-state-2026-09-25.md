<!-- SPDX-License-Identifier: MIT -->
# Voice current-state and evidence report — 2026-09-25

**Scope:** Unifia Voice on Windows and standalone Android, including the
reported Android Live failure. **Checkout:** `D:/App/unifia/voice-runtime`,
branch `voice`, HEAD `535d49f5779b0f67674cb25406a89600d01c61ff`.
This is a snapshot, not a production certification. Existing untracked build
artifacts were left untouched. The proposed convergence is in
[RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).

## Why the platforms diverged

The former phone path joined a LiveKit room hosted by the desktop. Audio from
the phone was processed by the desktop Python Voice Host, so Silero and the
LiveKit turn detector ran on the PC. This needed a paired PC and did not meet
the later standalone-phone requirement. The Android-local commits on September
25 introduced a separate local path: `2e6f199` set the direction, `36e9a7a`
added local session orchestration, and `63944fe` added WebView capture with a
temporary RMS energy gate. The [Android plan](PLAN-ANDROID-STANDALONE-VOICE.md)
explicitly says Silero and Pocket Android remain open. The app therefore
shares some UI/state code but not the desktop speech engine. Presenting it as
the same detector on PC and Android would be incorrect.

## Implemented paths at this revision

| Component | Windows local Live | Android local Live |
|---|---|---|
| Capture | LiveKit/WebRTC room | WebView `getUserMedia` and `ScriptProcessorNode` |
| Speech/turn detection | Silero VAD and LiveKit `turn-detector-v1-mini` | RMS threshold converted to 0.9/0.1, then `TurnEndpointing` |
| STT | Parakeet TDT 0.6B v3 INT8 through Python `onnx_asr`/ORT | Parakeet TDT 0.6B v3 INT8 through Rust `ort` Tauri command |
| Agent/session | `prompt_async` plus `/event` SSE; incremental text and canonical Unifia session | `session.prompt`; canonical Unifia session, full answer awaited |
| Spoken text | Python `SpeechSegmenter` and `renderer` | Entire assistant response as text |
| TTS | Pocket managed Python; Piper subprocess fallback | WebView `speechSynthesis`, installed `localService` voice required |
| Audio result | PCM chunks over LiveKit | Android system speech output |
| LLM | Selected Unifia model/provider | Selected Unifia model/provider; local GGUF readiness not preflighted by Live |

Code: `packages/voice-host/voice_host/live/agent.py`, `bridge.py`, `tts.py`;
`packages/app/src/voice/android-local-voice.ts`, `android-offline-tts.ts`,
`local-session.ts`, `live-controller.ts`;
`packages/app/src/components/prompt-input/live-binding.ts`;
`packages/mobile/src-tauri/src/speech.rs`.

The current mobile composer selects `transport: "local"` unconditionally for
the mobile platform. The optional desktop offload described in
[voice-live.md](voice-live.md) is not the active mobile composer path. The
settings page exposes Pocket/Piper and voice choices, but the Android-local
transport ignores those selections and calls system speech synthesis.

## Evidence that has actually been recorded

| Area | Evidence | Boundary |
|---|---|---|
| Desktop Pocket model | Historical Gate D used installed NSIS application and managed Pocket runtime; EN/FR/ES/IT/DE inference, WAV validation, worker cancellation and two crash/recovery cycles passed. [Baseline](voice-runtime-baseline.md#final-gate-d-certification--2026-09-24). | Manual synthesis path; not a complete physical Live call. |
| Desktop regressions | At Gate D: 47/47 Turbo typecheck tasks, 1,643 app unit tests, 24 managed voice-host tests, and desktop Cargo check were reported green. [Baseline](voice-runtime-baseline.md#regression-checks-and-bounded-limitations). | Historical SHA before the September 25 Android commits. |
| Desktop Live transport | Four Linux CI integration runs used real LiveKit server, WebRTC, Silero and LiveKit turn detector. Client join 191–217 ms, stop after speech 512–557 ms, no duplicate submission. [Live documentation](voice-live.md#tests-and-measurements). | Parakeet, Pocket/Piper and Unifia server were test doubles; no target Windows end-to-end qualification. |
| Android components | Unit tests exist for `TurnEndpointing`, `local-session`, `AndroidOfflineTts`, and the local branch of `live-controller`. | They exercise fake frames, SDK and voices; no Android microphone, system TTS, native STT or real provider call. Execution result after current HEAD was not recovered. |
| Android dictation | User reported speech-to-text working and responsive on the phone. Native Parakeet command is present. | User observation, no measured recognition corpus or current APK trace. |
| Android Live | User reported generic failure when starting Live. | No successful phone-only Live turn or stage-specific stack trace captured. |
| Android installation | ADB sees Xiaomi Mi 10 Pro `b7163823`, package `ai.unifia.mobile` 0.1.0, last updated 2026-09-25 16:54:04. | HEAD commit was made at 17:02:54; installed package cannot certify that final commit. Exact installed APK hash was not proven. |

At inspection, `pidof ai.unifia.mobile` returned a running process; the system
reported about 1.10 GB `MemAvailable` and 0.61 GB `SwapFree`. These are idle
device observations, not Live/LLM coexistence measurements. The recent 3,500
logcat lines contained no matching Voice/exception trace. Local CI status is
unknown: `gh run list --branch voice` failed because the configured proxy at
`127.0.0.1:9` refused the connection. No tests or rebuild were run for this
report.

The conversation also records user-observed mobile layout overlap, provider
connection failures and a local-server health timeout. The branch contains
mobile layout and runtime commits before the local Voice tranche, but this
inspection did not replay those journeys. The current running process does
not by itself prove a healthy embedded server, credential setup, model
selection, or chat completion. These adjacent paths need separate device
checks; their present status is **unverified**, not assumed fixed.

## Confirmed defects and unconfirmed causes

**Confirmed in source:** Android local VAD is RMS, not Silero. Android local
TTS is a WebView/system voice, not Pocket/Piper. Android waits for a complete
agent answer while desktop streams it. `local-session.ts` handles an SDK
wrapper `error` but does not inspect an assistant message `info.error`.
`live-controller.ts` maps most errors to `unknown`, producing the generic Live
failure message. The installed APK lags the last commit.

**Plausible, not yet proven as the observed failure:** `AndroidOfflineTts`
rejects when WebView cannot list a voice marked `localService` for the chosen
language. `android-local-voice.ts` calls `tts.prepare()` before native STT or
microphone startup, so that rejection can fail immediately. Another possible
path is native STT/model setup. A later failure could arise from provider/model
selection or `info.error`. Neither `settings get secure tts_default_synth`
returning `null` nor a generic UI toast identifies the actual stage.

## Production gates still open

1. Capture the failure from the exact installed/rebuilt APK with stage-specific
   diagnostics (TTS voice discovery, STT model, microphone, session/provider).
2. Pin and qualify native Silero on Android; prove PC/Android turn policy parity.
3. Qualify a Pocket Android runtime and the same five language/voice assets;
   evaluate a narrowly pinned `sherpa-onnx` fork for newer Kyutai exports.
4. Qualify a legally distributable Piper fallback on Android and confirm
   effective settings match real runtime selection.
5. Use one event-driven session bridge and spoken-text renderer on both local
   platforms; report provider/model errors rather than silence or `unknown`.
6. Rebuild from exact SHA, install on Xiaomi, run real phone-only local-LLM Live
   in airplane mode, remote-provider Live, manual TTS, interruption and sustained
   memory/thermal tests. Separately run target Windows end-to-end Live with real
   Parakeet/Pocket. Record artifact hashes and device logs for every PASS.

**Verdict:** desktop components have substantial bounded evidence; Android
standalone Live and PC/Android equivalence remain **NO-GO / unqualified**. The
RMS and system TTS adapters are explicit transitional slices, not the intended
production implementation.
