<!-- SPDX-License-Identifier: MIT -->
# ADR-082: Voice future native duplex provider — reserved interface, no authority bypass

**Date**: 2026-09-27 | **Status**: Reserved / DRAFT (no implementation; no candidate selected; non-functional in v2.2)

## Context

Speech-to-speech / native duplex models (single forward pass over audio in and audio out) are an active research area. The campaign must not freeze the architecture in a way that prevents their future adoption, but it also must not let a future "native duplex" path silently replace the canonical Unifia authority chain. §2 is absolute: only the canonical Unifia session owns the LLM, tools, secrets, and permissions. §10 reserves an interface so future work does not have to bolt a duplex model onto the side.

## Decision

A `NativeDuplexProvider` interface slot is reserved in the canonical provider router. The slot is **non-functional in v2.2**: no candidate is selected, no model is pinned, no runtime ships, and no production path exists. The router treats the slot as `disabled` until a real implementation lands.

Any future implementation that fills the slot must satisfy five non-negotiable constraints:

1. **Provider, not agent.** The duplex runtime is an input/output provider. It does not own the LLM, the tools, the secrets, or the permissions. It may stream audio in and out; it may stream semantic events (intent, transcript deltas, partial tool proposals); it must never execute a tool, accept a permission, or read a secret.
2. **Canonical event channel.** Every semantic event the duplex runtime emits crosses the same `packages/voice-core` event surface as the existing STT / SpeechRenderer / TTS chain. The ordering, generation fence, session ID, turn ID, sequence number, and error envelope are unchanged. Consumers (VoiceCore, the renderer, the segmenter, the error path) cannot tell whether the source is a duplex provider or the canonical chain.
3. **Tool / permission handoff to Unifia.** When the duplex runtime surfaces a tool call or a permission request, it is forwarded to the canonical Unifia session through the existing prompt / permission surface. The duplex runtime does not shortcut the approval broker, the capability set (ADR-1038), or the connection-lease scope (ADR-1034). The user sees the same permission UI as today.
4. **Opt-in per language, opt-out by default.** A duplex provider is selected only when (a) the user explicitly opts in for the session, (b) the chosen language is on the supported list, (c) the model is pinned and registry-validated (§14), and (d) the resource scheduler grants a lease (§29). The default selection remains the canonical STT → LLM → SpeechRenderer → TTS chain.
5. **Barge-in / cancellation / recovery parity.** Acoustic barge-in (§27), turn cancellation, duplicate-turn prevention (ADR-081), and the AEC chain (ADR-079) all apply unchanged. The duplex runtime must accept the same abort signals, observe the same generation fences, and yield the same barge-in latency budget as the canonical chain. It does not get a "we are special" exemption.

## Alternatives rejected

- **Bypass VoiceCore entirely for duplex**: violates §2 and the absolute invariant that only the canonical Unifia session owns authority.
- **Shortcut Unifia's approval broker / capability set / connection-lease scope**: violates §2 and the broker architecture in ADR-1034 / ADR-1038.
- **Replace the streaming STT + SpeechRenderer + TTS chain silently for "performance"**: violates §26 (no silent cloud, no masquerading fallback) and §39 (no weakening of the canonical chain to make a different chain pass).
- **Ship a duplex provider that does not satisfy constraints 1–5 above**: out of policy; the slot stays disabled.

## Consequences

Zero runtime impact today. Future work that fills the slot must (a) satisfy constraints 1–5, (b) pass the existing Voice test suites without modification to the canonical chain, (c) carry `Status: IMPLEMENTED host` first and `IMPLEMENTED physical` / `QUALIFIED physical` only after device evidence is attached, (d) update the model registry with a pinned revision / SHA / licence, and (e) update the gate row in `docs/operations/voice-v2-autonomous-state.md`. The §45 targets and the §27 barge-in targets are unchanged. No Laya-like experimentation is allowed in this slot — research stays in research until a candidate wins the Unifia benchmark and is pinned to an immutable revision.
