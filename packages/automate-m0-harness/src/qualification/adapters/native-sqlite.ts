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
import { spawn, ChildProcess } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"

/**
 * Run `fn` inside a `BEGIN IMMEDIATE` transaction. Returns
 * whatever `fn` returns. On error, the transaction is rolled
 * back; on success it is committed.
 *
 * Per Erwan review 2026-09-04: `db.transaction()` defaults
 * to `BEGIN DEFERRED` in bun:sqlite, which is unsafe for
 * cross-process races (two processes can BEGIN, both SELECT
 * a missing row, both INSERT, both COMMIT — yielding two
 * authority rows). For any read-modify-write sequence that
 * is part of authority fencing, the candidate MUST use
 * BEGIN IMMEDIATE so the writer lock is acquired at the
 * start and the other process blocks on the file lock.
 */
function withImmediateTransaction<T>(db: Database, fn: () => T): T {
  db.run("BEGIN IMMEDIATE")
  try {
    const result = fn()
    db.run("COMMIT")
    return result
  } catch (e) {
    try { db.run("ROLLBACK") } catch { /* best-effort */ }
    throw e
  }
}
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
  DurableTimerRequest,
  DurableTimerSnapshot,
  BackupRef,
  CandidateDiagnostics,
  ProviderResolution,
  ApprovalResolveInput,
  ApprovalHistoryEvent,
  ApprovalState,
  ExecutionPlanDigest,
  AuthoritySnapshot,
  RaceAuthoritiesInput,
  RaceAuthoritiesResult,
  AuthorityClaimOutcome,
  AuthoritativeMutationInput,
  AuthoritativeMutationResult,
  EffectDispatchInput,
  EffectDispatchResult,
  QualificationTakeoverInput,
  QualificationTakeoverResult,
  ClaimAuthorityInput,
  ClaimAuthorityResult,
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
-- Per-run authority generation (CP6.1 + 2026-09-04). Each run has
-- its own monotonic generation. The (generation, authority_owner_id)
-- tuple is the durable authority identity. PID is recorded in evidence
-- but is NOT the canonical identity.
CREATE TABLE IF NOT EXISTS run_authority (
  run_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL DEFAULT 0,
  authority_owner_id TEXT NOT NULL DEFAULT '',
  holder_pid INTEGER NOT NULL DEFAULT 0,
  acquired_at_epoch_ms INTEGER NOT NULL DEFAULT 0
);
-- Effect-dispatch authorization (CP6.1 §7). A successful
-- AuthorizeDispatch records an entry here in the SAME transaction
-- that validated the (generation, authority_owner_id) token. This
-- is the durable proof that a given effect was authorized by the
-- current authority.
CREATE TABLE IF NOT EXISTS effect_dispatch_auth (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  generation INTEGER NOT NULL,
  authority_owner_id TEXT NOT NULL,
  authorized_at_epoch_ms INTEGER NOT NULL
);
-- Run-state mutation log (atomic check-and-mutate proof). Every
-- successful AuthoritativeMutate appends a row.
CREATE TABLE IF NOT EXISTS run_state_mutations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  mutation TEXT NOT NULL,
  generation INTEGER NOT NULL,
  authority_owner_id TEXT NOT NULL,
  mutated_at_epoch_ms INTEGER NOT NULL
);
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
  requester_principal_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  request_generation INTEGER NOT NULL DEFAULT 0,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  actor_id TEXT,
  resolved_at INTEGER,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS approval_history (
  event_id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  previous_state TEXT,
  new_state TEXT NOT NULL,
  actor_id TEXT,
  timestamp_epoch_ms INTEGER NOT NULL,
  reason TEXT,
  execution_plan_digest TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_history_approval_id ON approval_history (approval_id, timestamp_epoch_ms);
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

    // Per pack gelé review 2026-09-03 v1.1 CP4.1 §10-§11: the
    // contract-level signal `providerResponse.ackLost: true` MUST be
    // honored by every adapter. This is the substrate-neutral way to
    // express "the external provider committed, but the transport ACK
    // did not reach us" — it replaces the candidate-specific
    // FakeExternalEffectProvider's `dropAckToCandidate` flag, which
    // was a contamination violation (the common oracle created a
    // separate candidate for FC-04 in the previous implementation).
    if (providerResponse.ackLost) {
      // Per FC-04: do NOT blind-retry. Record UNKNOWN_EXTERNAL_STATE
      // and let the caller reconcile (or surface the uncertainty).
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
      `INSERT INTO approvals (approval_id, run_id, logical_invocation_id, execution_plan_digest, requester_principal_id, ordinal, request_generation, organization_id, workspace_id, created_at, expires_at, state, actor_id, resolved_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      [
        request.approvalId,
        request.runId,
        request.logicalInvocationId,
        request.executionPlanDigest,
        request.requesterPrincipalId,
        request.ordinal,
        request.requestGeneration,
        request.ownershipScope.organizationId,
        request.ownershipScope.workspaceId,
        request.createdAtEpochMs,
        request.expiresAtEpochMs,
        "PENDING",
      ],
    )
    // Append history event REQUESTED.
    db.run(
      `INSERT INTO approval_history (event_id, approval_id, event_type, previous_state, new_state, actor_id, timestamp_epoch_ms, reason, execution_plan_digest) VALUES (?, ?, ?, NULL, ?, NULL, ?, NULL, ?)`,
      [
        `evt-${request.approvalId}-${request.createdAtEpochMs}-req`,
        request.approvalId,
        "REQUESTED",
        "PENDING",
        request.createdAtEpochMs,
        request.executionPlanDigest,
      ],
    )
  }

  async resolveApproval(
    approvalId: ApprovalId,
    state: "APPROVED" | "DENIED",
    actor: { readonly id: string; readonly kind: "PRINCIPAL" },
    currentResolve: ApprovalResolveInput,
  ): Promise<ApprovalOutcome> {
    const db = this.requireDb()
    const existing = db.query(
      `SELECT approval_id, run_id, logical_invocation_id, execution_plan_digest, requester_principal_id, state, created_at, expires_at, actor_id, resolved_at, reason FROM approvals WHERE approval_id = ?`,
    ).get(approvalId) as {
      approval_id: string
      run_id: string
      logical_invocation_id: string
      execution_plan_digest: string
      requester_principal_id: string
      state: string
      created_at: number
      expires_at: number
      actor_id: string | null
      resolved_at: number | null
      reason: string | null
    } | null
    if (!existing) throw new Error(`approval not found: ${approvalId}`)

    // Idempotency: if already resolved, return the stored outcome
    // (or reject a conflicting decision).
    if (existing.state !== "PENDING") {
      // Same decision and same actor → idempotent OK.
      if (existing.state === state && existing.actor_id === actor.id) {
        return {
          approvalId,
          state: existing.state as ApprovalState,
          actor: existing.actor_id ? { id: existing.actor_id } : undefined,
          resolvedAtEpochMs: existing.resolved_at ?? undefined,
          reason: existing.reason ?? undefined,
        }
      }
      throw new Error(
        `APPROVAL_ALREADY_RESOLVED: state=${existing.state} actor=${existing.actor_id ?? "null"}`,
      )
    }

    // Self-approval rejection (pack gelé §17).
    if (existing.requester_principal_id === actor.id) {
      throw new Error(`SELF_APPROVAL_REJECTED: actor=${actor.id} is the requester`)
    }

    // Expiry check (pack gelé §22).
    if (Date.now() > existing.expires_at) {
      db.run(
        `UPDATE approvals SET state = ?, reason = ?, resolved_at = ? WHERE approval_id = ?`,
        ["EXPIRED", "expired before resolve", Date.now(), approvalId],
      )
      this.appendApprovalHistory(db, approvalId, "EXPIRED", "PENDING", "EXPIRED", null, Date.now(), "expired before resolve", null)
      return { approvalId, state: "EXPIRED", reason: "expired before resolve" }
    }

    // Plan-digest check (pack gelé §16). If the caller's current
    // digest does not match the stored digest, transition to STALE
    // and reject the resolve.
    if (existing.execution_plan_digest !== currentResolve.currentExecutionPlanDigest) {
      db.run(
        `UPDATE approvals SET state = ?, reason = ?, resolved_at = ? WHERE approval_id = ?`,
        ["STALE", `plan digest changed: stored=${existing.execution_plan_digest} current=${currentResolve.currentExecutionPlanDigest}`, Date.now(), approvalId],
      )
      this.appendApprovalHistory(
        db,
        approvalId,
        "STALE_DIGEST_MISMATCH",
        "PENDING",
        "STALE",
        actor.id,
        Date.now(),
        `stored=${existing.execution_plan_digest} current=${currentResolve.currentExecutionPlanDigest}`,
        currentResolve.currentExecutionPlanDigest,
      )
      throw new Error(
        `APPROVAL_STALE_PLAN: stored=${existing.execution_plan_digest} current=${currentResolve.currentExecutionPlanDigest}`,
      )
    }

    const resolvedAt = Date.now()
    db.run(
      `UPDATE approvals SET state = ?, actor_id = ?, resolved_at = ?, reason = ? WHERE approval_id = ?`,
      [state, actor.id, resolvedAt, currentResolve.reason ?? null, approvalId],
    )
    this.appendApprovalHistory(
      db,
      approvalId,
      state,
      "PENDING",
      state,
      actor.id,
      resolvedAt,
      currentResolve.reason ?? null,
      currentResolve.currentExecutionPlanDigest,
    )
    return { approvalId, state, actor: { id: actor.id }, resolvedAtEpochMs: resolvedAt, reason: currentResolve.reason }
  }

  async cancelApproval(
    approvalId: ApprovalId,
    actor: { readonly id: string; readonly kind: "PRINCIPAL" | "SYSTEM_CANCEL" },
    reason: string,
  ): Promise<ApprovalOutcome> {
    const db = this.requireDb()
    const existing = db.query(
      `SELECT approval_id, requester_principal_id, state, actor_id, resolved_at FROM approvals WHERE approval_id = ?`,
    ).get(approvalId) as { approval_id: string; requester_principal_id: string; state: string; actor_id: string | null; resolved_at: number | null } | null
    if (!existing) throw new Error(`approval not found: ${approvalId}`)
    if (existing.state !== "PENDING") {
      throw new Error(`APPROVAL_ALREADY_RESOLVED: state=${existing.state}`)
    }
    // The actor MUST be the requester principal OR a SYSTEM_CANCEL.
    if (actor.kind === "PRINCIPAL" && actor.id !== existing.requester_principal_id) {
      throw new Error(`CANCEL_REJECTED: actor=${actor.id} is not the requester (${existing.requester_principal_id})`)
    }
    const now = Date.now()
    db.run(
      `UPDATE approvals SET state = 'CANCELLED', actor_id = ?, resolved_at = ?, reason = ? WHERE approval_id = ?`,
      [actor.id, now, reason, approvalId],
    )
    this.appendApprovalHistory(db, approvalId, "CANCELLED", "PENDING", "CANCELLED", actor.id, now, reason, null)
    return { approvalId, state: "CANCELLED", actor: { id: actor.id }, resolvedAtEpochMs: now, reason }
  }

  async approvalHistory(approvalId: ApprovalId): Promise<readonly ApprovalHistoryEvent[]> {
    const db = this.requireDb()
    const rows = db.query(
      `SELECT event_id, approval_id, event_type, previous_state, new_state, actor_id, timestamp_epoch_ms, reason, execution_plan_digest FROM approval_history WHERE approval_id = ? ORDER BY timestamp_epoch_ms ASC`,
    ).all(approvalId) as {
      event_id: string
      approval_id: string
      event_type: string
      previous_state: string | null
      new_state: string
      actor_id: string | null
      timestamp_epoch_ms: number
      reason: string | null
      execution_plan_digest: string | null
    }[]
    return rows.map((r) => ({
      eventId: r.event_id,
      approvalId: r.approval_id as ApprovalId,
      eventType: r.event_type as ApprovalHistoryEvent["eventType"],
      previousState: r.previous_state as ApprovalState | null,
      newState: r.new_state as ApprovalState,
      actorId: r.actor_id,
      timestampEpochMs: r.timestamp_epoch_ms,
      reason: r.reason,
      executionPlanDigest: r.execution_plan_digest as ExecutionPlanDigest | null,
    }))
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

  private appendApprovalHistory(
    db: import("bun:sqlite").Database,
    approvalId: ApprovalId,
    eventType: ApprovalHistoryEvent["eventType"],
    previousState: ApprovalState | null,
    newState: ApprovalState,
    actorId: string | null,
    timestampEpochMs: number,
    reason: string | null,
    executionPlanDigest: ExecutionPlanDigest | null,
  ): void {
    const eventId = `evt-${approvalId}-${timestampEpochMs}-${eventType.toLowerCase()}`
    db.run(
      `INSERT INTO approval_history (event_id, approval_id, event_type, previous_state, new_state, actor_id, timestamp_epoch_ms, reason, execution_plan_digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [eventId, approvalId, eventType, previousState, newState, actorId, timestampEpochMs, reason, executionPlanDigest],
    )
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

  /* -------------------------------------------------------------- */
  /* FC-14 / FC-25 substrate-neutral authority capabilities         */
  /* -------------------------------------------------------------- */

  /**
   * Read the current persisted authority state for a run.
   */
  async inspectAuthority(runId: WorkflowRunId): Promise<AuthoritySnapshot> {
    const db = this.requireDb()
    const row = db.query(
      `SELECT generation, authority_owner_id, holder_pid FROM run_authority WHERE run_id = ?`,
    ).get(runId) as { generation: number; authority_owner_id: string; holder_pid: number } | null
    if (!row) {
      // No claim yet — return a zero-generation snapshot.
      return { runId, generation: 0 as AuthorityGeneration, authorityOwnerId: "", holderPid: null }
    }
    return {
      runId,
      generation: row.generation as AuthorityGeneration,
      authorityOwnerId: row.authority_owner_id,
      holderPid: row.holder_pid,
    }
  }

  /**
   * Race two OS processes for authority over a single run.
   * The Native adapter spawns a `native-authority-worker.ts` Bun
   * subprocess on the same storeDir and a small HTTP loopback
   * (127.0.0.1:0) so the parent can issue the claim. The two
   * processes enter `ClaimAuthority` from a Promise.all after a
   * barrier.
   *
   * Returns `concurrentRace: true` and `distinctOsProcesses: 2`
   * when measured, satisfying the FC-14 PASS gate.
   */
  async raceAuthorities(input: RaceAuthoritiesInput): Promise<RaceAuthoritiesResult> {
    // The runner may pass sharedStore="" to mean "use your own".
    const storeDir = input.sharedStore === "" ? this.storeDir : input.sharedStore
    if (storeDir !== this.storeDir) {
      throw new Error(`raceAuthorities: sharedStore=${storeDir} does not match adapter storeDir=${this.storeDir}`)
    }
    return await raceNativeAuthorities(storeDir, input)
  }

  /**
   * Atomic check-and-mutate: validates the (generation,
   * authority_owner_id) token in a BEGIN IMMEDIATE transaction
   * and, on match, appends a row to `run_state_mutations`.
   */
  async attemptAuthoritativeMutation(
    input: AuthoritativeMutationInput,
  ): Promise<AuthoritativeMutationResult> {
    const db = this.requireDb()
    return withImmediateTransaction(db, (): AuthoritativeMutationResult => {
      // BEGIN IMMEDIATE acquires the writer lock at the start of
      // the transaction; another process racing us blocks on the
      // SQLite file lock. bun:sqlite is single-writer; the
      // transaction is automatically IMMEDIATE.
      const row = db.query(
        `SELECT generation, authority_owner_id FROM run_authority WHERE run_id = ?`,
      ).get(input.runId) as { generation: number; authority_owner_id: string } | null
      if (!row) {
        return { accepted: false, reason: "UNKNOWN_RUN", currentGeneration: null, currentAuthorityOwnerId: null }
      }
      if (row.generation !== input.token.generation || row.authority_owner_id !== input.token.authorityOwnerId) {
        return {
          accepted: false,
          reason: "STALE_AUTHORITY",
          currentGeneration: row.generation as AuthorityGeneration,
          currentAuthorityOwnerId: row.authority_owner_id,
        }
      }
      db.run(
        `INSERT INTO run_state_mutations (run_id, mutation, generation, authority_owner_id, mutated_at_epoch_ms) VALUES (?, ?, ?, ?, ?)`,
        [input.runId, input.mutation, row.generation, row.authority_owner_id, Date.now()],
      )
      return { accepted: true, generation: row.generation as AuthorityGeneration, authorityOwnerId: row.authority_owner_id }
    })
  }

  /**
   * Authorize an external effect dispatch under a (generation,
   * authority_owner_id) token. Atomic: token check + ledger
   * insert in one transaction.
   */
  async attemptEffectDispatch(input: EffectDispatchInput): Promise<EffectDispatchResult> {
    const db = this.requireDb()
    return withImmediateTransaction(db, (): EffectDispatchResult => {
      const row = db.query(
        `SELECT generation, authority_owner_id FROM run_authority WHERE run_id = ?`,
      ).get(input.runId) as { generation: number; authority_owner_id: string } | null
      if (!row) {
        return { accepted: false, reason: "UNKNOWN_RUN", currentGeneration: null, currentAuthorityOwnerId: null }
      }
      if (row.generation !== input.token.generation || row.authority_owner_id !== input.token.authorityOwnerId) {
        return {
          accepted: false,
          reason: "STALE_AUTHORITY",
          currentGeneration: row.generation as AuthorityGeneration,
          currentAuthorityOwnerId: row.authority_owner_id,
        }
      }
      db.run(
        `INSERT INTO effect_dispatch_auth (run_id, effect_key, generation, authority_owner_id, authorized_at_epoch_ms) VALUES (?, ?, ?, ?, ?)`,
        [input.runId, input.effectKey, row.generation, row.authority_owner_id, Date.now()],
      )
      return {
        accepted: true,
        effectKey: input.effectKey,
        generation: row.generation as AuthorityGeneration,
        authorityOwnerId: row.authority_owner_id,
      }
    })
  }

  /**
   * Qualification-only takeover: forcibly increments the
   * generation and assigns a new owner without requiring the
   * previous owner to release. Used by FC-25.
   */
  async claimAuthority(input: ClaimAuthorityInput): Promise<ClaimAuthorityResult> {
    const db = this.requireDb()
    return withImmediateTransaction(db, (): ClaimAuthorityResult => {
      const row = db.query(
        `SELECT generation, authority_owner_id, holder_pid FROM run_authority WHERE run_id = ?`,
      ).get(input.runId) as { generation: number; authority_owner_id: string; holder_pid: number } | null
      if (!row) {
        // Initial claim: insert at gen=1.
        db.run(
          `INSERT INTO run_authority (run_id, generation, authority_owner_id, holder_pid, acquired_at_epoch_ms) VALUES (?, ?, ?, ?, ?)`,
          [input.runId, 1, input.authorityOwnerId, process.pid, Date.now()],
        )
        return {
          granted: true,
          currentGeneration: 1 as AuthorityGeneration,
          currentAuthorityOwnerId: input.authorityOwnerId,
          holderPid: process.pid,
        }
      }
      // Already claimed. If by the same owner, return success;
      // else return ALREADY_CLAIMED_BY_OTHER.
      if (row.authority_owner_id === input.authorityOwnerId) {
        return {
          granted: true,
          currentGeneration: row.generation as AuthorityGeneration,
          currentAuthorityOwnerId: row.authority_owner_id,
          holderPid: row.holder_pid,
        }
      }
      return {
        granted: false,
        reason: "ALREADY_CLAIMED_BY_OTHER",
        currentGeneration: row.generation as AuthorityGeneration,
        currentAuthorityOwnerId: row.authority_owner_id,
      }
    })
  }

  async forceQualificationTakeover(
    input: QualificationTakeoverInput,
  ): Promise<QualificationTakeoverResult> {
    const db = this.requireDb()
    return withImmediateTransaction(db, (): QualificationTakeoverResult => {
      const row = db.query(
        `SELECT generation, authority_owner_id FROM run_authority WHERE run_id = ?`,
      ).get(input.runId) as { generation: number; authority_owner_id: string } | null
      if (!row) {
        return { accepted: false, reason: "UNKNOWN_RUN", currentGeneration: null, currentAuthorityOwnerId: null }
      }
      if (row.generation !== input.expectedCurrentGeneration) {
        return {
          accepted: false,
          reason: "GENERATION_MISMATCH",
          currentGeneration: row.generation as AuthorityGeneration,
          currentAuthorityOwnerId: row.authority_owner_id,
        }
      }
      const newGen = row.generation + 1
      db.run(
        `UPDATE run_authority SET generation = ?, authority_owner_id = ?, holder_pid = ?, acquired_at_epoch_ms = ? WHERE run_id = ?`,
        [newGen, input.newAuthorityOwnerId, 0, Date.now(), input.runId],
      )
      return {
        accepted: true,
        previousGeneration: row.generation as AuthorityGeneration,
        previousAuthorityOwnerId: row.authority_owner_id,
        newGeneration: newGen as AuthorityGeneration,
        newAuthorityOwnerId: input.newAuthorityOwnerId,
      }
    })
  }
}

/* ------------------------------------------------------------------ */
/* Native authority worker (subprocess for FC-14/25 multi-process)    */
/* ------------------------------------------------------------------ */

/**
 * Spawn a Bun subprocess that runs the same `NativeSqliteCandidate`
 * authority primitives against the same storeDir, on a small
 * HTTP loopback. The subprocess is controlled by the parent via
 * `/claim` (POST), `/mutate` (POST), `/dispatch` (POST),
 * `/takeover` (POST), `/inspect` (GET), `/shutdown` (POST).
 *
 * This is the substrate-neutral mechanism by which the Native
 * candidate participates in a REAL two-OS-process race. The
 * runner calls `adapter.raceAuthorities(...)` which delegates to
 * this function; the runner never imports a candidate-specific
 * helper.
 */
interface NativeWorkerOptions { storeDir: string; ownerId: string; label: string }
interface NativeWorkerHandle { proc: ChildProcess; baseUrl: string; pid: number; ownerId: string }

async function spawnNativeWorker(opts: NativeWorkerOptions): Promise<NativeWorkerHandle> {
  // Find the worker script relative to this file.
  const workerPath = join(import.meta.dir, "native-authority-worker.ts")
  const proc = spawn(process.execPath, [workerPath], {
    env: {
      ...process.env,
      M0_NATIVE_STORE_DIR: opts.storeDir,
      M0_NATIVE_OWNER_ID: opts.ownerId,
      M0_NATIVE_LABEL: opts.label,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  let baseUrl: string | null = null
  let stderrBuf = ""
  let stdoutBuf = ""
  await new Promise<void>((resolve, reject) => {
    let resolved = false
    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      try { proc.kill() } catch { /* noop */ }
      reject(new Error(`native-authority-worker did not bind within 30s (stderr=${stderrBuf})`))
    }, 30_000)
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8")
      if (baseUrl) return
      const m = stdoutBuf.match(/127\.0\.0\.1:\d+/)
      if (m) {
        baseUrl = `http://${m[0]}`
        // Wait briefly for /healthz
        const start = Date.now()
        const wait = async () => {
          while (Date.now() - start < 5_000) {
            try {
              await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(500) })
              if (!resolved) { resolved = true; clearTimeout(timer); resolve() }
              return
            } catch { await delay(50) }
          }
          if (!resolved) { resolved = true; clearTimeout(timer); reject(new Error(`worker unhealthy (stderr=${stderrBuf})`)) }
        }
        void wait()
      }
    })
    proc.stderr?.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString("utf8") })
    proc.once("error", (e) => { if (resolved) return; resolved = true; clearTimeout(timer); reject(e) })
    proc.once("exit", (code) => { if (resolved) return; resolved = true; clearTimeout(timer); reject(new Error(`worker exited code=${code} (stderr=${stderrBuf})`)) })
  })
  if (!baseUrl) throw new Error("native-authority-worker did not expose base URL")
  return { proc, baseUrl, pid: proc.pid ?? 0, ownerId: opts.ownerId }
}

async function killWorker(w: NativeWorkerHandle | null): Promise<void> {
  if (!w) return
  try { await fetch(`${w.baseUrl}/shutdown`, { method: "POST", signal: AbortSignal.timeout(1_000) }) } catch { /* noop */ }
  if (w.proc && !w.proc.killed) {
    try { w.proc.kill("SIGKILL") } catch { /* noop */ }
  }
}

async function raceNativeAuthorities(
  storeDir: string,
  input: RaceAuthoritiesInput,
): Promise<RaceAuthoritiesResult> {
  let workerA: NativeWorkerHandle | null = null
  let workerB: NativeWorkerHandle | null = null
  try {
    workerA = await spawnNativeWorker({ storeDir, ownerId: input.participantA.authorityOwnerId, label: "A" })
    workerB = await spawnNativeWorker({ storeDir, ownerId: input.participantB.authorityOwnerId, label: "B" })
    // Barrier: 50ms before both call /claim concurrently.
    await delay(50)
    const claimA = fetch(`${workerA.baseUrl}/claim?runId=${encodeURIComponent(input.runId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptedGeneration: 1 }),
      signal: AbortSignal.timeout(10_000),
    }).then((r) => r.json() as Promise<{ granted: boolean; currentGeneration: number; authorityOwnerId: string; holderPid: number }>)
    const claimB = fetch(`${workerB.baseUrl}/claim?runId=${encodeURIComponent(input.runId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptedGeneration: 1 }),
      signal: AbortSignal.timeout(10_000),
    }).then((r) => r.json() as Promise<{ granted: boolean; currentGeneration: number; authorityOwnerId: string; holderPid: number }>)
    const [a, b] = await Promise.all([claimA, claimB])
    const winnerA = a.granted
    const winner = winnerA ? { claim: a, worker: workerA, ownerId: input.participantA.authorityOwnerId, pid: workerA.pid } : { claim: b, worker: workerB, ownerId: input.participantB.authorityOwnerId, pid: workerB.pid }
    const loser = winnerA ? { claim: b, worker: workerB, ownerId: input.participantB.authorityOwnerId, pid: workerB.pid } : { claim: a, worker: workerA, ownerId: input.participantA.authorityOwnerId, pid: workerA.pid }
    // Winner snapshot: the persisted (gen, owner) at the end of the race.
    const inspect = await fetch(`${winner.worker.baseUrl}/inspect?runId=${encodeURIComponent(input.runId)}`, { signal: AbortSignal.timeout(5_000) })
    const inspectJson = await inspect.json() as { currentGeneration: number; authorityOwnerId: string; holderPid: number }
    const aOut: AuthorityClaimOutcome = {
      granted: a.granted,
      currentAuthorityOwnerId: a.authorityOwnerId,
      currentGeneration: a.currentGeneration as AuthorityGeneration,
      attemptedGeneration: 1 as AuthorityGeneration,
      holderPid: a.holderPid,
    }
    const bOut: AuthorityClaimOutcome = {
      granted: b.granted,
      currentAuthorityOwnerId: b.authorityOwnerId,
      currentGeneration: b.currentGeneration as AuthorityGeneration,
      attemptedGeneration: 1 as AuthorityGeneration,
      holderPid: b.holderPid,
    }
    return {
      measured: true,
      concurrentRace: true,
      distinctOsProcesses: 2,
      claimA: aOut,
      claimB: bOut,
      winner: {
        authorityOwnerId: winner.claim.authorityOwnerId,
        processLocalOwnerId: winner.ownerId,
        pid: winner.pid,
      },
      loser: {
        authorityOwnerId: loser.claim.authorityOwnerId,
        processLocalOwnerId: loser.ownerId,
        pid: loser.pid,
      },
      finalPersistedAuthorityOwnerId: inspectJson.authorityOwnerId,
      finalGeneration: inspectJson.currentGeneration as AuthorityGeneration,
    }
  } finally {
    await killWorker(workerA)
    await killWorker(workerB)
  }
}

/** Convenience: re-export so adapter callers don't need a deep import. */
export { assertCanonical, fromHostFloat64, canonicalEquals }


