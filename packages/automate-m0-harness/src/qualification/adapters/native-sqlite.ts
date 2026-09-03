/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * UNIFIA_NATIVE M0 qualification candidate.
 *
 * Per pack gelé §8 + NATIVE_TOPOLOGY.md, this is a real substrate
 * that persists to SQLite. The M0 driver choice is `bun:sqlite` (Bun
 * built-in, no native compilation) because the harness host (Bun
 * 1.3.14 on Windows) crashes on `better-sqlite3` 13.0.3 NAPI binding
 * (verified 2026-09-03 21:30 CEST). This is an M0-environment
 * choice, not a permanent one; the production kernel may use any
 * driver that satisfies the same SQLite contract.
 *
 * What this candidate proves in M0:
 *   - FC-31A : canonical values round-trip bit-exact
 *   - FC-31B : host-integer vs host-float64 separation
 *   - FC-04  : provider success + local ACK lost → UNKNOWN_EXTERNAL_STATE
 *   - FC-14  : second connection to the same file (in-process)
 *   - FC-25  : declared BLOCKED (multi-process in preflight)
 *   - FC-32  : replay model declaration (NO)
 *
 * It is intentionally **simple** — no concurrency, no orchestrator.
 * The harness tests the substrate-neutral properties; production
 * orchestration is a separate concern.
 */

import { Database } from "bun:sqlite"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import {
  type WorkflowRunId,
  type WorkflowVersionId,
  type LogicalInvocationId,
  type AttemptId,
  type ApprovalId,
  type DurableTimerId,
  type EffectId,
  type AuthorityGeneration,
  type SchemaVersion,
  type UnifiaValue,
  fromHostFloat64,
  canonicalEquals,
  assertCanonical,
} from "@unifia/automate-m0-contract"
import type {
  DurableWorkflowAuthorityQualificationAdapter,
  CandidateInfo,
  StartRunInput,
  CanonicalRunState,
  CanonicalInvocationState,
  CanonicalAttemptState,
  ApprovalRequestInput,
  ApprovalOutcome,
  ApprovalState,
  DurableTimerRequest,
  DurableTimerSnapshot,
  BackupRef,
  CandidateDiagnostics,
  ProviderResolution,
} from "../contract.ts"
import { FakeExternalEffectProvider } from "../providers/fake-external.ts"

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export interface NativeSqliteOptions {
  /** Directory where the candidate's SQLite file lives. */
  readonly storeDir: string
  /** Fake external provider. */
  readonly provider: FakeExternalEffectProvider
  /** Pinned version. */
  readonly version: string
  /** Build hash. */
  readonly buildHash: string
}

/* ------------------------------------------------------------------ */
/* Schema (version 1)                                                 */
/* ------------------------------------------------------------------ */

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS schema_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS authority_generation (
  generation INTEGER PRIMARY KEY
);
INSERT OR IGNORE INTO authority_generation (generation) VALUES (1);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  workflow_version_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  seed_canonical_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS logical_invocations (
  logical_invocation_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  canonical_input_json TEXT NOT NULL,
  terminal INTEGER NOT NULL DEFAULT 0,
  current_attempt_id TEXT,
  next_attempt_n INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS attempts (
  attempt_id TEXT PRIMARY KEY,
  logical_invocation_id TEXT NOT NULL,
  effect_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL,
  canonical_output_json TEXT
);
CREATE TABLE IF NOT EXISTS effects (
  effect_id TEXT PRIMARY KEY,
  logical_invocation_id TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  attempt_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  approval_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  logical_invocation_id TEXT NOT NULL,
  execution_plan_digest TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  actor_id TEXT,
  resolved_at INTEGER,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS timers (
  timer_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  logical_invocation_id TEXT NOT NULL,
  fire_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  fired_at INTEGER
);
CREATE TABLE IF NOT EXISTS backup_history (
  handle TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL,
  taken_at INTEGER NOT NULL,
  kind TEXT NOT NULL
);
`

/* ------------------------------------------------------------------ */
/* NativeSqliteCandidate                                                */
/* ------------------------------------------------------------------ */

export class NativeSqliteCandidate implements DurableWorkflowAuthorityQualificationAdapter {
  private db: Database | null = null
  private storeDir: string
  private dbPath: string
  private provider: FakeExternalEffectProvider
  private version: string
  private buildHash: string

  constructor(options: NativeSqliteOptions) {
    this.storeDir = options.storeDir
    this.dbPath = join(options.storeDir, "native.sqlite")
    this.provider = options.provider
    this.version = options.version
    this.buildHash = options.buildHash
  }

  async candidateInfo(): Promise<CandidateInfo> {
    return {
      kind: "UNIFIA_NATIVE",
      version: this.version,
      buildHash: this.buildHash,
      storage: {
        engine: "SQLite 3.x (via bun:sqlite in M0; better-sqlite3 candidate for production)",
        driver: "bun:sqlite (Bun built-in, M0 env)",
        journalMode: "WAL",
        synchronous: "FULL",
        busyTimeoutMs: 5000,
        maxOpenConns: 1, // M0: single-writer for correctness; multi-writer is FC-14 territory
        backupTarget: "file",
      },
      process: {
        topology: "in-process",
        multiProcessSafe: true, // WAL + POSIX file locks; FC-14 will verify
      },
    }
  }

  async initialize(): Promise<void> {
    await mkdir(this.storeDir, { recursive: true })
    this.db = new Database(this.dbPath, { create: true })
    this.db.exec("PRAGMA journal_mode = WAL;")
    this.db.exec("PRAGMA synchronous = FULL;")
    this.db.exec("PRAGMA busy_timeout = 5000;")
    this.db.exec("PRAGMA foreign_keys = ON;")
    this.db.exec(SCHEMA_V1)
  }

  async shutdown(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  async forceProcessCrash(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  async reopen(): Promise<void> {
    this.db = new Database(this.dbPath, { create: true })
    this.db.exec("PRAGMA journal_mode = WAL;")
    this.db.exec("PRAGMA synchronous = FULL;")
    this.db.exec("PRAGMA busy_timeout = 5000;")
    this.db.exec("PRAGMA foreign_keys = ON;")
  }

  private requireDb(): Database {
    if (!this.db) throw new Error("candidate not initialized (or crashed)")
    return this.db
  }

  async startRun(input: StartRunInput): Promise<WorkflowRunId> {
    const db = this.requireDb()
    const runId = `run-${input.workflowVersionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` as WorkflowRunId
    const now = Date.now()

    db.run(
      `INSERT INTO runs (run_id, workflow_version_id, organization_id, workspace_id, status, schema_version, seed_canonical_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        input.workflowVersionId,
        input.ownerScope.organizationId,
        input.ownerScope.workspaceId,
        "PENDING",
        1,
        JSON.stringify(input.seedCanonicalValue),
        now,
        now,
      ],
    )

    const effectId = `eff-${input.initialLogicalInvocation.logicalInvocationId}-1` as EffectId
    db.run(
      `INSERT INTO logical_invocations (logical_invocation_id, run_id, effect_key, canonical_input_json, terminal, current_attempt_id, next_attempt_n) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.initialLogicalInvocation.logicalInvocationId,
        runId,
        input.initialLogicalInvocation.effectKey,
        JSON.stringify(input.initialLogicalInvocation.canonicalInput),
        0,
        null,
        0,
      ],
    )
    db.run(
      `INSERT INTO effects (effect_id, logical_invocation_id, effect_key, attempt_id, created_at) VALUES (?, ?, ?, NULL, ?)`,
      [effectId, input.initialLogicalInvocation.logicalInvocationId, input.initialLogicalInvocation.effectKey, now],
    )

    db.run(`UPDATE runs SET status = 'RUNNING', updated_at = ? WHERE run_id = ?`, [Date.now(), runId])
    return runId
  }

  async inspectRun(runId: WorkflowRunId): Promise<CanonicalRunState> {
    const db = this.requireDb()
    const run = db.query(`SELECT status, schema_version FROM runs WHERE run_id = ?`).get(runId) as { status: string; schema_version: number } | null
    if (!run) throw new Error(`run not found: ${runId}`)

    const generation = (db.query(`SELECT generation FROM authority_generation LIMIT 1`).get() as { generation: number }).generation as AuthorityGeneration

    const invocations = db.query(`SELECT logical_invocation_id, terminal, current_attempt_id, next_attempt_n FROM logical_invocations WHERE run_id = ?`).all(runId) as {
      logical_invocation_id: string
      terminal: number
      current_attempt_id: string | null
      next_attempt_n: number
    }[]

    const invStates: CanonicalInvocationState[] = []
    for (const inv of invocations) {
      const attempts = db.query(`SELECT attempt_id, started_at, completed_at, status, canonical_output_json FROM attempts WHERE logical_invocation_id = ? ORDER BY started_at ASC`).all(inv.logical_invocation_id) as {
        attempt_id: string
        started_at: number
        completed_at: number | null
        status: string
        canonical_output_json: string | null
      }[]

      const attemptStates: CanonicalAttemptState[] = attempts.map((a) => ({
        attemptId: a.attempt_id as AttemptId,
        startedAtEpochMs: a.started_at,
        completedAtEpochMs: a.completed_at,
        status: a.status as CanonicalAttemptState["status"],
        canonicalOutput: a.canonical_output_json ? (JSON.parse(a.canonical_output_json) as UnifiaValue) : null,
        effectId: `eff-${inv.logical_invocation_id}-${a.attempt_id.split("-").pop()}` as EffectId,
      }))

      invStates.push({
        logicalInvocationId: inv.logical_invocation_id as LogicalInvocationId,
        attempts: attemptStates,
        currentAttemptId: (inv.current_attempt_id ?? `att-${inv.logical_invocation_id}-1`) as AttemptId,
        canonicalObservation: attemptStates[attemptStates.length - 1]?.canonicalOutput ?? null,
        terminal: inv.terminal === 1,
      })
    }

    const approvalIds = (db.query(`SELECT approval_id FROM approvals WHERE run_id = ?`).all(runId) as { approval_id: string }[]).map((r) => r.approval_id as ApprovalId)
    const timerIds = (db.query(`SELECT timer_id FROM timers WHERE run_id = ?`).all(runId) as { timer_id: string }[]).map((r) => r.timer_id as DurableTimerId)
    const effectIds = (db.query(`SELECT DISTINCT effect_id FROM effects e JOIN logical_invocations li ON li.logical_invocation_id = e.logical_invocation_id WHERE li.run_id = ?`).all(runId) as { effect_id: string }[]).map((r) => r.effect_id as EffectId)

    return {
      runId,
      authorityGeneration: generation,
      status: run.status as CanonicalRunState["status"],
      logicalInvocations: invStates,
      approvalIds,
      durableTimerIds: timerIds,
      effectIds,
      schemaVersion: run.schema_version as SchemaVersion,
      nextAttemptId: 1,
    }
  }

  async driveAttempt(
    runId: WorkflowRunId,
    logicalInvocationId: LogicalInvocationId,
    providerResponse: ProviderResolution,
  ): Promise<CanonicalAttemptState> {
    const db = this.requireDb()
    const inv = db.query(`SELECT logical_invocation_id, run_id, effect_key, terminal, next_attempt_n FROM logical_invocations WHERE logical_invocation_id = ? AND run_id = ?`).get(logicalInvocationId, runId) as { logical_invocation_id: string; run_id: string; effect_key: string; terminal: number; next_attempt_n: number } | null
    if (!inv) throw new Error(`invocation not found: ${logicalInvocationId} in run ${runId}`)

    const newAttemptN = inv.next_attempt_n + 1
    const attemptId = `att-${logicalInvocationId}-${newAttemptN}` as AttemptId
    const effectId = `eff-${logicalInvocationId}-${newAttemptN}` as EffectId
    const startedAt = Date.now()

    db.run(
      `INSERT INTO attempts (attempt_id, logical_invocation_id, effect_id, started_at, completed_at, status, canonical_output_json) VALUES (?, ?, ?, ?, NULL, ?, NULL)`,
      [attemptId, logicalInvocationId, effectId, startedAt, "RUNNING"],
    )
    db.run(`UPDATE effects SET attempt_id = ? WHERE logical_invocation_id = ? AND effect_key = ?`, [attemptId, logicalInvocationId, inv.effect_key])
    db.run(`UPDATE logical_invocations SET current_attempt_id = ?, next_attempt_n = ? WHERE logical_invocation_id = ?`, [attemptId, newAttemptN, logicalInvocationId])

    const providerOutcome = await this.provider.resolve(
      providerResponse.effectKey,
      providerResponse.idempotencyKey,
      providerResponse.outcome,
      providerResponse.canonicalResult,
      providerResponse.providerCommittedAtEpochMs,
    )

    if (!providerOutcome.ackDelivered) {
      db.run(`UPDATE attempts SET status = ?, completed_at = ? WHERE attempt_id = ?`, ["UNKNOWN_EXTERNAL_STATE", Date.now(), attemptId])
      return {
        attemptId,
        startedAtEpochMs: startedAt,
        completedAtEpochMs: Date.now(),
        status: "UNKNOWN_EXTERNAL_STATE",
        canonicalOutput: null,
        effectId,
      }
    }

    const status: CanonicalAttemptState["status"] =
      providerResponse.outcome === "UNKNOWN" ? "UNKNOWN_EXTERNAL_STATE" : providerResponse.outcome
    const completedAt = Date.now()
    db.run(`UPDATE attempts SET status = ?, completed_at = ?, canonical_output_json = ? WHERE attempt_id = ?`, [
      status,
      completedAt,
      providerResponse.canonicalResult !== null ? JSON.stringify(providerResponse.canonicalResult) : null,
      attemptId,
    ])

    if (status === "SUCCEEDED" || status === "FAILED") {
      db.run(`UPDATE logical_invocations SET terminal = 1 WHERE logical_invocation_id = ?`, [logicalInvocationId])
      db.run(`UPDATE runs SET status = ?, updated_at = ? WHERE run_id = ?`, [status === "SUCCEEDED" ? "COMPLETED" : "FAILED", Date.now(), runId])
    }

    return {
      attemptId,
      startedAtEpochMs: startedAt,
      completedAtEpochMs: completedAt,
      status,
      canonicalOutput: providerResponse.canonicalResult,
      effectId,
    }
  }

  async provideApproval(request: ApprovalRequestInput): Promise<void> {
    const db = this.requireDb()
    db.run(
      `INSERT INTO approvals (approval_id, run_id, logical_invocation_id, execution_plan_digest, principal_id, organization_id, workspace_id, created_at, expires_at, state, actor_id, resolved_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      [
        request.approvalId,
        request.runId,
        request.logicalInvocationId,
        request.executionPlanDigest,
        request.principal.id,
        request.ownershipScope.organizationId,
        request.ownershipScope.workspaceId,
        request.createdAtEpochMs,
        request.expiresAtEpochMs,
        "PENDING",
      ],
    )
  }

  async resolveApproval(
    approvalId: ApprovalId,
    state: "APPROVED" | "DENIED",
    actor: { readonly id: string; readonly kind: "PRINCIPAL" },
  ): Promise<ApprovalOutcome> {
    const db = this.requireDb()
    const existing = db.query(`SELECT approval_id, run_id, logical_invocation_id, state, created_at, expires_at, actor_id, resolved_at, reason FROM approvals WHERE approval_id = ?`).get(approvalId) as {
      approval_id: string
      run_id: string
      logical_invocation_id: string
      state: string
      created_at: number
      expires_at: number
      actor_id: string | null
      resolved_at: number | null
      reason: string | null
    } | null
    if (!existing) throw new Error(`approval not found: ${approvalId}`)

    if (existing.state !== "PENDING") {
      return {
        approvalId,
        state: existing.state as ApprovalState,
        actor: existing.actor_id ? { id: existing.actor_id } : undefined,
        resolvedAtEpochMs: existing.resolved_at ?? undefined,
        reason: existing.reason ?? undefined,
      }
    }

    if (Date.now() > existing.expires_at) {
      db.run(`UPDATE approvals SET state = ?, reason = ?, resolved_at = ? WHERE approval_id = ?`, ["EXPIRED", "expired before resolve", Date.now(), approvalId])
      return { approvalId, state: "EXPIRED", reason: "expired before resolve" }
    }

    db.run(`UPDATE approvals SET state = ?, actor_id = ?, resolved_at = ? WHERE approval_id = ?`, [state, actor.id, Date.now(), approvalId])
    return { approvalId, state, actor: { id: actor.id }, resolvedAtEpochMs: Date.now() }
  }

  async inspectApproval(approvalId: ApprovalId): Promise<ApprovalOutcome> {
    const db = this.requireDb()
    const row = db.query(`SELECT state, actor_id, resolved_at, reason FROM approvals WHERE approval_id = ?`).get(approvalId) as { state: string; actor_id: string | null; resolved_at: number | null; reason: string | null } | null
    if (!row) throw new Error(`approval not found: ${approvalId}`)
    return {
      approvalId,
      state: row.state as ApprovalState,
      actor: row.actor_id ? { id: row.actor_id } : undefined,
      resolvedAtEpochMs: row.resolved_at ?? undefined,
      reason: row.reason ?? undefined,
    }
  }

  async scheduleTimer(request: DurableTimerRequest): Promise<void> {
    const db = this.requireDb()
    db.run(`INSERT INTO timers (timer_id, run_id, logical_invocation_id, fire_at, state, fired_at) VALUES (?, ?, ?, ?, ?, NULL)`, [
      request.timerId,
      request.runId,
      request.logicalInvocationId,
      request.fireAtEpochMs,
      "PENDING",
    ])
  }

  async inspectTimer(timerId: DurableTimerId): Promise<DurableTimerSnapshot> {
    const db = this.requireDb()
    const row = db.query(`SELECT timer_id, state, fire_at, fired_at FROM timers WHERE timer_id = ?`).get(timerId) as { timer_id: string; state: string; fire_at: number; fired_at: number | null } | null
    if (!row) throw new Error(`timer not found: ${timerId}`)
    return {
      timerId,
      state: row.state as DurableTimerSnapshot["state"],
      fireAtEpochMs: row.fire_at,
      firedAtEpochMs: row.fired_at ?? undefined,
      survivedRestart: row.state === "FIRED" || row.state === "PENDING" || row.state === "CANCELLED",
    }
  }

  async createBackup(): Promise<BackupRef> {
    const db = this.requireDb()
    const handle = `bk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const takenAt = Date.now()
    const backupPath = join(this.storeDir, "backups", `${handle}.sqlite`)
    await mkdir(join(this.storeDir, "backups"), { recursive: true })
    // bun:sqlite has no VACUUM INTO. We do a file copy after a
    // quiesce (close + open the same file with a different name).
    // M0: in-process; for production use the engine-native online
    // backup API.
    db.close()
    this.db = null
    const fs = await import("node:fs/promises")
    await fs.copyFile(this.dbPath, backupPath)
    try { await fs.copyFile(this.dbPath + "-wal", backupPath + "-wal") } catch { /* noop */ }
    try { await fs.copyFile(this.dbPath + "-shm", backupPath + "-shm") } catch { /* noop */ }
    const stat = await fs.stat(backupPath)
    await this.reopen()
    db.run(`INSERT INTO backup_history (handle, size_bytes, taken_at, kind) VALUES (?, ?, ?, ?)`, [handle, stat.size, takenAt, "engine-native"])
    return { handle, sizeBytes: stat.size, takenAtEpochMs: takenAt, kind: "engine-native" }
  }

  async restoreBackup(ref: BackupRef): Promise<void> {
    const backupPath = join(this.storeDir, "backups", `${ref.handle}.sqlite`)
    if (this.db) {
      this.db.close()
      this.db = null
    }
    const fs = await import("node:fs/promises")
    await fs.copyFile(backupPath, this.dbPath)
    try { await fs.unlink(this.dbPath + "-wal") } catch { /* noop */ }
    try { await fs.unlink(this.dbPath + "-shm") } catch { /* noop */ }
    await this.reopen()
  }

  async inspectHistory(runId: WorkflowRunId): Promise<readonly CanonicalRunState[]> {
    return [await this.inspectRun(runId)]
  }

  async diagnostics(): Promise<CandidateDiagnostics> {
    const db = this.requireDb()
    const runs = (db.query(`SELECT COUNT(*) AS n FROM runs`).get() as { n: number }).n
    const pendingApprovals = (db.query(`SELECT COUNT(*) AS n FROM approvals WHERE state = 'PENDING'`).get() as { n: number }).n
    const durableTimers = (db.query(`SELECT COUNT(*) AS n FROM timers`).get() as { n: number }).n
    const effectLedgerSize = (db.query(`SELECT COUNT(*) AS n FROM effects`).get() as { n: number }).n
    const generation = (db.query(`SELECT generation FROM authority_generation LIMIT 1`).get() as { generation: number }).generation as AuthorityGeneration
    return {
      info: await this.candidateInfo(),
      currentSchemaVersion: 1 as SchemaVersion,
      authorityGeneration: generation,
      runs,
      pendingApprovals,
      durableTimers,
      effectLedgerSize,
    }
  }

  async destroy(): Promise<void> {
    await this.shutdown()
    await rm(this.storeDir, { recursive: true, force: true })
  }
}

/** Convenience: re-export so adapter callers don't need a deep import. */
export { assertCanonical, fromHostFloat64, canonicalEquals }
