<!-- SPDX-License-Identifier: MIT -->

---
id: 1044
title: Scheduler and media-runtime dispositions - what ships, what waits
status: PROPOSED
date: 2026-10-15
related: [0008, 0022, 0074, 1043]
---

# ADR-1044: Scheduler/media disposition for RC-1 — one shipped arbitration, two deferred engines

## Context

RC-1 lot PW09 (#573) asks to wire the shared scheduler/media runtime
"where Automate/Voice/multimodal production paths need them, **without
creating parallel runtimes**". Two workspace packages are classified
`deferred-runtime` under it in `scripts/package-wiring.json`, and the
first measurement is that nothing imports either of them: no shipped
root, no test, not even the release-hardening gates.

- `@unifia/scheduler` — trigger semantics: cron field parsing
  (`nextFireAt`), overlap decisions (`applyOverlap`), missed-slot
  catch-up (`applyCatchUp`), `TriggerBinding` validation. It is the
  engine FX03 (#556, scheduled and external-triggered Automate runs)
  describes in its acceptance criteria, and FX03 has no production
  implementation yet.
- `@unifia/media-runtime` — a media provider registry
  (`createMediaProviderRegistry`, filesystem provider, kind/extension
  resolution). No shipped surface registers a media provider.

Meanwhile Voice, the media production path that actually ships, has
its own arbitration and it is wired: the app holds
`packages/app/src/voice/resource-scheduler.ts` over the scheduler
contract in `@unifia/contracts/voice-resource-scheduler` (ADR-074), and
the lease semantics are tested in `resource-scheduler.test.ts` —
priority preemption and eviction under memory and thermal pressure,
TTL expiry and renewal, abort before acquisition, realtime-audio leases
never evicted, and desktop/local-llm GPU ownership disabling Voice VRAM
allocation (ADR-074 §4). Durable scheduled semantics that do ship live
in the workflow runtime's history and timers (ADR-004, ADR-008,
ADR-022), which is the same authority every run already enters.

## Decision

**1. The shipped scheduling/media authorities are named, and neither
is a package under disposition.** Scheduling authority for RC-1 is the
workflow runtime's durable timers and history — every run, manual or
otherwise, enters the same canonical run authority; a second scheduler
reaching shipped code would be the parallel runtime the issue forbids.
Media/voice arbitration authority is
`@unifia/contracts/voice-resource-scheduler` with the app's
`voice/resource-scheduler.ts`, per ADR-074.

**2. `@unifia/scheduler` is deferred, tracked by FX03 (#556).** Wiring
it now would mean implementing scheduled and external-triggered runs —
FX03's own scope, with its own acceptance criteria (same canonical
authority, idempotency, missed-run policy, rate limiting, audit). When
FX03 lands, this package is its intended engine; until then the
manifest entry says so, and the RC-1 scheduling authority stays the one
in decision 1.

**3. `@unifia/media-runtime` is deferred, post-RC-1.** No RC-1
production path registers media providers; Voice's media needs are met
by the arbitration of decision 1 and the speech pipeline already
shipped (STT/TTS over ONNX and the Pocket sidecar). A multimodal path
that would need the registry is not in RC-1 scope.

**4. The manifest carries the disposition.** Both entries name what
supersedes them for the shipped path, so the reachability gate stays
green while the reason answers "on purpose" rather than "not wired
yet".

Wiring either package later requires a new ADR plus a reachability
proof from a shipped root with a real consumer and tests — the same
rule ADR-1043 sets for the artifact stack.

## Consequences

- No product code changes: both dispositions are deferrals with
  evidence, not new wiring.
- "Voice/media ownership and resource arbitration are explicit" is
  answered by code and tests that already ship
  (`packages/app/src/voice/resource-scheduler.ts`,
  `resource-scheduler.test.ts`, ADR-074), not by the deferred package.
- "Cross-runtime resource contention tests exist where applicable" is
  answered by the same suite: the GPU-ownership test pins the
  desktop/local-llm ↔ Voice VRAM arbitration, which is the cross-runtime
  contention that exists today.
- When FX03 (#556) is implemented, its acceptance criteria — not this
  ADR — decide how `@unifia/scheduler` is wired, and this ADR is
  superseded at that point rather than quietly extended.
