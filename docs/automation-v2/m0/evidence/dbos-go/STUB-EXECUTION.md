<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# DBOS_GO_SQLITE — STUB Execution Evidence

> Source normative : `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
> §8 (DBOS Go rules) + §9 (IPC) + §15 (real multi-process).
>
> Le M0 ne peut pas exécuter DBOS Go sur cette machine (Go toolchain
> absent). Ce fichier documente la configuration prévue et les
> conditions de déblocage.

## 1. Configuration pinned (DBOS Go + SQLite)

| Paramètre | Valeur | Justification |
|---|---|---|
| DBOS Go version | `github.com/dbos-inc/dbos-transact-go@v1.0.0` (planned) | API publique stable (DBOS Go 1.0 GA) |
| Go version | `go1.22.0` | minimum pour DBOS Go 1.0 |
| SQLite driver | `modernc.org/sqlite v1.34.5` (planned) | pure-Go, no cgo (per pack gelé §7) |
| `journal_mode` | `WAL` | concurrence read/write |
| `synchronous` | `FULL` | M0 strict (durabilité > performance) |
| `busy_timeout` | `5000 ms` | writer contention tolerance |
| `foreign_keys` | `ON` | intégrité référentielle |
| `max_open_conns` | `8` | à benchmarker en PRE-1.1 |

## 2. Process model (esquissé)

```
Harness TS (Bun)
   |
   +-- HTTP client (loopback, ephemeral port)
   |
   +-- DBOS Go process (binary, single instance per workspace)
         |
         +-- DBOS Conductor (workflow orchestration)
         |     |
         |     +-- Approval Broker V2 (custom, in-process)
         |     +-- Capability Authority (custom, ADR-024 wrapper)
         |
         +-- SQLite database (file-based, WAL)
         |
         +-- Step retry/timeout/cancellation (DBOS built-in)
         |
         +-- Monitoring (Prometheus, TBD)
```

## 3. IPC contract (HTTP/REST)

Endpoints per `DBOS_GO_IPC_SKETCH` :

```
GET  /version        — candidate info
GET  /healthz        — health check
POST /runs           — start a run
GET  /runs/:runId    — inspect a run
POST /runs/:runId/invocations/:logicalInvocationId/attempts — drive attempt
POST /approvals      — submit approval
POST /approvals/:approvalId/resolve — resolve approval
GET  /approvals/:approvalId
POST /timers         — schedule durable timer
GET  /timers/:timerId
POST /admin/crash    — force process crash
POST /admin/backup
POST /admin/restore
```

## 4. Conditions de déblocage

Voir `docs/automation-v2/m0/M0_BLOCKED.md` §2.

## 5. M0 evidence de blocage

```
$ (Get-Command go -ErrorAction SilentlyContinue) -eq $null
True

$ (Get-Command sqlite3 -ErrorAction SilentlyContinue) -eq $null
True

$ Test-Path D:\App\Go
False
```

## 6. Action immédiate

1. Installer Go 1.22+ (https://go.dev/dl/)
2. `go mod init` + `go mod tidy` dans un sous-package DBOS Go
3. Implémenter le binaire Go
4. Re-run `bun test test/qualification.test.ts` avec DBOS non-stub

## 7. Source

- `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md` §7, §8, §9
- `docs/automation-v2/m0/DBOS_ADAPTER.md`
- `docs/automation-v2/m0/M0_BLOCKED.md` §2
- `packages/automate-m0-harness/src/qualification/adapters/dbos-go.ts` (STUB)
