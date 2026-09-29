<!-- SPDX-License-Identifier: MIT -->
# ADR-081: Voice session recovery — durable reservations, snapshot rotation, fail-closed recovery

**Date**: 2026-09-27 | **Status**: Partially Implemented (G2 + ADR-076; Android lifecycle / screen lock / model eviction / route loss / worker crash coverage still unverified on device)

## Context

§10 and §32 require that Voice survive process kill, OS suspend / resume, screen lock, model eviction, audio route loss, worker crash, and duplicate-turn injection. The canonical Unifia session owns the authority chain (LLM, tools, secrets, permissions); Voice must not bypass it on recovery. A turn that was submitted before a kill must not be resubmitted as a fresh turn on relaunch; a recovery that cannot prove the prior turn's reservation must fail closed.

## Decision

Voice recovery rests on three layered invariants, each with its own ownership and fail-closed behaviour.

**1. Durable canonical message reservation (per turn).** Before any SDK prompt call, the Android Live adapter reserves the canonical Unifia `messageID` inside the persisted VoiceCore snapshot. The reservation records the message ID, the reservation timestamp (monotonic), the session ID, and the generation fence. If the reservation cannot be persisted, the SDK prompt is not issued. This is the same primitive that gates the prompt in the happy path; on recovery it is the single source of truth for "this turn was already submitted."

**2. Snapshot rotation at capacity.** VoiceCore remembers up to 4,096 reserved message IDs per canonical session. Before the 4097th reservation, Android Live forks the canonical Unifia session — copying the complete message history and permission policy — and opens a fresh VoiceCore snapshot under the fork. The source session and its replay fences remain available (ADR-076). If the fork API is unavailable, reservation fails closed and the turn is not submitted.

**3. Generation fencing and turn ordering.** Every event that crosses the C ABI carries: `session_id`, `turn_id`, monotonic timestamp, sequence number, and a per-session generation counter. A consumer that observes a generation lower than the highest seen for the session discards the event as stale. A reservation that observes a higher generation for the same turn ID also fails closed. Ordering tests in `packages/voice-core` cover duplicates, stale generation, out-of-order events, cancellation races, reconnect, and process recovery.

Process recovery reads the latest snapshot from app data on launch; suspend / resume keeps the snapshot in memory with the monotonic clock paused; screen lock does not delete reservations; model eviction invalidates loaded resources but not the reservations (the model can be reloaded under the same reservation chain). On audio route loss, the Oboe path emits `audio_route_changed` and VoiceCore pauses submission until a route is restored. On worker crash, the worker is restarted and the reservation chain is replayed; the SDK sees no turn until the chain is fully consistent.

## Alternatives rejected

- **In-memory reservations only**: lose them on process kill and double-submit turns.
- **Submit first, reserve later**: permits a duplicate turn under recovery races.
- **Reset VoiceCore under the same canonical session to gain capacity**: loses replay fences and exposes previously submitted IDs to reuse.
- **A single global generation counter across sessions**: collapses independent conversation lifecycles; per-session counters keep them isolated.

## Consequences

A Voice process that is killed mid-turn recovers on relaunch without re-submitting the turn; a process that loses its audio route pauses submission without losing the reservation; a process that exhausts its replay window forks the canonical conversation cleanly. The remaining gaps are device-side: Android lifecycle (Doze, App Standby, screen lock), model eviction under memory pressure, Bluetooth route loss on Xiaomi Mi 10 Pro, worker crash restart under sustained Voice load, and duplicate-turn injection by a third-party replay. These are tracked in the G2 / G3 / G9 rows of `docs/operations/voice-v2-autonomous-state.md` and are part of G12 (Android standalone) qualification.
