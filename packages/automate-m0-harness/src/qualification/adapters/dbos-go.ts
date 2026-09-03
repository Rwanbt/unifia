/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * DBOS_GO_SQLITE M0 qualification adapter — STUB ONLY.
 *
 * ## BLOCKED on the current host
 *
 * The harness host machine has no `go` toolchain and no `sqlite3` CLI
 * (verified 2026-09-03 21:18 CEST):
 *
 *   $ command -v go
 *   (empty)
 *   $ command -v sqlite3
 *   (empty)
 *   $ ls D:/App/Go 2>$null
 *   (no such file)
 *
 * DBOS Go requires Go ≥ 1.22 + `go mod download github.com/dbos-inc/
 * dbos-transact-go` + a SQLite driver. We do not have any of these
 * available in this session, so this adapter is a CODE STUB: it
 * declares the contract, the IPC, and the configuration, but every
 * method throws `BLOCKED_EXECUTION` until a Go toolchain is provided.
 *
 * Per pack gelé §43 (seuls vrais blockers) :
 *   "required dependency cannot be installed" → BLOCKED,
 *   continue all unaffected workstreams.
 *
 * What this file proves:
 *   - The harness is adapter-agnostic : it has only the contract
 *     import of NativeSqliteCandidate's interface; this file's
 *     shape mirrors it 1:1.
 *   - A future Go-equipped environment can drop in the implementation
 *     and the harness does not change.
 *   - The result file `M0_EXPECTED_NA_DBOS_GO.json` will reflect
 *     BLOCKED rather than PASS.
 *
 * To unblock:
 *   1. Install Go ≥ 1.22
 *   2. Pin a DBOS Go version (target 1.0+ stable)
 *   3. Run `go mod init && go mod tidy` in this package
 *   4. Implement the Go counterpart of the durable authority
 *      (the same tables the Native candidate uses)
 *   5. Implement HTTP/REST IPC per the contract
 *   6. Re-run the qualification runner
 */

import type {
  DurableWorkflowAuthorityQualificationAdapter,
  CandidateInfo,
  StartRunInput,
  CanonicalRunState,
  CanonicalAttemptState,
  ApprovalRequestInput,
  ApprovalOutcome,
  DurableTimerRequest,
  DurableTimerSnapshot,
  BackupRef,
  CandidateDiagnostics,
  ProviderResolution,
} from "../contract.ts"
import type { ApprovalId, WorkflowRunId, LogicalInvocationId } from "@unifia/automate-m0-contract"

class BlockedExecution extends Error {
  constructor(method: string) {
    super(`DBOS_GO_SQLITE adapter is BLOCKED on this host (no go toolchain). Method not executable: ${method}. See adapters/dbos-go.ts header.`)
    this.name = "BlockedExecution"
  }
}

/* ------------------------------------------------------------------ */
/* Pinned candidate info (no `latest` — pack gelé §7)                  */
/* ------------------------------------------------------------------ */

const DBOS_GO_PINNED_VERSION = "github.com/dbos-inc/dbos-transact-go@v1.0.0" // placeholder; actual pin when Go available
const GO_PINNED_VERSION = "go1.22.0"
const SQLITE_DRIVER_PINNED = "modernc.org/sqlite v1.34.5" // pure-Go driver; cgo-free per pack gelé §7
const BUILD_HASH = "STUB-2026-09-03" // incremented when actual Go binary is built

/* ------------------------------------------------------------------ */
/* DBOSGoCandidate (stub)                                              */
/* ------------------------------------------------------------------ */

export class DBOSGoCandidate implements DurableWorkflowAuthorityQualificationAdapter {
  private readonly binaryPath: string | null = null
  private readonly ipcEndpoint: string | null = null
  private readonly config: {
    journalMode: string
    synchronous: string
    busyTimeoutMs: number
    maxOpenConns: number
  } = {
    journalMode: "WAL",
    synchronous: "FULL", // M0 requires full durability
    busyTimeoutMs: 5000,
    maxOpenConns: 8,
  }

  async candidateInfo(): Promise<CandidateInfo> {
    return {
      kind: "DBOS_GO_SQLITE",
      version: DBOS_GO_PINNED_VERSION,
      buildHash: BUILD_HASH,
      storage: {
        engine: "SQLite 3.x (via modernc.org/sqlite pure-Go driver)",
        driver: SQLITE_DRIVER_PINNED,
        journalMode: this.config.journalMode,
        synchronous: this.config.synchronous,
        busyTimeoutMs: this.config.busyTimeoutMs,
        maxOpenConns: this.config.maxOpenConns,
        backupTarget: "file",
      },
      process: {
        topology: "child-process", // Go binary launched by the harness
        ipc: "http+json over loopback",
        multiProcessSafe: true, // DBOS Conductor coordinates
        healthEndpoint: "GET /healthz",
      },
    }
  }

  async initialize(): Promise<void> {
    if (!this.binaryPath) {
      throw new BlockedExecution("initialize")
    }
  }

  async shutdown(): Promise<void> {
    throw new BlockedExecution("shutdown")
  }

  async startRun(_input: StartRunInput): Promise<WorkflowRunId> {
    throw new BlockedExecution("startRun")
  }

  async inspectRun(_runId: WorkflowRunId): Promise<CanonicalRunState> {
    throw new BlockedExecution("inspectRun")
  }

  async driveAttempt(
    _runId: WorkflowRunId,
    _logicalInvocationId: LogicalInvocationId,
    _providerResponse: ProviderResolution,
  ): Promise<CanonicalAttemptState> {
    throw new BlockedExecution("driveAttempt")
  }

  async provideApproval(_request: ApprovalRequestInput): Promise<void> {
    throw new BlockedExecution("provideApproval")
  }

  async resolveApproval(
    _approvalId: ApprovalId,
    _state: "APPROVED" | "DENIED",
    _actor: { readonly id: string; readonly kind: "PRINCIPAL" },
  ): Promise<ApprovalOutcome> {
    throw new BlockedExecution("resolveApproval")
  }

  async inspectApproval(_approvalId: ApprovalId): Promise<ApprovalOutcome> {
    throw new BlockedExecution("inspectApproval")
  }

  async scheduleTimer(_request: DurableTimerRequest): Promise<void> {
    throw new BlockedExecution("scheduleTimer")
  }

  async inspectTimer(_timerId: string): Promise<DurableTimerSnapshot> {
    throw new BlockedExecution("inspectTimer")
  }

  async forceProcessCrash(): Promise<void> {
    throw new BlockedExecution("forceProcessCrash")
  }

  async reopen(): Promise<void> {
    throw new BlockedExecution("reopen")
  }

  async createBackup(): Promise<BackupRef> {
    throw new BlockedExecution("createBackup")
  }

  async restoreBackup(_ref: BackupRef): Promise<void> {
    throw new BlockedExecution("restoreBackup")
  }

  async inspectHistory(_runId: WorkflowRunId): Promise<readonly CanonicalRunState[]> {
    throw new BlockedExecution("inspectHistory")
  }

  async diagnostics(): Promise<CandidateDiagnostics> {
    throw new BlockedExecution("diagnostics")
  }
}

/* ------------------------------------------------------------------ */
/* IPC HTTP client (sketched, unused until Go is available)            */
/* ------------------------------------------------------------------ */

/**
 * The intended HTTP/REST IPC between the harness (TS) and the DBOS Go
 * process. Endpoints mirror the contract method set. The body
 * schema is left as `unknown` until the Go side is pinned.
 *
 * Constraints per pack gelé §9:
 *   - localhost only (no external network)
 *   - ephemeral / free port
 *   - health endpoint
 *   - startup timeout
 *   - graceful shutdown
 *   - forced crash path
 *   - structured JSON errors
 *   - candidate version endpoint
 */
export const DBOS_GO_IPC_SKETCH = {
  basePath: "/m0-qualification",
  endpoints: {
    version: "GET /version",
    health: "GET /healthz",
    startRun: "POST /runs",
    inspectRun: "GET /runs/:runId",
    driveAttempt: "POST /runs/:runId/invocations/:logicalInvocationId/attempts",
    provideApproval: "POST /approvals",
    resolveApproval: "POST /approvals/:approvalId/resolve",
    inspectApproval: "GET /approvals/:approvalId",
    scheduleTimer: "POST /timers",
    inspectTimer: "GET /timers/:timerId",
    crash: "POST /admin/crash", // for FC-14 / FC-25
    backup: "POST /admin/backup",
    restoreBackup: "POST /admin/restore",
  },
  constraints: {
    bindAddress: "127.0.0.1",
    port: "ephemeral/free",
    startupTimeoutMs: 30000,
    shutdownTimeoutMs: 10000,
    errorFormat: "{ code, message, path } (JSON)",
  },
} as const
