/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M0 substrate-neutral qualification contract (ADR-000 §6/§7, post review v1.1).
 *
 * This module defines the interface a candidate durable authority must
 * implement to be measured by the M0 harness. It is the boundary the
 * common oracle drives; no candidate-specific logic may live here.
 *
 * Both `UNIFIA_NATIVE` and `DBOS_GO_SQLITE` are scored against exactly
 * this contract, on exactly the same fixtures, with exactly the same
 * result schema. A FAIL here is a FAIL for that candidate — there is
 * no "adapters see a different oracle" loophole.
 *
 * Per pack gelé §4 (interdiction de pré-sélection) :
 *   - No candidate is favored
 *   - The harness cannot inherit an M1 decision
 *   - Common oracle != candidate implementation
 */

import type {
  AuthorityGeneration,
  AuthorityKind,
  WorkflowRunId,
  WorkflowVersionId,
  LogicalInvocationId,
  AttemptId,
  ApprovalId,
  DurableTimerId,
  EffectId,
  SchemaVersion,
  UnifiaValue,
} from "@unifia/automate-m0-contract"

/* ------------------------------------------------------------------ */
/* Candidate info                                                      */
/* ------------------------------------------------------------------ */

/** Identity of the candidate durable authority. */
export interface CandidateInfo {
  readonly kind: AuthorityKind
  /** Exact pinned version (no `latest`, no `1.0+`). */
  readonly version: string
  /** Free-form commit / build / hash for reproducibility. */
  readonly buildHash: string
  /** Native storage driver + configuration (SQLite journal_mode etc.). */
  readonly storage: CandidateStorageConfig
  /** Process model and IPC. */
  readonly process: CandidateProcessConfig
}

export interface CandidateStorageConfig {
  /** e.g. `SQLite 3.46.1`, `LMDB 0.9.31`, `BadgerDB v4`. */
  readonly engine: string
  /** e.g. `better-sqlite3 13.0.3`, `mattn/go-sqlite3 v1.14.22`. */
  readonly driver: string
  /** `WAL`, `DELETE`, `MEMORY`. */
  readonly journalMode: string
  /** `FULL`, `NORMAL`, `OFF`. */
  readonly synchronous: string
  /** Milliseconds. */
  readonly busyTimeoutMs: number
  /** Max open SQLite connections held by the candidate. */
  readonly maxOpenConns: number
  /** Where backups go. */
  readonly backupTarget: "file" | "stdout" | "memory"
}

export interface CandidateProcessConfig {
  /** `in-process`, `child-process`, `sidecar`, `remote`. */
  readonly topology: string
  /** IPC mechanism if cross-process. */
  readonly ipc?: string
  /** Whether the candidate supports multi-process access to the same store. */
  readonly multiProcessSafe: boolean
  /** Process health endpoint. */
  readonly healthEndpoint?: string
}

/* ------------------------------------------------------------------ */
/* Run lifecycle                                                       */
/* ------------------------------------------------------------------ */

/** What the harness needs to start a run. */
export interface StartRunInput {
  readonly workflowVersionId: WorkflowVersionId
  readonly ownerScope: { readonly organizationId: string; readonly workspaceId: string }
  readonly initialLogicalInvocation: {
    readonly logicalInvocationId: LogicalInvocationId
    readonly effectKey: string
    /** Already-canonical value (FC-31A path). */
    readonly canonicalInput: UnifiaValue
  }
  /** Already-canonical value persisted alongside the run. */
  readonly seedCanonicalValue: UnifiaValue
}

/** Canonical state a candidate must expose to the harness. */
export interface CanonicalRunState {
  readonly runId: WorkflowRunId
  readonly authorityGeneration: AuthorityGeneration
  readonly status: "PENDING" | "RUNNING" | "WAITING_APPROVAL" | "WAITING_TIMER" | "COMPLETED" | "FAILED" | "CANCELLED"
  readonly logicalInvocations: readonly CanonicalInvocationState[]
  readonly approvalIds: readonly ApprovalId[]
  readonly durableTimerIds: readonly DurableTimerId[]
  readonly effectIds: readonly EffectId[]
  /** Schema version the candidate currently understands. */
  readonly schemaVersion: SchemaVersion
  /** Monotonic attempt counter the candidate assigns to its next retry. */
  readonly nextAttemptId: number
}

export interface CanonicalInvocationState {
  readonly logicalInvocationId: LogicalInvocationId
  readonly attempts: readonly CanonicalAttemptState[]
  readonly currentAttemptId: AttemptId
  readonly canonicalObservation: UnifiaValue | null
  readonly terminal: boolean
}

export interface CanonicalAttemptState {
  readonly attemptId: AttemptId
  readonly startedAtEpochMs: number
  readonly completedAtEpochMs: number | null
  readonly status: "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNKNOWN_EXTERNAL_STATE"
  readonly canonicalOutput: UnifiaValue | null
  readonly effectId: EffectId
}

/* ------------------------------------------------------------------ */
/* Approval minimal contract (D-02)                                   */
/* ------------------------------------------------------------------ */

/** What the harness needs to drive the approval-durability tests. */
export interface ApprovalRequestInput {
  readonly approvalId: ApprovalId
  readonly runId: WorkflowRunId
  readonly logicalInvocationId: LogicalInvocationId
  /** Digest of the immutable ExecutionPlan this approval is bound to. */
  readonly executionPlanDigest: string
  /** Principal / scope the approval is bound to. */
  readonly principal: { readonly id: string }
  readonly ownershipScope: { readonly organizationId: string; readonly workspaceId: string }
  /** Expiry wall-clock — fail-closed past this point. */
  readonly expiresAtEpochMs: number
  readonly createdAtEpochMs: number
}

export type ApprovalState = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED" | "STALE"

export interface ApprovalOutcome {
  readonly approvalId: ApprovalId
  readonly state: ApprovalState
  /** Actor that resolved, if any. */
  readonly actor?: { readonly id: string }
  readonly resolvedAtEpochMs?: number
  /** Reason set on CANCELLED / EXPIRED / STALE. */
  readonly reason?: string
}

export type ApprovalActorKind = "PRINCIPAL" | "SYSTEM_EXPIRY" | "SYSTEM_CANCEL" | "SYSTEM_STALE"

/* ------------------------------------------------------------------ */
/* Timer minimal contract                                              */
/* ------------------------------------------------------------------ */

export interface DurableTimerRequest {
  readonly timerId: DurableTimerId
  readonly runId: WorkflowRunId
  readonly logicalInvocationId: LogicalInvocationId
  /** Wall-clock the timer should fire at. */
  readonly fireAtEpochMs: number
}

export type TimerState = "PENDING" | "FIRED" | "CANCELLED" | "EXPIRED"

export interface DurableTimerSnapshot {
  readonly timerId: DurableTimerId
  readonly state: TimerState
  readonly fireAtEpochMs: number
  readonly firedAtEpochMs?: number
  /** Whether the candidate recorded this timer across the most recent restart. */
  readonly survivedRestart: boolean
}

/* ------------------------------------------------------------------ */
/* Backup / restore                                                    */
/* ------------------------------------------------------------------ */

export interface BackupRef {
  /** Opaque handle the candidate returns. */
  readonly handle: string
  /** Bytes-size of the backup for resource accounting. */
  readonly sizeBytes: number
  /** Wall-clock the backup was taken. */
  readonly takenAtEpochMs: number
  /** `engine-native` (e.g. SQLite .backup API) or `app-level`. */
  readonly kind: "engine-native" | "app-level"
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

export interface CandidateDiagnostics {
  readonly info: CandidateInfo
  /** Effective schema version the candidate has. */
  readonly currentSchemaVersion: SchemaVersion
  /** Pinned authority generation. */
  readonly authorityGeneration: AuthorityGeneration
  /** Number of durable runs in the store. */
  readonly runs: number
  /** Number of pending approvals. */
  readonly pendingApprovals: number
  /** Number of durable timers. */
  readonly durableTimers: number
  /** Number of effects in the ledger. */
  readonly effectLedgerSize: number
}

/* ------------------------------------------------------------------ */
/* THE candidate interface (substrate-neutral)                         */
/* ------------------------------------------------------------------ */

/**
 * What every candidate MUST implement to be scored. The common oracle
 * drives this. No candidate-specific logic lives here.
 *
 * The contract is deliberately small — anything not in this contract
 * is not measured. Anything in this contract is measured the same way
 * for every candidate.
 */
export interface DurableWorkflowAuthorityQualificationAdapter {
  /** Identity the candidate declares at the start of qualification. */
  candidateInfo(): Promise<CandidateInfo>

  /** Open a connection / process / store. Idempotent. */
  initialize(): Promise<void>
  /** Close cleanly. Idempotent. */
  shutdown(): Promise<void>

  /**
   * Start a run with an effect that will be dispatched against the
   * harness's fake external provider. The candidate must record the
   * run + initial logical invocation + attempt durably.
   */
  startRun(input: StartRunInput): Promise<WorkflowRunId>

  /**
   * Returns the canonical state the candidate exposes. The harness
   * uses this to verify invariant assertions (FC-31A etc.).
   */
  inspectRun(runId: WorkflowRunId): Promise<CanonicalRunState>

  /**
   * Drive a single attempt to completion against the (mock) external
   * provider. The candidate is given the provider's response in
   * `providerResponse`; the harness will inject ACK loss / provider
   * success / provider failure / unknown as needed.
   */
  driveAttempt(
    runId: WorkflowRunId,
    logicalInvocationId: LogicalInvocationId,
    providerResponse: ProviderResolution,
  ): Promise<CanonicalAttemptState>

  /** Submit an approval request. */
  provideApproval(request: ApprovalRequestInput): Promise<void>

  /**
   * Resolve an approval. `actor` is mandatory.
   * Second call on a resolved approval must be idempotent (same
   * outcome) or closed (error). Never silent re-apply.
   */
  resolveApproval(
    approvalId: ApprovalId,
    state: "APPROVED" | "DENIED",
    actor: { readonly id: string; readonly kind: "PRINCIPAL" },
  ): Promise<ApprovalOutcome>

  /** Inspect an approval (read-only). */
  inspectApproval(approvalId: ApprovalId): Promise<ApprovalOutcome>

  /** Schedule a durable timer. */
  scheduleTimer(request: DurableTimerRequest): Promise<void>

  /** Inspect a durable timer. */
  inspectTimer(timerId: DurableTimerId): Promise<DurableTimerSnapshot>

  /** Force the candidate to "appear crashed" — for restart tests. */
  forceProcessCrash(): Promise<void>

  /**
   * Reopen the store from disk. For an in-process candidate this
   * constructs a fresh instance; for a child process this starts a
   * new process and reconnects.
   */
  reopen(): Promise<void>

  /** Take a consistent backup of the store. */
  createBackup(): Promise<BackupRef>

  /** Restore from a backup. The candidate store is wiped. */
  restoreBackup(ref: BackupRef): Promise<void>

  /** Full history of a run, in canonical form. */
  inspectHistory(runId: WorkflowRunId): Promise<readonly CanonicalRunState[]>

  /** Lightweight diagnostics. */
  diagnostics(): Promise<CandidateDiagnostics>
}

/* ------------------------------------------------------------------ */
/* Provider resolution (what the fake provider says)                  */
/* ------------------------------------------------------------------ */

/**
 * What the fake external provider tells the candidate at attempt time.
 * The harness controls this to simulate success / failure / unknown
 * / ACK loss (FC-04).
 */
export interface ProviderResolution {
  readonly effectKey: string
  readonly outcome: "SUCCEEDED" | "FAILED" | "UNKNOWN"
  /** Already-canonical result the provider claims it persisted. */
  readonly canonicalResult: UnifiaValue | null
  /** If true, the harness records the resolution locally but drops
   *  the ACK to the candidate (FC-04 ACK loss). */
  readonly ackLost: boolean
  /** Provider-side idempotency token to assert on duplicate calls. */
  readonly idempotencyKey: string
  /** Wall-clock the provider says it persisted. */
  readonly providerCommittedAtEpochMs: number
}

/* ------------------------------------------------------------------ */
/* Result taxonomy                                                     */
/* ------------------------------------------------------------------ */

export type QualificationStatus =
  | "PASS"
  | "FAIL_ARCHITECTURAL"
  | "FAIL_CORRECTABLE"
  | "NOT_APPLICABLE"
  | "BLOCKED"
  | "NOT_VALID"

/** Stable identifier of a Functional Criterion. */
export type FunctionalCriterionId =
  | "FC-01" | "FC-02" | "FC-03" | "FC-04" | "FC-05" | "FC-06" | "FC-07" | "FC-08" | "FC-09" | "FC-10"
  | "FC-11" | "FC-12" | "FC-13" | "FC-13-CTRL" | "FC-14" | "FC-15" | "FC-16" | "FC-17" | "FC-18" | "FC-19" | "FC-20"
  | "FC-21" | "FC-22" | "FC-23" | "FC-24" | "FC-25" | "FC-26" | "FC-27" | "FC-28" | "FC-29" | "FC-30"
  | "FC-31A" | "FC-31B" | "FC-32"

/** Single FC result. */
export interface FunctionalCriterionResult {
  readonly testId: FunctionalCriterionId
  readonly candidate: AuthorityKind
  readonly status: QualificationStatus
  readonly evidencePath: string
  /** Commit hash the candidate was pinned to. */
  readonly commit: string
  /** Short human-readable note on what the oracle observed. */
  readonly note: string
  /** Raw observations the harness recorded. */
  readonly observations: { readonly [k: string]: unknown }
}

/** Per-candidate result file. */
export interface CandidateResultFile {
  readonly schemaVersion: 1
  readonly candidate: AuthorityKind
  readonly candidateInfo: CandidateInfo
  readonly results: readonly FunctionalCriterionResult[]
  /** Aggregated tally. */
  readonly summary: {
    readonly pass: number
    readonly failArchitectural: number
    readonly failCorrectable: number
    readonly notApplicable: number
    readonly blocked: number
    readonly notValid: number
  }
  /** Replay model observation per pack gelé §18 (FC-32). */
  readonly replayModel: "YES" | "NO" | "PARTIAL" | "NOT_MEASURED"
  /** When this file was produced. */
  readonly producedAt: string
}

/** Expected N/A pre-declaration. */
export interface ExpectedNAFile {
  readonly schemaVersion: 1
  readonly candidate: AuthorityKind
  /** A test that the harness expects NOT to apply, with justification. */
  readonly entries: readonly { readonly testId: FunctionalCriterionId; readonly reason: string }[]
}
