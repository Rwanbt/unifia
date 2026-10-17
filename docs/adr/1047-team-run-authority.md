<!-- SPDX-License-Identifier: MIT -->

---
id: 1047
title: Team/Work run control — one registry, several entries
status: ACCEPTED
date: 2026-10-17
ratified: 2026-10-16
related: [1034]
---

# ADR-1047: Team/Work run control — one registry, several entries

## Context

RC-1 lot PW05 (#570). The owner ratified **6A** on 2026-10-16 (PR #747):
keep `TeamApplicationService`/`TeamStore` as the single run/control
authority across the native, HTTP and UI/CLI entries; fix the registry
divergence on top of #713 after non-regression proof; and keep
`@unifia/workbench-orchestrator` deferred — "jamais un deuxième
scheduler/run writer". The acceptance criteria: map the package contracts
against the shipped authority, wire only on required behavior, prove no
dual-write task/run authority, and state the reachability classification.

Before #713, there were two registries: `server/routes/team.ts`
constructed its own `TeamRunRegistry` while `runOpenCodeTeam` defaulted to
another. A run started through the native entry therefore could not be
paused, resumed or cancelled over HTTP. #713 (merged 2026-10-16) made the
registry process-wide and had both entries reach it; its own WHY records
the constraint: "the native Team tool and HTTP lifecycle endpoints must
control the same in-process runs; isolated registries make durable tool
runs impossible to pause."

The shipped pieces this ADR names:

- `packages/unifia/src/team/run-registry.ts` — `TeamRunRegistry`:
  `register`/`pause`/`resume`/`cancel`/`status`/`finish`, per-run
  `AbortController`, concurrency bound `MAX_ACTIVE_TEAM_RUNS = 4`, and the
  process-wide `teamRunRegistry` singleton.
- `packages/unifia/src/team/opencode-application.ts` — `runOpenCodeTeam`
  is the single run entry: it registers with the registry
  (`options.registry ?? teamRunRegistry`), opens `TeamStore`
  (`team.db`, default) and runs `TeamApplicationService` under the run
  `control` (`service.run({ ...control }, control.signal)`).
- Entries that exist today: the native Team tool
  (`src/tool/team.ts` → `runOpenCodeTeam`) and the HTTP lifecycle routes
  (`src/server/routes/team.ts` → the same singleton for
  register/finish/status and `pause|resume|cancel`, plus `controlStatus`
  on reads). The desktop/web UI drives those routes. The CLI's Team
  surface (`src/team/team-cli.ts`) manages leases and worktrees, not runs:
  there is no separate run-control entry to align today.
- `packages/workbench-orchestrator/src/index.ts` —
  `MultiWorkspaceRouter` (routes every workspace to **one** injected
  `RuntimeAdapter`; isolation by scoping, not by multiplying runtimes) and
  `WorkbenchOrchestrator` (workspace leases: open/use/close/evict/health;
  "the orchestrator never creates or disposes the runtime"). It has no
  concept of runs. Its manifest reason is generic ("tested engine with no
  importer"), which reads as unfinished work rather than a decision.

## Decision

**1. One run authority, one control surface.** The shipped run authority
stays `TeamApplicationService` + `TeamStore` (6A). Its live control
surface is the process-wide `teamRunRegistry`: per-run
pause/resume/cancel/status and the concurrency bound. Every entry reaches
that registry through `runOpenCodeTeam`, which never constructs a private
registry, and durable run/task state stays in `TeamStore` — there is no
second writer.

**2. No second authority, pinned two ways.** Behaviorally, #713's test
("controls a run started through the native Team application entry" in
`test/server/team-routes.test.ts`) proves HTTP lifecycle controls operate
a natively started run. Structurally,
`test/team/single-run-authority.test.ts` asserts exactly one
`new TeamRunRegistry(` construction site in `src/` (the singleton) and
that both shipped entries reach it; it fails RED the day a second
registry appears. Pause/resume/cancel semantics stay owned by
`test/team/run-registry.test.ts`.

**3. `workbench-orchestrator` stays `deferred-runtime`.** Its contract is
workspace lifecycle bookkeeping over one runtime — not run control — and
wiring it now would risk exactly the second scheduler/run writer 6A
forbids. Adoption requires a demonstrated REQUIRED need, its own ADR, and
integration that reports to the same run authority (never a concurrent
one), with ownership, shutdown and idle-eviction evidence. Until then its
manifest entry states this disposition.

**4. Future entries bind here.** A new UI/CLI or automation entry that
wants run control must go through the same singleton and extend the same
tests; it must not introduce a registry of its own.

## Rejected alternatives

- **Per-entry registries** (the pre-#713 state): splits the control
  plane; a durable run started natively cannot be paused over HTTP. #713
  fixed precisely this, and the structural guard keeps it fixed.
- **Make `WorkbenchOrchestrator` the run authority**: it has no run or
  control concept, and granting it one would create the second run writer
  6A forbids while competing with `TeamStore` persistence.
- **Import `workbench-orchestrator` for reachability**: the
  false-reachability import ADR-096 already rejected; the manifest
  classification exists to state the truth, not to green a check.

## Consequences

- New run entries and controls have exactly one place to bind, and the
  guard test fails when a second construction site appears.
- `@unifia/workbench-orchestrator` remains adoptable later without ever
  repointing run control.
- The manifest no longer reads as an unfinished task: the entry names the
  disposition and the conditions its successor must meet.

## References

- #570 (PW05), #713 (registry unification), PR #747 (ratified 6A),
  ADR-1034 (token capability scope vs approval broker), ADR-096
  (canonical knowledge authority — false-reachability import rejection).
