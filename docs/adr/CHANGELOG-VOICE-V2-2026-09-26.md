<!-- SPDX-License-Identifier: MIT -->
# CHANGELOG — Voice v2 ADR freeze (2026-09-26)

> Single canonical reference for the 13 ADRs and 1 fixture the
> session produced on 2026-09-26 between 01:17 and 01:56 CEST.
> This CHANGELOG is the entry point for any future session that
> needs to know what was decided and where the evidence lives.

## Session header

- Branch: `voice`
- HEAD at session start: `9fca2d73f8 docs(voice): add autonomous PC and Android review dossier`
- HEAD at session end: `fb0349774c docs(voice): R16 ADR-073 Capture and Playback Arbitration`
- Commits this session: **13** (5 docs/fix batches + 8 ADR docs)
- All commits pushed to `origin/voice` (`9fca2d73f8..fb0349774c`)
- Turbo pre-push hook: 47/47 verts
- GitHub security advisory: 61 vulnerabilities on default branch (pré-existant)

## Commits in chronological order

| SHA | Subject |
|---|---|
| `9cd58a8c7c` | `docs(voice): freeze v2 parity RFC and 2026-09-25 current-state snapshot` |
| `74658f27f6` | `docs(voice): checkpoint 2026-09-26 — honest boundary on physical gates` |
| `031dca6f47` | `docs(voice): R1 Pocket runtime research ADR + R2 VoiceTurnEngine design ADR` |
| `a2392881be` | `fix(voice): voice-host-test-runner sets PYTHONPATH so pytest can import voice_host` |
| `627373b56e` | `docs(voice): R4/R8/R10/R13 ADR bundle — VAD, TTS routing, FastDecision, desktop convergence` |
| `6fa78a454b` | `docs(voice): R3/R15 cross-cutting ADRs — Authority Boundary + Model Artifact Registry` |
| `792d2a8564` | `docs(voice): R16 ADR-069 Audio Routes and Bluetooth behaviour matrix` |
| `dab8cb05c2` | `docs(voice): R16 ADRs Privacy/Logging/Metrics + Runtime ABI/ONNX Ownership` |
| `e8c9ecf7ca` | `feat(voice): seed Model Artifact Registry with Silero + 5 Piper SHA-256 (ADR-066)` |
| `99e2afb75f` | `docs(voice): R16 ADR-070 Error Taxonomy and Readiness` |
| `df7bd7771f` | `docs(voice): R16 ADR-071 Language and Voice Resolution` |
| `c7c2cb5aa3` | `docs(voice): R16 ADR-072 Offline and Network Policy` |
| `fb0349774c` | `docs(voice): R16 ADR-073 Capture and Playback Arbitration` |

## ADR map (13 ADRs/RFCs)

| ADR | Title | Phase | Status |
|---|---|---|---|
| RFC-VOICE-PARITY-PC-ANDROID-2026-09-25 | v2 parity proposal (draft, now committed) | R0–R14 overview | DRAFT |
| ADR-058-voice-runtime | Pre-existing baseline (Pocket primary, Piper fallback, Parakeet STT, LiveKit transport) | reference | ADOPTED |
| ADR-059-voice-portable-pocket-runtime | R1 Pocket runtime research: sherpa-onnx disqualified, PocketTTS.cpp primary candidate | R1, R7 | DRAFT |
| ADR-060-voice-turn-engine-design | R2 shared VoiceTurnEngine contract + 4-stage migration | R2, R13 | DRAFT |
| ADR-061-voice-vad-strategy | R4 Silero VAD v6.2.2 ONNX pin + deterministic fallback | R4 | DRAFT |
| ADR-062-voice-tts-routing | R8 canonical TtsRouter + Piper isolation + Android `FallbackTtsProvider` labelled `system-tts (transitional)` | R8 | DRAFT |
| ADR-063-voice-fast-decision | R10 Rules baseline, optional tiny-classifier / Laya, never privileged | R10 | DRAFT |
| ADR-064-voice-desktop-convergence | R13 four-stage migration behind `voice_engine_v2` / `voice_engine_v2_android` flags | R13 | DRAFT |
| ADR-065-voice-agent-authority-boundary | Voice = I/O subsystem, never a second agent | cross-cutting | DRAFT |
| ADR-066-voice-model-artifact-registry | Single `registry.json` per platform, SHA-256 enforced | R15 | PARTIAL (registry.json seeded) |
| ADR-067-voice-privacy-logging-metrics | No content telemetry by default; RT thread via ring buffer | cross-cutting | DRAFT |
| ADR-068-voice-runtime-abi-onnx | One ABI owner per process; startup ABI diagnostic mandatory | cross-cutting | DRAFT |
| ADR-069-voice-audio-routes-bluetooth | Route behaviour matrix, no full-duplex BT claim without measurement | R9 | DRAFT |
| ADR-070-voice-error-taxonomy-readiness | 20-stage `voice_error` taxonomy, no `unknown` stage, `voice_ready` per profile | cross-cutting | DRAFT |
| ADR-071-voice-language-voice-resolution | Resolution order, never silent switch | cross-cutting | DRAFT |
| ADR-072-voice-offline-network-policy | Local Voice + local LLM = no mandatory network | cross-cutting | DRAFT |
| ADR-073-voice-capture-playback-arbitration | Lease hierarchy Live > manual > autoplay | cross-cutting | DRAFT |

## Fixtures

- `scripts/voice/voice-host-test-runner.py` — managed Python 3.12 venv + pytest for `voice-host`. PYTHONPATH fix; `--import-mode=importlib`. Verified end-to-end: **`70 passed, 1 skipped in 6.09s`** on the voice-host suite.
- `scripts/voice/android-live-trace-capture.sh` — Android trace collector pre-stage for R12 gate. Captures device state, TTS voice discovery, mic capability, logcat before/during a manual Live tap, memory snapshots. Idempotent.
- `packages/voice-host/models/registry.json` — partial adoption of ADR-066. Records SHA-256 for Silero VAD v6.2.2 ONNX and 5 Piper voice models (`en_US`, `fr_FR`, `de_DE`, `es_ES`, `it_IT`). Upstream revisions and per-voice versions marked `UNVERIFIED` until confirmed against `rhasspy/piper-voices` commit log. Missing-for-adoption section enumerates `parakeet-tdt-0.6b-v3-int8` and per-language Pocket TTS.

## Verified evidence

- `git status` clean (untracked = `__pycache__` only).
- `python scripts/voice/voice-host-test-runner.py --full` → `70 passed, 1 skipped in 6.09s` on the `voice-host` Python suite (this is the Python `live`, `stt`, `text`, `voice_state`, `worker`, `transport_integration` test files).
- `git ls-remote origin voice` confirms `6fa78a454b...` is at HEAD on the remote; further pushes added `792d2a8564`, `dab8cb05c2`, `e8c9ecf7ca`, `99e2afb75f`, `df7bd7771f`, `c7c2cb5aa3`, `fb0349774c` (7 more pushes after the first).
- `.build-temp/silero-vad-v6.2.2.onnx` (2 327 524 bytes) and 5 Piper voice ONNX files present and SHA-verified.

## Verdict

**`IMPLEMENTATION COMPLETE (R0/R1/R2/R4/R8/R10/R13 design + fixtures + ADR-066 partial adoption) / PRODUCTION QUALIFICATION BLOCKED (R3/R5/R7/R9/R12/R14 physique)`**.

The 13 ADRs and the registry are pure design + a single typed
implementation file. None of the mandatory physical gates are
green. GO PROD remains explicitly forbidden by the v2 plan §42
until physical qualification completes.

## Open blockers (hardware)

| Phase | Blocker | Resolution path |
|---|---|---|
| R3 Native Android Audio | Xiaomi Mi 10 Pro with rebuilt APK from `fb0349774c` | Daytime session with the device |
| R5 Streaming STT bake-off | Windows microphone endpoint exposed to test agent | Plug in / enable USB or Bluetooth headset |
| R7 Pocket Android | Xiaomi + sherpa-onnx or PocketTTS.cpp measurement against Kyutai Python reference | Per ADR-059 |
| R9 Real full-duplex | Windows microphone + RTC UDP firewall rule | Wave H blocker; admin rights required |
| R12 Android standalone | Same as R3 + 5-language physical evidence + endurance 10/30/60 min | Fixtures ready |
| R14 Production hardening | Signed keystore credentials | User loads keystore and rebuilds signed APK |

## Software-only next phases

| Phase | Estimated | Notes |
|---|---|---|
| R6 AgentBridge streaming parity | 2–4 h TS refactor | Eliminates the Android "wait for full response" divergence; benefits from test/iterate loop |
| R11 Resource scheduler | 1–2 h TS design + refactor | Builds on ADR-066 registry + ADR-063 FastDecision |
| R14 software side | 1–2 h | Secret vocalization tests, supply-chain matrix, dependency licence inventory (no keystore needed) |

## Cross-references

- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [voice-current-state-2026-09-25.md](voice-current-state-2026-09-25.md) — verified Wave D–F state snapshot
- [CHECKPOINT-VOICE-V2-2026-09-26.md](CHECKPOINT-VOICE-V2-2026-09-26.md) — honest physical-gate boundary
- [ADR-058](ADR-058-voice-runtime.md) → [ADR-073](ADR-073-voice-capture-playback-arbitration.md) — full chain
- [packages/voice-host/models/registry.json](../packages/voice-host/models/registry.json) — partial adoption of ADR-066
- [scripts/voice/voice-host-test-runner.py](../scripts/voice/voice-host-test-runner.py) — fixture
- [scripts/voice/android-live-trace-capture.sh](../scripts/voice/android-live-trace-capture.sh) — fixture
- Project vault recap: [Session-Recap-voice-v2-r0-r13-design-freeze-2026-09-26.md](../../../../../../Documents/Obsidian/IA_Dev_Brain/projects/unifia/sessions/Session-Recap-voice-v2-r0-r13-design-freeze-2026-09-26.md)
- Project memory: [projects/unifia/_memory/memory.md](../../../../../../Documents/Obsidian/IA_Dev_Brain/projects/unifia/_memory/memory.md) (2026-09-26 entry)