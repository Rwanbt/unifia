<!-- SPDX-License-Identifier: MIT -->

---
id: 1050
title: Vault open-recovery runs only under the write lock
status: ACCEPTED
date: 2026-10-17
ratified: 2026-10-17
related: [096]
---

# ADR-1050: Vault open-recovery runs only under the write lock

## Context

`VaultMutationWriter` reconciles the vault when it opens it (#480 W-MUT-04, the
cross-process writer tier). Reconciliation completes commits that have a WAL
record and discards temporaries that have none — "no WAL record" being the
signature of a crashed, unfinished commit.

Across processes, an in-flight commit of a *live* second writer looks exactly
the same: a temporary without a WAL record yet. The opening writer therefore
discarded the live writer's commit underneath it, and the two writers
interleaved their reconciliation. The cross-process stress tier that would
have caught this was skipped unconditionally, and its child-script path
resolution was Windows-only, so it had never actually run on POSIX either.

## Decision

Opening reconciliation is a mutation and runs only while holding the vault
write lock.

- `WriteLock.tryWithLock` acquires non-blockingly: when a live writer holds the
  lock it returns `undefined` without running the work (only for the typed
  `mutation_refused`; every other failure still throws), and releases in
  `finally` otherwise.
- `VaultMutationWriter` opens with
  `this.lock.tryWithLock(() => recover(root, WAL_FILE)) ?? idle`. With a live
  writer holding the lock, the open performs **no** reconciliation: that writer
  finishes its own commit, and the deferred recovery happens on the next open
  that acquires the lock. `recoverOnOpen: false` still yields the idle report,
  and `lastRecovery` keeps reporting exactly what happened, for `doctor` and
  for the tests.
- Stale locks (a crashed writer) are reclaimed by the existing
  `reclaimIfStale` path, so crash recovery keeps working: the lock is free or
  reclaimed, and recovery runs.

## Rejected alternatives

- **Unconditional recovery on open (status quo)** — discards a live writer's
  in-flight commit; this is the root cause fixed here.
- **Blocking acquire in `open`** — a long-lived or wedged writer would hang
  every opener; the live writer finishes its own commit anyway, so waiting
  buys nothing.
- **Liveness marker (pid or heartbeat file) beside the lock** — a second
  authority defining "live writer" (pid reuse, heartbeat tuning) for the same
  guarantee the lock already carries.

## Consequences

- No open can destroy another live writer's in-flight commit; the worst case
  is a deferred recovery, reported as an idle `RecoveryReport`.
- The cross-process stress tier runs again in CI on Linux
  (`writer-stress.test.ts`, child path resolved with `fileURLToPath`, barrier
  counting `.ready` markers only), and `writer-open-recovery-lock.test.ts`
  pins the open-under-lock behavior. Windows keeps its `skipIf` with the
  recorded `EUNKNOWN uv_spawn` cause (`PHYSICAL_TEST_REQUIRED`), so the
  guarantee stays measured wherever the harness can actually run it.
- `mutation_refused` remains the single typed refusal for "another writer
  holds the vault", already handled by callers.
