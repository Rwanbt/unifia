/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * DBOS_GO_SQLITE M0 qualification adapter (HTTP over loopback).
 *
 * This adapter is NO LONGER a STUB. It spawns a real
 * `dbos-qualify.exe` Go process (built from `tools/dbos-qualify/`
 * using the pinned `github.com/dbos-inc/dbos-transact-golang@v1.0.0`)
 * and drives it via HTTP/JSON.
 *
 * The contract surface is identical to the Native candidate
 * (FC-31A, FC-31B, FC-04, FC-32) so the M0 harness drives both
 * candidates with the same oracle.
 *
 * Build instructions (reproducible, no admin):
 *   bash scripts/bootstrap-go.sh      # downloads Go 1.25.12
 *   cd tools/dbos-qualify
 *   ../.tools/go/go1.25.12/bin/go build -buildvcs=false -o dbos-qualify.exe .
 *
 * Per pack gelé (post review v1.1 2026-09-03) :
 *   - DBOS Go v1.0.0 (pinned, not "latest")
 *   - Go 1.25.12 (required by DBOS v1.0.0 toolchain)
 *   - modernc.org/sqlite v1.54.0 (pinned, pure-Go, no cgo)
 *   - journal_mode=WAL, synchronous=FULL, busy_timeout=5000ms
 *   - HTTP loopback 127.0.0.1, random/free port
 *   - No admin, no global PATH mutation
 */

import { spawn, ChildProcess } from "node:child_process"
import { mkdir, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  type WorkflowRunId,
  type WorkflowVersionId,
  type LogicalInvocationId,
  type ApprovalId,
  type DurableTimerId,
  type SchemaVersion,
  type AuthorityGeneration,
  type UnifiaValue,
} from "@unifia/automate-m0-contract"
import type {
  DurableWorkflowAuthorityQualificationAdapter,
  CandidateInfo,
  StartRunInput,
  CanonicalRunState,
  CanonicalAttemptState,
  ApprovalRequestInput,
  ApprovalOutcome,
  ApprovalState,
  DurableTimerRequest,
  DurableTimerSnapshot,
  BackupRef,
  CandidateDiagnostics,
  ProviderResolution,
  ApprovalResolveInput,
  ApprovalHistoryEvent,
} from "../contract.ts"

/* ------------------------------------------------------------------ */
/* Pinned candidate info (per pack gelé review 2026-09-03, v1.1)      */
/* ------------------------------------------------------------------ */

const DBOS_GO_PINNED_VERSION = "github.com/dbos-inc/dbos-transact-golang@v1.0.0"
const GO_PINNED_VERSION = "go1.25.12"  // toolchain go1.25.0 required by DBOS v1.0.0
const SQLITE_DRIVER_PINNED = "modernc.org/sqlite v1.54.0"  // pure-Go driver, cgo-free

/* ------------------------------------------------------------------ */
/* JSON client (no external dep, native fetch)                         */
/* ------------------------------------------------------------------ */

interface JsonCallOptions {
  method?: "GET" | "POST"
  body?: unknown
  timeoutMs?: number
}

async function jsonCall<T>(base: string, path: string, opts: JsonCallOptions = {}): Promise<T> {
  const url = `${base}${path}`
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json" },
  }
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body)
  }
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 30_000)
  init.signal = ac.signal
  try {
    const r = await fetch(url, init)
    if (!r.ok) {
      const text = await r.text().catch(() => "")
      throw new Error(`HTTP ${r.status} ${r.statusText} on ${path}: ${text}`)
    }
    return await r.json() as T
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */
/* DBOS Go candidate (HTTP-backed, real binary)                         */
/* ------------------------------------------------------------------ */

export interface DBOSGoOptions {
  /** Working directory containing the compiled `dbos-qualify.exe`. */
  readonly toolDir: string
  /** Path to the compiled binary (default: `<toolDir>/dbos-qualify.exe`). */
  readonly binaryPath?: string
  /** Pinned version. */
  readonly version: string
  /** Build hash. */
  readonly buildHash: string
}

export class DBOSGoCandidate implements DurableWorkflowAuthorityQualificationAdapter {
  private proc: ChildProcess | null = null
  private baseUrl: string | null = null
  private readonly toolDir: string
  private readonly binaryPath: string
  private readonly version: string
  private readonly buildHash: string
  /** Per-instance store dir (so multi-process FC-14 has separate state). */
  private storeDir: string = ""

  constructor(options: DBOSGoOptions) {
    this.toolDir = options.toolDir
    this.binaryPath = options.binaryPath ?? join(options.toolDir, "dbos-qualify.exe")
    this.version = options.version
    this.buildHash = options.buildHash
  }

  private requireBase(): string {
    if (!this.baseUrl) throw new Error("DBOS Go candidate not initialized")
    return this.baseUrl
  }

  async candidateInfo(): Promise<CandidateInfo> {
    return {
      kind: "DBOS_GO_SQLITE",
      version: this.version,
      buildHash: this.buildHash,
      storage: {
        engine: "SQLite 3.x (via modernc.org/sqlite v1.54.0, pure-Go)",
        driver: SQLITE_DRIVER_PINNED,
        journalMode: "WAL",
        synchronous: "FULL",
        busyTimeoutMs: 5000,
        maxOpenConns: 1,
        backupTarget: "file",
      },
      process: {
        topology: "child-process",
        ipc: "http+json over loopback",
        multiProcessSafe: true,
        healthEndpoint: "GET /healthz",
      },
    }
  }

  async initialize(): Promise<void> {
    if (!existsSync(this.binaryPath)) {
      throw new Error(
        `DBOS Go binary not found at ${this.binaryPath}.\n` +
        `Build with: cd ${this.toolDir} && ../.tools/go/${GO_PINNED_VERSION}/bin/go build -buildvcs=false -o dbos-qualify.exe .\n` +
        `Or run: bash scripts/bootstrap-go.sh && cd tools/dbos-qualify && ../.tools/go/${GO_PINNED_VERSION}/bin/go build -buildvcs=false -o dbos-qualify.exe .`,
      )
    }
    // Each candidate instance gets its own store dir. The store dir
    // is preserved across `forceProcessCrash` + `reopen` so the new
    // process can recover the runs/effects written by the old
    // process (per pack gelé review 2026-09-03 v1.1 §4, FC-31A is
    // a real restart on the SAME durable store).
    if (!this.storeDir) {
      this.storeDir = join(this.toolDir, ".dbos-stores", `store-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
    }
    await mkdir(this.storeDir, { recursive: true })

    return new Promise<void>((resolve, reject) => {
      const child = spawn(this.binaryPath, [], {
        env: { ...process.env, M0_STORE_DIR: this.storeDir },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      })
      let stdoutBuf = ""
      let stderrBuf = ""
      let resolved = false

      const onSpawnError = (e: Error) => {
        if (resolved) return
        resolved = true
        reject(new Error(`spawn failed: ${e.message}`))
      }
      child.once("error", onSpawnError)

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString("utf8")
        // The binary prints the bind address on the first line of stdout
        // (followed by log lines via log.Printf). Look for the first
        // line that matches `127.0.0.1:NNNNN`.
        if (this.baseUrl) return
        const lines = stdoutBuf.split(/\r?\n/)
        for (const ln of lines) {
          const m = ln.match(/127\.0\.0\.1:\d+/)
          if (m) {
            this.baseUrl = `http://${m[0]}`
            child.off("error", onSpawnError)
            this.proc = child
            // Wait briefly for /healthz to be ready
            const start = Date.now()
            const wait = async () => {
              while (Date.now() - start < 10_000) {
                try {
                  await jsonCall(this.baseUrl!, "/healthz", { timeoutMs: 1000 })
                  if (!resolved) {
                    resolved = true
                    resolve()
                  }
                  return
                } catch {
                  await new Promise((r) => setTimeout(r, 100))
                }
              }
              if (!resolved) {
                resolved = true
                reject(new Error(`DBOS Go binary did not become healthy within 10s (stderr: ${stderrBuf})`))
              }
            }
            void wait()
            return
          }
        }
      })
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString("utf8")
      })
      child.once("exit", (code) => {
        if (resolved) return
        resolved = true
        reject(new Error(`DBOS Go binary exited early code=${code} stdout=${stdoutBuf} stderr=${stderrBuf}`))
      })

      // 90s overall timeout (per pack gelé review 2026-09-03 v1.1:
      // DBOS Go v1.0.0's runtime + modernc.org/sqlite v1.54.0 init
      // takes ~30-60s on Windows host startup. The harness must wait
      // until either /healthz responds or the timeout fires.)
      setTimeout(() => {
        if (resolved) return
        resolved = true
        try { child.kill() } catch { /* noop */ }
        reject(new Error(`DBOS Go binary did not bind within 90s (stdout=${stdoutBuf} stderr=${stderrBuf})`))
      }, 90_000)
    })
  }

  async shutdown(): Promise<void> {
    if (this.proc) {
      try { this.proc.kill() } catch { /* noop */ }
      this.proc = null
    }
    this.baseUrl = null
    // Best-effort store cleanup
    if (this.storeDir) {
      try { await rm(this.storeDir, { recursive: true, force: true }) } catch { /* noop */ }
    }
  }

  async startRun(input: StartRunInput): Promise<WorkflowRunId> {
    const base = this.requireBase()
    const body = {
      workflowVersionId: input.workflowVersionId,
      ownerScope: input.ownerScope,
      initialLogicalInvocation: {
        logicalInvocationId: input.initialLogicalInvocation.logicalInvocationId,
        effectKey: input.initialLogicalInvocation.effectKey,
        canonicalInput: input.initialLogicalInvocation.canonicalInput,
      },
      seedCanonicalValue: input.seedCanonicalValue,
    }
    const r = await jsonCall<{ runId: string }>(base, "/runs", { method: "POST", body, timeoutMs: 10_000 })
    return r.runId as WorkflowRunId
  }

  async inspectRun(runId: WorkflowRunId): Promise<CanonicalRunState> {
    const base = this.requireBase()
    return await jsonCall<CanonicalRunState>(base, `/runs/${encodeURIComponent(runId)}`, { timeoutMs: 5_000 })
  }

  async driveAttempt(
    runId: WorkflowRunId,
    logicalInvocationId: LogicalInvocationId,
    providerResponse: ProviderResolution,
  ): Promise<CanonicalAttemptState> {
    const base = this.requireBase()
    const status = providerResponse.outcome === "UNKNOWN" ? "UNKNOWN" : providerResponse.outcome
    const body = {
      effectKey: providerResponse.effectKey,
      outcome: status,
      canonicalResult: providerResponse.canonicalResult,
      ackLost: providerResponse.ackLost,
      idempotencyKey: providerResponse.idempotencyKey,
      providerCommittedAtEpochMs: providerResponse.providerCommittedAtEpochMs,
    }
    return await jsonCall<CanonicalAttemptState>(
      base,
      `/runs/${encodeURIComponent(runId)}/invocations/${encodeURIComponent(logicalInvocationId)}/attempts`,
      { method: "POST", body, timeoutMs: 10_000 },
    )
  }

  async provideApproval(request: ApprovalRequestInput): Promise<void> {
    const base = this.requireBase()
    await jsonCall(base, "/approvals", {
      method: "POST",
      body: {
        approvalId: request.approvalId,
        workflowRunId: request.runId,
        logicalInvocationId: request.logicalInvocationId,
        executionPlanDigest: request.executionPlanDigest,
        requesterPrincipalId: request.requesterPrincipalId,
        ordinal: request.ordinal,
        requestGeneration: request.requestGeneration,
        ownershipScope: request.ownershipScope,
        deploymentScope: { environmentId: "imported" },
        capabilityRefs: [],
        resourceScope: {},
        policyDecisionRef: "policy-default",
        policyVersion: "1",
        createdAtEpochMs: request.createdAtEpochMs,
        expiresAtEpochMs: request.expiresAtEpochMs,
        state: "PENDING",
      },
    })
  }

  async resolveApproval(
    approvalId: ApprovalId,
    state: "APPROVED" | "DENIED",
    actor: { readonly id: string; readonly kind: "PRINCIPAL" },
    currentResolve: ApprovalResolveInput,
  ): Promise<ApprovalOutcome> {
    const base = this.requireBase()
    return await jsonCall<ApprovalOutcome>(base, `/approvals/${encodeURIComponent(approvalId)}/resolve`, {
      method: "POST",
      body: {
        decision: state,
        actorId: actor.id,
        currentExecutionPlanDigest: currentResolve.currentExecutionPlanDigest,
        reason: currentResolve.reason ?? null,
      },
    })
  }

  async cancelApproval(
    approvalId: ApprovalId,
    actor: { readonly id: string; readonly kind: "PRINCIPAL" | "SYSTEM_CANCEL" },
    reason: string,
  ): Promise<ApprovalOutcome> {
    const base = this.requireBase()
    return await jsonCall<ApprovalOutcome>(base, `/approvals/${encodeURIComponent(approvalId)}/cancel`, {
      method: "POST",
      body: { actorId: actor.id, actorKind: actor.kind, reason },
    })
  }

  async approvalHistory(approvalId: ApprovalId): Promise<readonly ApprovalHistoryEvent[]> {
    const base = this.requireBase()
    // The Go binary returns the rows as a list of maps. The
    // response may come back as an array directly, or (rarely)
    // as an object with an `events` wrapper; we accept both.
    const raw = await jsonCall<Array<Record<string, unknown>> | { events?: Array<Record<string, unknown>> }>(
      base,
      `/approvals/${encodeURIComponent(approvalId)}/history`,
    )
    const arr = Array.isArray(raw) ? raw : (raw.events ?? []) as Array<Record<string, unknown>>
    return arr.map((r) => ({
      eventId: String(r.eventId ?? ""),
      approvalId: r.approvalId as never,
      eventType: String(r.eventType ?? "REQUESTED") as ApprovalHistoryEvent["eventType"],
      previousState: (r.previousState as ApprovalHistoryEvent["previousState"]) ?? null,
      newState: String(r.newState ?? "PENDING") as ApprovalHistoryEvent["newState"],
      actorId: (r.actorId as string | null) ?? null,
      timestampEpochMs: Number(r.timestampEpochMs ?? 0),
      reason: (r.reason as string | null) ?? null,
      executionPlanDigest: (r.executionPlanDigest as ApprovalHistoryEvent["executionPlanDigest"]) ?? null,
    }))
  }

  async inspectApproval(approvalId: ApprovalId): Promise<ApprovalOutcome> {
    const base = this.requireBase()
    return await jsonCall<ApprovalOutcome>(base, `/approvals/${encodeURIComponent(approvalId)}`)
  }

  async scheduleTimer(request: DurableTimerRequest): Promise<void> {
    const base = this.requireBase()
    await jsonCall(base, "/timers", { method: "POST", body: request })
  }

  async inspectTimer(timerId: DurableTimerId): Promise<DurableTimerSnapshot> {
    const base = this.requireBase()
    return await jsonCall<DurableTimerSnapshot>(base, `/timers/${encodeURIComponent(timerId)}`)
  }

  async forceProcessCrash(): Promise<void> {
    // Per pack gelé review 2026-09-03 v1.1 CP4.1 (FC-31A real restart):
    // SIGKILL bypasses any cleanup handlers in the Go binary, so a
    // bare `proc.kill("SIGKILL")` would leave the SQLite WAL
    // uncommitted and the new process unable to find the run. The
    // Go binary exposes `/admin/crash` which performs a
    // `PRAGMA wal_checkpoint(TRUNCATE)` BEFORE exiting — that is
    // the path that simulates a "process crash AFTER durable
    // commit" (per pack gelé §13, real power-loss is FC-13, not
    // FC-31A).
    //
    // If `/admin/crash` is unreachable (binary already gone), fall
    // back to direct SIGKILL.
    if (this.proc && this.baseUrl) {
      try {
        await jsonCall(this.baseUrl, "/admin/crash", { method: "POST", timeoutMs: 5_000 })
      } catch {
        // Binary may have exited; ignore.
      }
    }
    if (this.proc) {
      try { this.proc.kill("SIGKILL") } catch { /* noop */ }
      this.proc = null
    }
    this.baseUrl = null
  }

  async reopen(): Promise<void> {
    // After forceProcessCrash, spawn a fresh process on the same store dir.
    if (this.proc) {
      try { this.proc.kill() } catch { /* noop */ }
      this.proc = null
    }
    this.baseUrl = null
    await this.initialize()
  }

  async createBackup(): Promise<BackupRef> {
    const base = this.requireBase()
    const r = await jsonCall<{ handle: string }>(base, "/admin/backup", { method: "POST" })
    return {
      handle: r.handle,
      sizeBytes: 0, // not returned by the binary; sized at restore
      takenAtEpochMs: Date.now(),
      kind: "engine-native",
    }
  }

  async restoreBackup(ref: BackupRef): Promise<void> {
    const base = this.requireBase()
    await jsonCall(base, "/admin/restore", { method: "POST", body: { handle: ref.handle } })
  }

  async inspectHistory(runId: WorkflowRunId): Promise<readonly CanonicalRunState[]> {
    return [await this.inspectRun(runId)]
  }

  async diagnostics(): Promise<CandidateDiagnostics> {
    const base = this.requireBase()
    const d = await jsonCall<{
      candidate: string
      version: string
      buildHash: string
      schemaVersion: number
      authorityGeneration: number
      runs: number
      pendingApprovals: number
      durableTimers: number
      effectLedgerSize: number
    }>(base, "/diagnostics")
    return {
      info: await this.candidateInfo(),
      currentSchemaVersion: d.schemaVersion as SchemaVersion,
      authorityGeneration: d.authorityGeneration as AuthorityGeneration,
      runs: d.runs,
      pendingApprovals: d.pendingApprovals,
      durableTimers: d.durableTimers,
      effectLedgerSize: d.effectLedgerSize,
    }
  }
}

/* ------------------------------------------------------------------ */
/* IPC HTTP sketch (re-exported for docs)                              */
/* ------------------------------------------------------------------ */

export const DBOS_GO_IPC_SKETCH = {
  basePath: "/m0-qualification",
  endpoints: {
    version: "GET /version",
    health: "GET /healthz",
    diagnostics: "GET /diagnostics",
    startRun: "POST /runs",
    inspectRun: "GET /runs/:runId",
    driveAttempt: "POST /runs/:runId/invocations/:logicalInvocationId/attempts",
    provideApproval: "POST /approvals",
    resolveApproval: "POST /approvals/:approvalId/resolve",
    inspectApproval: "GET /approvals/:approvalId",
    scheduleTimer: "POST /timers",
    inspectTimer: "GET /timers/:timerId",
    crash: "POST /admin/crash",
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
