<!-- SPDX-License-Identifier: MIT -->
# ADR-063: Voice FastDecision / System-1 — Rules baseline, optional models behind evidence (2026-09-26)

> Companion to
> [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md),
> [ADR-059-voice-portable-pocket-runtime.md](ADR-059-voice-portable-pocket-runtime.md),
> [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md),
> [ADR-061-voice-vad-strategy.md](ADR-061-voice-vad-strategy.md),
> [ADR-062-voice-tts-routing.md](ADR-062-voice-tts-routing.md),
> and the
> [v2 parity RFC](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md).
> Drafts the FastDecision provider for R10 of the v2 plan.

## Context

The v2 plan §31 ("R10 — FastDecision / Laya Experiment") defines a
small classifier whose role is to (a) classify conversational intent,
(b) produce a confidence, and (c) propose interruption semantics.
The plan freezes "Rules is production baseline" and treats the
optional model (a small classifier or Laya) as Auto only when
measured evidence supports it.

This ADR is independent of Voice v2 production gates — it never
produces a privileged effect. The result of the FastDecision
provider is a **proposal** that the shared `VoiceTurnEngine` may
choose to apply for the **non-privileged** interruption semantics
(cancel TTS, propose barge-in timing). The agent remains the only
privileged actor (per ADR-058 §3.1 and the v2 plan §12).

A repository-wide grep for `Laya`, `FastDecision`, `fastDecision`,
and `fast_decision` returns zero hits in `packages/`. The provider
is a new module added in this campaign.

## Decision (proposed)

1. **Provider architecture** is canonical and lives in the shared
   `VoiceTurnEngine` package (per ADR-060). The contract is:

   ```ts
   export interface FastDecisionProvider {
     readonly name: "rules" | "tiny-classifier" | "laya" | "off"
     classify(input: FastDecisionInput): Promise<FastDecisionResult>
     warm(): Promise<void>      // load model / build lookup
     cool(): Promise<void>      // release model residency
     dispose(): Promise<void>   // destroy state
   }

   export type FastDecisionInput = {
     sessionID: string
     turnID: string | undefined
     finalTranscript: string          // stt_final text
     locale: VoiceLang                 // resolved locale
     conversationPhase: "idle" | "user" | "agent" | "tool" | "permission"
     audioPath: AudioRoute             // speaker / headset / bluetooth / etc.
   }

   export type FastDecisionResult = {
     intent: FastDecisionIntent
     confidence: number                // [0, 1]
     proposeBarge: boolean             // non-privileged: TTS mute + keep agent
     proposeCancelAgent: boolean       // only honored if the user asks through Unifia
     reason: string
   }

   export type FastDecisionIntent =
     | "acknowledge"
     | "wait"
     | "continue"
     | "repeat"
     | "cancel-speech"
     | "new-request"
     | "correction"
     | "permission-answer"
     | "noise"
   ```

2. **Production baseline is `Rules`**. The Rules backend is a pure
   deterministic implementation with explicit, reviewable phrase
   sets per language. The phrase sets are versioned in the model
   registry (per the v2 plan §15 ADRs on Model Artifact Registry,
   even though Rules is not a model).

   Initial phrase sets, language-neutral, conservative:

   | Intent | Pattern (any of) |
   |---|---|
   | `acknowledge` | "ok", "okay", "merci", "danke", "gracias", "grazie", "yes", "mm-hm", "mhm" |
   | `wait` | "wait", "arrête", "halt", "stop talking", "parla piano", "espera" |
   | `continue` | "continue", "go on", "weiter", "continúa", "vai avanti" |
   | `repeat` | "repeat", "encore", "nochmal", "di nuovo", "otra vez", "repita" |
   | `cancel-speech` | "stop", "silence", "silencio", "stumm", "silenzio", "arrête de parler" |
   | `noise` | empty or whitespace-only transcript after `stt_final` |

   Each Rules match produces `confidence = 1.0` for the matched
   intent. Anything not matched by Rules returns
   `confidence = 0`, `intent = "noise"`, `proposeBarge = false`,
   `proposeCancelAgent = false`. The agent remains the default
   decision-maker.

3. **Optional backends** are gated by evidence:

   - `tiny-classifier`: a small intent classifier (≤ 50 M params),
     pinned revision and SHA-256, five-language coverage, RTF < 0.05
     on the target device. Accepted only if it measurably improves
     over Rules without hurting voice resource budgets.
   - `laya`: only investigated if the runtime is feasible on the
     target device. The v2 plan explicitly forbids Laya from being
     an architectural dependency: it must be evidence-justified or
     removed.

   No sunk-cost bias. If a backend fails qualification, it stays
   experimental or is removed.

4. **No execution authority**: the FastDecision provider never
   performs a privileged effect. It can only:

   - Cancel TTS playback (Stage A barge-in).
   - Propose a barge-in timing suggestion.
   - Suggest that the current utterance looks like an
     acknowledgement/wait/cancel phrase so the UI can render a
     localised "got it" state.

   It may **not**:

   - Cancel a running tool operation.
   - Modify the agent's plan or model selection.
   - Touch secrets, files, Git, browser, MCP, memory, or project
     state.
   - Override Unifia permissions.

   These rules are the same on Windows and Android. The
   `FastDecisionProvider.dispose` path is wired into the same
   lifecycle as `VoiceTurnEngine.dispose`.

5. **Resource residency**: the Rules backend is essentially free
   (no model residency). The `tiny-classifier` and `laya` backends
   must participate in the R11 resource scheduler: their
   warm/cold/evict lifecycle is managed by the `ResourceScheduler`.
   On Android the optional backend is evicted under memory pressure
   before STT/TTS; on desktop it is never resident unless Live is
   active.

6. **Telemetry** (per the v2 plan ADR on Privacy, Logging and
   Metrics — to be drafted in a follow-up ADR):

   - Default: no transcript content is logged. Only timings,
     intent label, confidence, model ID, error code.
   - Content capture requires explicit debug/test mode. The
     FastDecision provider does not own this switch.

## Consequences

- A new `packages/contracts/voice/fast-decision.ts` contract is
  added. The desktop Python and Android TypeScript implementations
  both implement it.
- A new `RulesFastDecision` provider is implemented first; tests
  cover the phrase sets for EN/FR/ES/IT/DE (the five production
  languages) and edge cases (whitespace, mixed case, partial
  phrases).
- The optional `tiny-classifier` and `laya` adapters are added
  only after the R5/R7 bake-offs. They never replace Rules as the
  default; they participate in the Auto path only on devices that
  measured accuracy, RTF, RAM and thermal within the gate.
- The FastDecision provider is loaded behind the shared
  `VoiceTurnEngine`'s capability flags: `fast_decision.provider` is
  `rules` (default), `tiny-classifier`, `laya`, or `off`. Anything
  else is rejected at startup with a `voice_error` event.

## Open evidence requirements (R10 gate)

- Five-language `Rules` accuracy on a recorded corpus (precision,
  recall, F1 per intent). The corpus lives under `tests/voice/` and
  is recorded in the model registry.
- Warm / cold latency, RAM, CPU, five-language accuracy,
  calibration, false cancellation, false interruption for each
  optional backend. Numbers recorded in the gate evidence.
- Resource residency evidence (R11 gate): under Android memory
  pressure, `tiny-classifier` and `laya` are evicted before
  STT/TTS. Recorded evidence.

## Status

**DRAFT** — not adopted. The contract and the Rules baseline are
specified. Adoption requires the evidence above. The optional
backends are not part of this draft.

## References

- [ADR-058-voice-runtime.md](ADR-058-voice-runtime.md)
- [ADR-059-voice-portable-pocket-runtime.md](ADR-059-voice-portable-pocket-runtime.md)
- [ADR-060-voice-turn-engine-design.md](ADR-060-voice-turn-engine-design.md)
- [ADR-061-voice-vad-strategy.md](ADR-061-voice-vad-strategy.md)
- [ADR-062-voice-tts-routing.md](ADR-062-voice-tts-routing.md)
- [RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md](../rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md)
- [CHECKPOINT-VOICE-V2-2026-09-26.md](../CHECKPOINT-VOICE-V2-2026-09-26.md)