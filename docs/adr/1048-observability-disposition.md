<!-- SPDX-License-Identifier: MIT -->

---
id: 1048
title: RC-1 observability — one shipped chain, and the logger foundation stays deferred
status: ACCEPTED
date: 2026-10-17
ratified: 2026-10-16
related: [1026, 1032]
---

# ADR-1048: RC-1 observability — one shipped chain, and the logger foundation stays deferred

## Context

RC-1 lot PW03 (#568). The owner ratified **7A** on 2026-10-16 (PR #747):
keep the observability chain the product actually uses, with its real
consumers; qualify and correct disclosure at the export boundary,
retention, errors, attribution and the redaction of every exportable
metadata (#717); `@unifia/observability` stays deferred — no parallel
logging authority and no production-reachability pretense; adopt it later
only under a disposition or ADR that replaces the existing authority or
adds a required function without duplication. The certification evidence is
a real HTTP proof and failure cases, at the exact SHA.

What ships is `packages/unifia/src/observability/` — one chain, one job per
stage:

- **Capture** — `service.ts` (bounded queue; a circuit breaker that
  classifies `SQLITE_BUSY`/`SQLITE_FULL`/`SQLITE_CORRUPT` and cools down
  for 30 s instead of dying silently) and `queue.ts`.
- **Sanitize** — `sanitizer.ts` + `field-classifier.ts` (with the fuzz
  suite); content opt-in and its storage per ADR-1032
  (`capture-content.ts`, `capture-policy.ts`, `content-optin.sql.ts`).
- **Store and retain** — `repository.ts`, `purge.ts`, schema
  `event.sql.ts`.
- **Project and export** — `export-projection.ts` (the ADR-1026 boundary:
  exporters only ever receive a validated `ExportProjection`, never a raw
  row and never content fields), `exporter.ts` (registry), `export-runner.ts`
  (retry), all driven by the single runtime in `runtime.ts` (flush 250 ms,
  retention 5 s, export 5 s / batch 500).
- **Disclosure correction (#717, merged 2026-10-16)** — exporter metadata
  redaction in `export-projection.ts` (+32/−8) and `sanitizer.ts` (+3/−1),
  covered by `test/observability/runtime-export.test.ts` (+85 lines).
- **HTTP surface** — `server/routes/observability.ts` and the exporters
  routes (`GET .../observability/exporters/config`,
  `GET .../exporters/preview/:eventId`, `POST .../exporters/test`), proven
  against a real in-process server in
  `test/server/observability-exporters-routes.test.ts`.
- **Consumers** — session recording (`session/llm.ts`,
  `session/processor.ts`), Task tool (`tool/task.ts`), crash reporting
  (`crash-reporter.ts`); the data views read the same events (ADR-050).

`@unifia/observability` (`packages/observability/src/index.ts`) is a
kernel-side logger foundation: a structured logger with four levels plus an
audit level, a `LogSink` output boundary, a zero-alloc hot path, and a
secret-leak canary. No shipped code imports it, its manifest reason is
generic, and its tracking issue is #568. Wiring it would put a second
logger/sink stack beside `util/log` and the event pipeline — the parallel
authority 7A refuses.

## Decision

**1. The canonical RC-1 observability authority is the shipped chain.**
Every stage above belongs to it; the export path keeps the single ADR-1026
projection gate; #717's redaction is the RC-1 disclosure correction. No
second logger and no second export path.

**2. `@unifia/observability` stays `deferred-runtime`.** Its manifest entry
states this disposition. Adoption starts only when a **demonstrated need**
exists, under its own ADR that either replaces the existing authority or
adds a function it lacks **without duplication**, with evidence against
real consumers: canary behavior, sink contracts, and the zero-alloc property
on the hot path.

**3. The invariants are pinned.**
`packages/unifia/test/observability/single-observability-authority.test.ts`
reads the shipped sources and asserts: no `src` file mentions
`@unifia/observability`; `new ObservabilityService(` has exactly one
construction site (`runtime.ts`); `toExportProjection` has exactly one
definition (`export-projection.ts`) and `runtime.ts` drives it. The guard
was validated RED (a planted import produced the expected failure) before
the GREEN run.

**4. Certification evidence follows the 7A text**: a real HTTP proof
(`observability-exporters-routes`), export and failure coverage
(`runtime-export` against a real local HTTP mock, `resilience`,
`export-runner`, the SQLite failure suites), retention (`purge`) and
redaction (`sanitizer`, `sanitizer-fuzz`) — all at the exact SHA.

## Rejected alternatives

- **Wire the package for reachability**: the false-reachability import
  ADR-096 already rejected; the manifest classification exists to state the
  truth, not to green a check.
- **Integrate its logger beside `util/log`**: two logging authorities in one
  process; 7A refuses it.
- **Delete the package**: it is the tested foundation a future ADR may
  adopt; deleting it discards that option without a replacement.
- **Let exporters bypass the projection**: ADR-1026's boundary exists
  precisely because raw rows can carry opt-in content; no exception.

## Consequences

- The RC-1 claim is precise: one chain, one projection gate, one driver,
  with a real HTTP proof and failure/retention/redaction coverage.
- The manifest no longer reads as unfinished work: the entry names the
  disposition and the conditions its successor must meet.
- The three invariants fail loudly if a later change re-opens a second
  authority.

## References

- #568 (PW03), #717 (export-boundary hardening), PR #747 (ratified 7A),
  ADR-1026 (ExportProjection boundary), ADR-1032 (content opt-in),
  ADR-050 (observability data views), ADR-096 (false-reachability import
  rejection).
