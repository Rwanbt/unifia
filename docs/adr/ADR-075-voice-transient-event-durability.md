# ADR-075: Voice transient event durability

**Date**: 2026-09-26 | **Status**: Accepted

## Context

The VoiceCore snapshot stores session generation, issued turn IDs, and the monotonic clock; it is not an event log. Persisting every `assistant_text_delta` rewrites and flushes that snapshot for each model token, adding disk latency to the live stream without retaining the delta payload for replay.

## Decision

VoiceCore assigns each assistant text delta its normal in-process sequence number and generation but does not write a snapshot for that event. The next durable event checkpoints the current clock. User turn IDs remain durably reserved before the canonical Unifia prompt is submitted. Assistant message content remains owned by the canonical Unifia session store; the VoiceCore snapshot does not duplicate event payloads. Recovery increments the session generation and restarts its sequence, fencing every transient event from the prior process.

## Alternatives rejected

- Persist every delta: adds synchronous disk work to each token while the snapshot still cannot replay the text.
- Omit deltas from VoiceCore: leaves a sequence gap between canonical turn submission and final response.

## Consequences

Transient text deltas are ordered within their process generation but are not replayed after a crash. Recovery can lose in-flight deltas, while the already-submitted user message remains protected from duplicate replay and completed assistant text can be recovered from the canonical session store. Consumers must discard events from stale generations.
