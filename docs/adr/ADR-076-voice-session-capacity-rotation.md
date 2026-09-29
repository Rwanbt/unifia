<!-- SPDX-License-Identifier: MIT -->
# ADR-076: Voice session capacity rotation

**Date**: 2026-09-26 | **Status**: Accepted

## Context

VoiceCore durably remembers up to 4,096 issued message IDs per canonical Unifia session. Dropping old IDs would allow a replay after process recovery, so VoiceCore must fail closed at capacity. A permanent failure after 4,096 Live turns is also not acceptable.

## Decision

Before reserving a turn, the Android Live adapter checks the persisted VoiceCore capacity. At zero capacity it forks the canonical Unifia session, which copies the complete message history, and only then opens a fresh VoiceCore snapshot for the fork. The existing session remains intact. Session forks preserve the source session's explicit permission rules and permission mode. If capacity cannot be read, the session cannot be forked, or the fork cannot be activated, the new prompt is not submitted.

## Alternatives rejected

- Evict old turn IDs: weakens durable replay protection and allows previously submitted IDs to be reused.
- Reset VoiceCore under the same Unifia session ID: loses replay fences while retaining the old canonical conversation.
- Submit first and rotate later: permits the SDK turn to exist without a durable reservation.

## Consequences

The Voice conversation continues in a forked Unifia session after 4,096 reserved turns. Its message history and permission policy are preserved, while the new VoiceCore snapshot starts a fresh bounded replay window. The previous session and its replay fences remain available. Rotation requires the Unifia fork API; if it is unavailable, Voice fails closed before sending the turn.
