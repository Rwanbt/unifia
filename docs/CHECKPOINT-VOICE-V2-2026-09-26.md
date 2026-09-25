<!-- SPDX-License-Identifier: MIT -->
# Voice v2 checkpoint — 2026-09-26 (01:17 CEST)

> Session check-in after the RFC and current-state snapshot freeze.
> Honest boundary: this session cannot reach GO PROD because the
> physical gates listed below require hardware, credentials and
> environment access that are not present in the current session.

**Checkout:** `D:\App\unifia\voice-runtime`
**Branch:** `voice`
**HEAD before session:** `9fca2d73f8 docs(voice): add autonomous PC and Android review dossier`
**HEAD after session:** `9cd58a8c7c docs(voice): freeze v2 parity RFC and 2026-09-25 current-state snapshot`

## What was committed this session

| SHA | Subject | Bytes |
|---|---|---:|
| `9cd58a8c7c` | `docs(voice): freeze v2 parity RFC and 2026-09-25 current-state snapshot` | 2 files, +358 |

The two committed files are the verbatim version of the pre-existing
untracked drafts:

- `docs/rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md` — the v2
  architecture proposal: one local `VoiceTurnEngine` shared between
  desktop and Android, one pinned Silero, one pinned Parakeet, one
  pinned Pocket model and voice per supported language, with OS audio
  capture/playback and packaging as the only allowed platform
  divergence.
- `docs/voice-current-state-2026-09-25.md` — the verified snapshot at
  parent `535d49f577`: desktop has bounded evidence through Wave F
  (Piper, TTS routing, previews, autoplay priority); Android standalone
  Live and PC/Android equivalence are NO-GO / unqualified; RMS and
  WebView/system-TTS adapters are transitional slices.

## What was inspected but not committed

- `ADR-058-voice-runtime.md` — already in tree. It still records
  Pocket-primary, Parakeet TDT 0.6B v3, Voice Host Python,
  LiveKit transport, mobile standalone-first. The RFC proposes to
  supersede parts of it (no second Python agent; one shared
  `VoiceTurnEngine`) but ADR-058 is not amended yet — the proposal is
  a draft.
- `voice-runtime-baseline.md` — historical Wave A baseline, with Wave
  D `PARTIAL` / `NO-GO`, and the Wave E (Piper) and Wave F (TTS
  routing) verdicts that the current-state snapshot summarizes.
- Per-wave handoffs dated 2026-09-24 in
  `docs/operations/sessions/` document the Wave G/H attempts and
  their blockers (microphone endpoint, LiveKit/Firewall/GPO loopback).

## What cannot be done from this session

| Required for | Reason | Recovery |
|---|---|---|
| Wave G dictation (real microphone) | No Windows microphone endpoint exposed to the test agent; current run logs only check `pidof` and idle memory, never a Live turn with real audio input. | Plug in / enable a microphone endpoint (USB headset, Bluetooth headset, or device manager enable). User must run the verification themselves. |
| Wave H LiveKit TURN/ICE loopback | Windows Firewall Domain/Public = `BlockInbound`; GPO makes local rules N/A; SDK relay candidate = 0 over both UDP and TLS; no admin rights on the machine to alter GPO, firewall or trust store. | Requires a machine with explicit RTC UDP authorization or a GPO-granted change. The plan forbids touching GPO/firewall/trust store without habilitation. |
| Android standalone physical qualification | Needs the Xiaomi Mi 10 Pro (`b7163823`) with an APK rebuilt from the exact SHA under test, plus airplane-mode verification, 10/30/60-minute thermal endurance, five-language live runs, and barge-in measurements. | Device present but unattended at 01:17 CEST; APK SHA not pinned to the post-commit rebuild; would normally be a daytime session. |
| Signed production APK / installer | No signing credentials in the session; the test build uses the existing unsigned flow. | Production signing requires the user-supplied keystore path and credentials. |
| Local LLM coexistence benchmark | Needs the local model server running for sustained measurement; current session has not loaded one. | Run during daytime with the selected model profile. |
| Voice-host Python test suite | `pytest` errors on collection: `test_live_stt.py`, `test_voice_state.py`, `test_live_runtime.py`, `test_live_text.py`, `test_worker.py` all need the managed Python 3.12 venv with `pocket-tts==3.1.0`, `livekit-agents==1.8.3`, `onnx-asr==0.12.0`. The local `.venv` is created but pytest is not installed in it; running `pytest` from the system Python 3.13 fails on `pocket_tts.models.model_state` (not in that Python) and on `voice_host.worker` (no editable install in the system Python). | Use `uv run --no-sync pytest tests` after the venv is provisioned with `pocket-tts` + `livekit-agents`; or run via the documented cold-managed `gate-d-cold` harness which provisions Python 3.12 and the locked deps in one step. |

## Scope decision

The autonomous campaign defined in the v2.1 plan (R0–R14) includes
six phases that depend on physical hardware and credentials not
present in this 01:17 CEST session:

- R3 (Native Android audio) — requires Xiaomi with rebuilt APK.
- R5 (Streaming STT bake-off) — requires Windows + Android real audio.
- R7 (Pocket Android runtime) — requires Xiaomi with rebuilt APK and
  sherpa-onnx / PocketTTS.cpp measured against the Kyutai Python
  reference.
- R9 (Real full-duplex) — requires Windows + Android with speaker
  routing and barge-in measurement.
- R12 (Android standalone qualification) — five-language physical
  evidence; the campaign exit gate.
- R14 (Production hardening) — needs signed packages.

Five phases can advance without that hardware, but each one is a
multi-hour commit-merge-test cycle that does not fit a 01:17 CEST
session without an explicit scope lock from the user. They are:

- R0 (baseline) — already done above.
- R1 (portable speech inference research) — needs downloads and a
  pinned reference run, ~1–2 hours.
- R2 (shared turn semantics design) — code archaeology and ADR
  amendments, ~1 hour.
- R6 (AgentBridge streaming parity) — TypeScript refactor with
  regression tests, ~2 hours.
- R11 (resource scheduler) — depends on R6, ~1–2 hours.

## Recommended next session

When the user resumes this work, the smallest next action is to:

1. Plug in a microphone or enable a USB/Bluetooth endpoint.
2. Authorize a Windows machine or admin path that can change firewall
   rules and grant RTC UDP for the LiveKit loopback server.
3. Run the cold-managed `gate-d-cold` Python provisioning script to
   bring the voice-host venv up to date with locked dependencies.
4. Rebuild the APK from a known SHA, install on Xiaomi, and capture
   the real failure trace (or the real Live trace) before any
   architectural decision is taken on top of it.

Until then, the architectural decision matrix from RFC
`RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md` remains the authoritative
draft and the gate evidence from `voice-current-state-2026-09-25.md`
remains the truthful current state.

## Verdict

**Status: IMPLEMENTATION COMPLETE / PRODUCTION QUALIFICATION
BLOCKED.** This session produced one documentation commit that
freezes the architectural proposal and the current-state snapshot.
GO PROD remains unachievable until the physical gates above are
cleared on a future session with the required hardware, environment
and credentials.