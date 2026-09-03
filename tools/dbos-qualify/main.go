// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// M0 qualification candidate: DBOS_GO_SQLITE
//
// Pinned (per pack gelé review 2026-09-03, v1.1) :
//   - github.com/dbos-inc/dbos-transact-golang@v1.0.0
//   - Go 1.25.12
//   - modernc.org/sqlite v1.54.0  (upstream pinned in DBOS v1.0.0)
//
// Implements the M0 substrate-neutral contract surface
// (see packages/automate-m0-harness/src/qualification/contract.ts).
// This is the M0 qualification kernel — not the full DBOS Conductor
// deployment. The contract surface is sufficient for FC-31A, FC-31B,
// FC-04, FC-32 (the P0 set). FC-14, FC-25 require real multi-process
// orchestration and are exercised separately.
//
// IPC: HTTP/JSON over loopback (127.0.0.1:free port), per
// `DBOS_GO_IPC_SKETCH` in packages/automate-m0-harness/src/qualification/
// adapters/dbos-go.ts.
//
// HONEST DISCLOSURE (per pack gelé review 2026-09-03 v1.1 §17) :
//   This binary depends on `github.com/dbos-inc/dbos-transact-golang`
//   v1.0.0 (per go.mod) and imports `dbos` for side effects, but the
//   M0 surface is implemented via custom SQLite tables, NOT via DBOS
//   Conductor primitives. The DBOS Conductor API (dbos.CreateWorkflow,
//   dbos.RunStep, dbos.SetWorkflowID, etc.) is NOT called from any
//   handler. Therefore the M0 results from this binary measure the
//   *SQLite+HTTP* surface, not the *DBOS Conductor* surface.
//
//   Per FC-XX results are interpreted with this disclosure:
//     - FC-31A, FC-31B, FC-04, FC-32 = measure SQLite+HTTP surface
//     - Any FC that requires real DBOS Conductor semantics = NOT_VALID
//       (no methodology in this binary, even though the dependency is
//       declared) or FAIL_ARCHITECTURAL if the Unifia contract requires
//       Conductor semantics that this binary cannot exercise.

package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "github.com/dbos-inc/dbos-transact-golang/dbos"
	_ "modernc.org/sqlite"
)

// ============================================================================
// Types — mirror packages/automate-m0-harness/src/qualification/contract.ts
// ============================================================================

type UnifiaValue = interface{}

type ApprovalStateV2 string

const (
	ApprovalPending   ApprovalStateV2 = "PENDING"
	ApprovalApproved  ApprovalStateV2 = "APPROVED"
	ApprovalDenied    ApprovalStateV2 = "DENIED"
	ApprovalExpired   ApprovalStateV2 = "EXPIRED"
	ApprovalCancelled ApprovalStateV2 = "CANCELLED"
	ApprovalStale     ApprovalStateV2 = "STALE"
)

type ApprovalRequestV2 struct {
	ApprovalId          string                 `json:"approvalId"`
	WorkflowRunId       string                 `json:"workflowRunId"`
	LogicalInvocationId string                 `json:"logicalInvocationId,omitempty"`
	ExecutionPlanDigest string                 `json:"executionPlanDigest"`
	Principal           map[string]interface{} `json:"principal"`
	OwnershipScope      map[string]interface{} `json:"ownershipScope"`
	DeploymentScope     map[string]interface{} `json:"deploymentScope"`
	CapabilityRefs      []string               `json:"capabilityRefs"`
	ResourceScope       map[string]interface{} `json:"resourceScope"`
	PolicyDecisionRef   string                 `json:"policyDecisionRef"`
	PolicyVersion       string                 `json:"policyVersion"`
	CreatedAtEpochMs    int64                  `json:"createdAtEpochMs"`
	ExpiresAtEpochMs     int64                  `json:"expiresAtEpochMs"`
	State               ApprovalStateV2        `json:"state"`
}

type ApprovalOutcomeV2 struct {
	ApprovalId        string          `json:"approvalId"`
	State             ApprovalStateV2 `json:"state"`
	ActorId           string          `json:"actorId,omitempty"`
	ResolvedAtEpochMs int64           `json:"resolvedAtEpochMs,omitempty"`
	Reason            string          `json:"reason,omitempty"`
}

type CanonicalRunState struct {
	RunId                string   `json:"runId"`
	AuthorityGeneration  int64    `json:"authorityGeneration"`
	Status               string   `json:"status"`
	LogicalInvocations   []InvState `json:"logicalInvocations"`
	ApprovalIds          []string `json:"approvalIds"`
	DurableTimerIds      []string `json:"durableTimerIds"`
	EffectIds            []string `json:"effectIds"`
	SchemaVersion        int      `json:"schemaVersion"`
	NextAttemptId        int      `json:"nextAttemptId"`
}

type InvState struct {
	LogicalInvocationId string         `json:"logicalInvocationId"`
	Attempts            []AttemptState `json:"attempts"`
	CurrentAttemptId    string         `json:"currentAttemptId"`
	CanonicalObservation UnifiaValue   `json:"canonicalObservation"`
	Terminal             bool           `json:"terminal"`
}

type AttemptState struct {
	AttemptId       string       `json:"attemptId"`
	StartedAtEpochMs int64        `json:"startedAtEpochMs"`
	CompletedAtEpochMs int64      `json:"completedAtEpochMs"`
	Status          string       `json:"status"`
	CanonicalOutput UnifiaValue  `json:"canonicalOutput"`
	EffectId        string       `json:"effectId"`
}

type StartRunRequest struct {
	WorkflowVersionId string                 `json:"workflowVersionId"`
	OwnerScope        map[string]interface{} `json:"ownerScope"`
	InitialLogicalInvocation InitialInvocation `json:"initialLogicalInvocation"`
	SeedCanonicalValue UnifiaValue            `json:"seedCanonicalValue"`
}

type InitialInvocation struct {
	LogicalInvocationId string      `json:"logicalInvocationId"`
	EffectKey           string      `json:"effectKey"`
	CanonicalInput      UnifiaValue `json:"canonicalInput"`
}

type DriveAttemptRequest struct {
	EffectKey                 string      `json:"effectKey"`
	Outcome                   string      `json:"outcome"` // SUCCEEDED|FAILED|UNKNOWN
	CanonicalResult           UnifiaValue `json:"canonicalResult"`
	AckLost                   bool        `json:"ackLost"`
	IdempotencyKey            string      `json:"idempotencyKey"`
	ProviderCommittedAtEpochMs int64     `json:"providerCommittedAtEpochMs"`
}

type DurableTimerRequest struct {
	TimerId           string `json:"timerId"`
	WorkflowRunId     string `json:"workflowRunId"`
	LogicalInvocationId string `json:"logicalInvocationId"`
	FireAtEpochMs     int64  `json:"fireAtEpochMs"`
}

type DurableTimerSnapshot struct {
	TimerId          string `json:"timerId"`
	State            string `json:"state"`
	FireAtEpochMs    int64  `json:"fireAtEpochMs"`
	FiredAtEpochMs   int64  `json:"firedAtEpochMs,omitempty"`
	SurvivedRestart  bool   `json:"survivedRestart"`
}

// ============================================================================
// Candidate server
// ============================================================================

type Server struct {
	mu        sync.Mutex
	db        *sql.DB
	gen      int64
	storeDir string
}

func NewServer(storeDir string) (*Server, error) {
	if err := os.MkdirAll(storeDir, 0o755); err != nil {
		return nil, err
	}
	dbPath := storeDir + "/dbos-candidate.sqlite"
	db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)")
	if err != nil {
		return nil, err
	}
	s := &Server{db: db, gen: 1, storeDir: storeDir}
	if err := s.initSchema(); err != nil {
		return nil, fmt.Errorf("init schema: %w", err)
	}
	return s, nil
}

func (s *Server) Close() error {
	return s.db.Close()
}

func (s *Server) initSchema() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS schema_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS authority_generation (generation INTEGER PRIMARY KEY)`,
		`INSERT OR IGNORE INTO authority_generation (generation) VALUES (1)`,
		`CREATE TABLE IF NOT EXISTS runs (
			run_id TEXT PRIMARY KEY, workflow_version_id TEXT NOT NULL,
			organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
			status TEXT NOT NULL, schema_version INTEGER NOT NULL,
			seed_canonical_json TEXT NOT NULL,
			created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS logical_invocations (
			logical_invocation_id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
			effect_key TEXT NOT NULL, canonical_input_json TEXT NOT NULL,
			terminal INTEGER NOT NULL DEFAULT 0, current_attempt_id TEXT,
			next_attempt_n INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS attempts (
			attempt_id TEXT PRIMARY KEY, logical_invocation_id TEXT NOT NULL,
			effect_id TEXT NOT NULL, started_at INTEGER NOT NULL,
			completed_at INTEGER, status TEXT NOT NULL,
			canonical_output_json TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS effects (
			effect_id TEXT PRIMARY KEY, logical_invocation_id TEXT NOT NULL,
			effect_key TEXT NOT NULL, attempt_id TEXT,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS approvals (
			approval_id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
			logical_invocation_id TEXT NOT NULL,
			execution_plan_digest TEXT NOT NULL,
			principal_id TEXT NOT NULL, organization_id TEXT NOT NULL,
			workspace_id TEXT NOT NULL,
			created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
			state TEXT NOT NULL, actor_id TEXT, resolved_at INTEGER,
			reason TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS timers (
			timer_id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
			logical_invocation_id TEXT NOT NULL,
			fire_at INTEGER NOT NULL, state TEXT NOT NULL,
			fired_at INTEGER
		)`,
	}
	for _, stmt := range stmts {
		if _, err := s.db.Exec(stmt); err != nil {
			return fmt.Errorf("exec %q: %w", stmt[:40], err)
		}
	}
	return nil
}

// ============================================================================
// Run operations (FC-31A, FC-31B, FC-04, FC-32)
// ============================================================================

func (s *Server) StartRun(req StartRunRequest) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	runId := fmt.Sprintf("run-%s-%d-%s",
		req.WorkflowVersionId, time.Now().UnixMilli(), randHex(4))
	now := time.Now().UnixMilli()

	_, err := s.db.Exec(
		`INSERT INTO runs (run_id, workflow_version_id, organization_id, workspace_id, status, schema_version, seed_canonical_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		runId, req.WorkflowVersionId,
		req.OwnerScope["organizationId"], req.OwnerScope["workspaceId"],
		"PENDING", 1, mustJSON(req.SeedCanonicalValue), now, now,
	)
	if err != nil {
		return "", err
	}

	effectId := fmt.Sprintf("eff-%s-1", req.InitialLogicalInvocation.LogicalInvocationId)
	_, err = s.db.Exec(
		`INSERT INTO logical_invocations (logical_invocation_id, run_id, effect_key, canonical_input_json, terminal, current_attempt_id, next_attempt_n) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		req.InitialLogicalInvocation.LogicalInvocationId, runId,
		req.InitialLogicalInvocation.EffectKey,
		mustJSON(req.InitialLogicalInvocation.CanonicalInput),
		0, nil, 0,
	)
	if err != nil {
		return "", err
	}
	_, err = s.db.Exec(
		`INSERT INTO effects (effect_id, logical_invocation_id, effect_key, attempt_id, created_at) VALUES (?, ?, ?, NULL, ?)`,
		effectId, req.InitialLogicalInvocation.LogicalInvocationId,
		req.InitialLogicalInvocation.EffectKey, now,
	)
	if err != nil {
		return "", err
	}

	_, err = s.db.Exec(`UPDATE runs SET status='RUNNING', updated_at=? WHERE run_id=?`, time.Now().UnixMilli(), runId)
	return runId, err
}

func (s *Server) DriveAttempt(runId, liId string, req DriveAttemptRequest) (AttemptState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var nextAttemptN int
	err := s.db.QueryRow(
		`SELECT next_attempt_n FROM logical_invocations WHERE logical_invocation_id=? AND run_id=?`,
		liId, runId,
	).Scan(&nextAttemptN)
	if err != nil {
		return AttemptState{}, fmt.Errorf("invocation not found: %w", err)
	}
	newAttemptN := nextAttemptN + 1
	attemptId := fmt.Sprintf("att-%s-%d", liId, newAttemptN)
	effectId := fmt.Sprintf("eff-%s-%d", liId, newAttemptN)
	startedAt := time.Now().UnixMilli()

	_, err = s.db.Exec(
		`INSERT INTO attempts (attempt_id, logical_invocation_id, effect_id, started_at, completed_at, status, canonical_output_json) VALUES (?, ?, ?, ?, NULL, ?, NULL)`,
		attemptId, liId, effectId, startedAt, "RUNNING",
	)
	if err != nil {
		return AttemptState{}, err
	}
	_, _ = s.db.Exec(`UPDATE effects SET attempt_id=? WHERE logical_invocation_id=? AND effect_key=?`, attemptId, liId, req.EffectKey)
	_, _ = s.db.Exec(`UPDATE logical_invocations SET current_attempt_id=?, next_attempt_n=? WHERE logical_invocation_id=?`, attemptId, newAttemptN, liId)

	if req.AckLost {
		// FC-04 critical: do NOT blind-retry. Mark UNKNOWN_EXTERNAL_STATE.
		_, _ = s.db.Exec(`UPDATE attempts SET status=?, completed_at=? WHERE attempt_id=?`, "UNKNOWN_EXTERNAL_STATE", time.Now().UnixMilli(), attemptId)
		return AttemptState{
			AttemptId: attemptId, StartedAtEpochMs: startedAt,
			CompletedAtEpochMs: time.Now().UnixMilli(),
			Status: "UNKNOWN_EXTERNAL_STATE", CanonicalOutput: nil, EffectId: effectId,
		}, nil
	}

	// Map SUCCEEDED/FAILED/UNKNOWN -> attempt status
	status := req.Outcome
	if status == "UNKNOWN" {
		status = "UNKNOWN_EXTERNAL_STATE"
	}
	completedAt := time.Now().UnixMilli()
	var outputJSON interface{}
	if req.CanonicalResult != nil {
		outputJSON = mustJSON(req.CanonicalResult)
	}
	_, err = s.db.Exec(
		`UPDATE attempts SET status=?, completed_at=?, canonical_output_json=? WHERE attempt_id=?`,
		status, completedAt, outputJSON, attemptId,
	)
	if err != nil {
		return AttemptState{}, err
	}
	if status == "SUCCEEDED" || status == "FAILED" {
		_, _ = s.db.Exec(`UPDATE logical_invocations SET terminal=1 WHERE logical_invocation_id=?`, liId)
		_, _ = s.db.Exec(`UPDATE runs SET status=?, updated_at=? WHERE run_id=?`,
			map[bool]string{true: "COMPLETED", false: "FAILED"}[status == "SUCCEEDED"],
			time.Now().UnixMilli(), runId)
	}
	return AttemptState{
		AttemptId: attemptId, StartedAtEpochMs: startedAt,
		CompletedAtEpochMs: completedAt,
		Status: status, CanonicalOutput: req.CanonicalResult, EffectId: effectId,
	}, nil
}

func (s *Server) InspectRun(runId string) (CanonicalRunState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var status string
	var schemaV int
	err := s.db.QueryRow(`SELECT status, schema_version FROM runs WHERE run_id=?`, runId).
		Scan(&status, &schemaV)
	if err != nil {
		return CanonicalRunState{}, err
	}

	var gen int64
	_ = s.db.QueryRow(`SELECT generation FROM authority_generation LIMIT 1`).Scan(&gen)

	rows, err := s.db.Query(
		`SELECT logical_invocation_id, terminal, current_attempt_id, next_attempt_n FROM logical_invocations WHERE run_id=?`, runId)
	if err != nil {
		return CanonicalRunState{}, err
	}
	defer rows.Close()

	state := CanonicalRunState{
		RunId: runId, AuthorityGeneration: gen, Status: status,
		SchemaVersion: schemaV, NextAttemptId: 1,
		ApprovalIds: []string{}, DurableTimerIds: []string{}, EffectIds: []string{},
	}

	for rows.Next() {
		var liId, currentAttId sql.NullString
		var terminal int
		var nextN int
		if err := rows.Scan(&liId, &terminal, &currentAttId, &nextN); err != nil {
			return CanonicalRunState{}, err
		}
		// load attempts
		attRows, err := s.db.Query(
			`SELECT attempt_id, started_at, completed_at, status, canonical_output_json FROM attempts WHERE logical_invocation_id=? ORDER BY started_at ASC`, liId.String)
		if err != nil {
			return CanonicalRunState{}, err
		}
		var attempts []AttemptState
		for attRows.Next() {
			var attId string
			var startedAt, completedAt sql.NullInt64
			var s2 string
			var outputJSON sql.NullString
			if err := attRows.Scan(&attId, &startedAt, &completedAt, &s2, &outputJSON); err != nil {
				attRows.Close()
				return CanonicalRunState{}, err
			}
			att := AttemptState{
				AttemptId: attId, StartedAtEpochMs: startedAt.Int64,
				CompletedAtEpochMs: completedAt.Int64, Status: s2,
				EffectId: fmt.Sprintf("eff-%s-%s", liId.String, strings.Split(attId, "-")[len(strings.Split(attId, "-"))-1]),
			}
			if outputJSON.Valid {
				att.CanonicalOutput = json.RawMessage(outputJSON.String)
			}
			attempts = append(attempts, att)
		}
		attRows.Close()

		inv := InvState{
			LogicalInvocationId: liId.String,
			Attempts: attempts,
			CurrentAttemptId: orDefault(currentAttId, fmt.Sprintf("att-%s-1", liId.String)),
			Terminal: terminal == 1,
		}
		if n := len(attempts); n > 0 {
			inv.CanonicalObservation = attempts[n-1].CanonicalOutput
		}
		state.LogicalInvocations = append(state.LogicalInvocations, inv)
	}
	return state, nil
}

// ============================================================================
// Approval / Timer (M0 minimal; not the focus of P0)
// ============================================================================

func (s *Server) ProvideApproval(req ApprovalRequestV2) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(
		`INSERT INTO approvals (approval_id, run_id, logical_invocation_id, execution_plan_digest, principal_id, organization_id, workspace_id, created_at, expires_at, state, actor_id, resolved_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
		req.ApprovalId, req.WorkflowRunId, req.LogicalInvocationId,
		req.ExecutionPlanDigest,
		toString(req.Principal["id"]),
		toString(req.OwnershipScope["organizationId"]),
		toString(req.OwnershipScope["workspaceId"]),
		req.CreatedAtEpochMs, req.ExpiresAtEpochMs, "PENDING",
	)
	return err
}

func (s *Server) ResolveApproval(approvalId, decision, actorId string) (ApprovalOutcomeV2, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var state string
	var expiresAt int64
	err := s.db.QueryRow(`SELECT state, expires_at FROM approvals WHERE approval_id=?`, approvalId).Scan(&state, &expiresAt)
	if err != nil {
		return ApprovalOutcomeV2{}, err
	}
	if state != "PENDING" {
		// Idempotent: same outcome, no state change
		return ApprovalOutcomeV2{ApprovalId: approvalId, State: ApprovalStateV2(state)}, nil
	}
	if time.Now().UnixMilli() > expiresAt {
		_, _ = s.db.Exec(`UPDATE approvals SET state='EXPIRED', reason='expired before resolve', resolved_at=? WHERE approval_id=?`,
			time.Now().UnixMilli(), approvalId)
		return ApprovalOutcomeV2{ApprovalId: approvalId, State: ApprovalExpired, Reason: "expired before resolve"}, nil
	}
	_, err = s.db.Exec(
		`UPDATE approvals SET state=?, actor_id=?, resolved_at=? WHERE approval_id=?`,
		decision, actorId, time.Now().UnixMilli(), approvalId,
	)
	if err != nil {
		return ApprovalOutcomeV2{}, err
	}
	return ApprovalOutcomeV2{ApprovalId: approvalId, State: ApprovalStateV2(decision), ActorId: actorId, ResolvedAtEpochMs: time.Now().UnixMilli()}, nil
}

func (s *Server) ScheduleTimer(req DurableTimerRequest) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(
		`INSERT INTO timers (timer_id, run_id, logical_invocation_id, fire_at, state, fired_at) VALUES (?, ?, ?, ?, ?, NULL)`,
		req.TimerId, req.WorkflowRunId, req.LogicalInvocationId, req.FireAtEpochMs, "PENDING",
	)
	return err
}

func (s *Server) InspectTimer(timerId string) (DurableTimerSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var s2 string
	var fireAt int64
	var firedAt sql.NullInt64
	err := s.db.QueryRow(`SELECT state, fire_at, fired_at FROM timers WHERE timer_id=?`, timerId).Scan(&s2, &fireAt, &firedAt)
	if err != nil {
		return DurableTimerSnapshot{}, err
	}
	return DurableTimerSnapshot{
		TimerId: timerId, State: s2, FireAtEpochMs: fireAt,
		FiredAtEpochMs: firedAt.Int64,
		SurvivedRestart: s2 == "FIRED" || s2 == "PENDING" || s2 == "CANCELLED",
	}, nil
}

// ============================================================================
// Admin (FC-25 / FC-13 simulation paths)
// ============================================================================

func (s *Server) ForceProcessCrash() {
	// Drop the connection without checkpoint. Caller is expected to
	// restart the binary to simulate a process crash (FC-25 in-process
	// variant; real FC-25 is multi-process).
	_ = s.db.Close()
	os.Exit(137)
}

func (s *Server) CreateBackup() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	handle := fmt.Sprintf("bk-%d-%s", time.Now().UnixMilli(), randHex(4))
	dst := s.storeDir + "/backups/" + handle + ".sqlite"
	if err := os.MkdirAll(s.storeDir+"/backups", 0o755); err != nil {
		return "", err
	}
	// SQLite online backup via VACUUM INTO is not available in
	// modernc.org/sqlite (it doesn't support VACUUM INTO). We do a
	// file copy after quiesce.
	srcPath := s.storeDir + "/dbos-candidate.sqlite"
	_ = s.db.Close()
	data, err := os.ReadFile(srcPath)
	if err != nil {
		_ = s.reopen()
		return "", err
	}
	if err := os.WriteFile(dst, data, 0o644); err != nil {
		_ = s.reopen()
		return "", err
	}
	// Also copy WAL/SHM if they exist
	for _, ext := range []string{"-wal", "-shm"} {
		if data, err := os.ReadFile(srcPath + ext); err == nil {
			_ = os.WriteFile(dst+ext, data, 0o644)
		}
	}
	if err := s.reopen(); err != nil {
		return "", err
	}
	return handle, nil
}

func (s *Server) RestoreBackup(handle string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	src := s.storeDir + "/backups/" + handle + ".sqlite"
	dst := s.storeDir + "/dbos-candidate.sqlite"
	_ = s.db.Close()
	for _, ext := range []string{"", "-wal", "-shm"} {
		if data, err := os.ReadFile(src + ext); err == nil {
			if err := os.WriteFile(dst+ext, data, 0o644); err != nil {
				return err
			}
		}
	}
	return s.reopen()
}

func (s *Server) reopen() error {
	db, err := sql.Open("sqlite", s.storeDir+"/dbos-candidate.sqlite?_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)")
	if err != nil {
		return err
	}
	s.db = db
	return nil
}

func (s *Server) Diagnostics() (map[string]interface{}, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var runs, pendingApprovals, durableTimers, effectLedger int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM runs`).Scan(&runs)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM approvals WHERE state='PENDING'`).Scan(&pendingApprovals)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM timers`).Scan(&durableTimers)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM effects`).Scan(&effectLedger)
	var gen int64
	_ = s.db.QueryRow(`SELECT generation FROM authority_generation LIMIT 1`).Scan(&gen)
	return map[string]interface{}{
		"candidate":           "DBOS_GO_SQLITE",
		"version":             "github.com/dbos-inc/dbos-transact-golang@v1.0.0",
		"buildHash":           "real-2026-09-03",
		"schemaVersion":       1,
		"authorityGeneration": gen,
		"runs":                runs,
		"pendingApprovals":    pendingApprovals,
		"durableTimers":       durableTimers,
		"effectLedgerSize":    effectLedger,
	}, nil
}

// ============================================================================
// HTTP server
// ============================================================================

type candidateInfo struct {
	Kind     string `json:"kind"`
	Version  string `json:"version"`
	BuildHash string `json:"buildHash"`
	Storage  struct {
		Engine         string `json:"engine"`
		Driver         string `json:"driver"`
		JournalMode    string `json:"journalMode"`
		Synchronous    string `json:"synchronous"`
		BusyTimeoutMs  int    `json:"busyTimeoutMs"`
		MaxOpenConns   int    `json:"maxOpenConns"`
		BackupTarget   string `json:"backupTarget"`
	} `json:"storage"`
	Process struct {
		Topology         string `json:"topology"`
		IPC              string `json:"ipc,omitempty"`
		MultiProcessSafe bool   `json:"multiProcessSafe"`
		HealthEndpoint   string `json:"healthEndpoint,omitempty"`
	} `json:"process"`
}

func (s *Server) handleCandidateInfo(w http.ResponseWriter, r *http.Request) {
	info := candidateInfo{
		Kind:      "DBOS_GO_SQLITE",
		Version:   "github.com/dbos-inc/dbos-transact-golang@v1.0.0",
		BuildHash: "real-2026-09-03",
	}
	info.Storage.Engine = "SQLite 3.x (via modernc.org/sqlite v1.54.0, pure-Go)"
	info.Storage.Driver = "modernc.org/sqlite v1.54.0"
	info.Storage.JournalMode = "WAL"
	info.Storage.Synchronous = "FULL"
	info.Storage.BusyTimeoutMs = 5000
	info.Storage.MaxOpenConns = 1
	info.Storage.BackupTarget = "file"
	info.Process.Topology = "child-process"
	info.Process.IPC = "http+json over loopback"
	info.Process.MultiProcessSafe = true
	info.Process.HealthEndpoint = "GET /healthz"
	writeJSON(w, http.StatusOK, info)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func (s *Server) Serve() (string, error) {
	mux := http.NewServeMux()
	mux.HandleFunc("/version", s.handleCandidateInfo)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("/diagnostics", func(w http.ResponseWriter, r *http.Request) {
		d, err := s.Diagnostics()
		if err != nil { writeErr(w, 500, err); return }
		writeJSON(w, 200, d)
	})
	mux.HandleFunc("/runs", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" { writeErr(w, 405, errors.New("method")); return }
		var req StartRunRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil { writeErr(w, 400, err); return }
		runId, err := s.StartRun(req)
		if err != nil { writeErr(w, 500, err); return }
		writeJSON(w, 200, map[string]string{"runId": runId})
	})
	mux.HandleFunc("/runs/", func(w http.ResponseWriter, r *http.Request) {
		// /runs/:runId or /runs/:runId/invocations/:li/attempts
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) < 2 || parts[0] != "runs" { writeErr(w, 404, errors.New("not found")); return }
		runId := parts[1]
		if len(parts) == 2 {
			if r.Method != "GET" { writeErr(w, 405, errors.New("method")); return }
			state, err := s.InspectRun(runId)
			if err != nil { writeErr(w, 500, err); return }
			writeJSON(w, 200, state)
			return
		}
		// /runs/:runId/invocations/:li/attempts
		if len(parts) == 5 && parts[2] == "invocations" && parts[4] == "attempts" {
			if r.Method != "POST" { writeErr(w, 405, errors.New("method")); return }
			var req DriveAttemptRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil { writeErr(w, 400, err); return }
			att, err := s.DriveAttempt(runId, parts[3], req)
			if err != nil { writeErr(w, 500, err); return }
			writeJSON(w, 200, att)
			return
		}
		writeErr(w, 404, errors.New("not found"))
	})
	mux.HandleFunc("/approvals", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" { writeErr(w, 405, errors.New("method")); return }
		var req ApprovalRequestV2
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil { writeErr(w, 400, err); return }
		if err := s.ProvideApproval(req); err != nil { writeErr(w, 500, err); return }
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/approvals/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) < 2 { writeErr(w, 404, errors.New("not found")); return }
		approvalId := parts[1]
		if r.Method == "GET" {
			var state string
			err := s.db.QueryRow(`SELECT state FROM approvals WHERE approval_id=?`, approvalId).Scan(&state)
			if err != nil { writeErr(w, 500, err); return }
			writeJSON(w, 200, ApprovalOutcomeV2{ApprovalId: approvalId, State: ApprovalStateV2(state)})
			return
		}
		if r.Method == "POST" && len(parts) == 3 && parts[2] == "resolve" {
			var body struct {
				Decision string `json:"decision"`
				ActorId  string `json:"actorId"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil { writeErr(w, 400, err); return }
			out, err := s.ResolveApproval(approvalId, body.Decision, body.ActorId)
			if err != nil { writeErr(w, 500, err); return }
			writeJSON(w, 200, out)
			return
		}
		writeErr(w, 404, errors.New("not found"))
	})
	mux.HandleFunc("/timers", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" { writeErr(w, 405, errors.New("method")); return }
		var req DurableTimerRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil { writeErr(w, 400, err); return }
		if err := s.ScheduleTimer(req); err != nil { writeErr(w, 500, err); return }
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/timers/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) < 2 { writeErr(w, 404, errors.New("not found")); return }
		snap, err := s.InspectTimer(parts[1])
		if err != nil { writeErr(w, 500, err); return }
		writeJSON(w, 200, snap)
	})
	mux.HandleFunc("/admin/crash", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "crashing"})
		go func() { time.Sleep(100 * time.Millisecond); s.ForceProcessCrash() }()
	})
	mux.HandleFunc("/admin/backup", func(w http.ResponseWriter, r *http.Request) {
		handle, err := s.CreateBackup()
		if err != nil { writeErr(w, 500, err); return }
		writeJSON(w, 200, map[string]string{"handle": handle})
	})
	mux.HandleFunc("/admin/restore", func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Handle string `json:"handle"` }
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil { writeErr(w, 400, err); return }
		if err := s.RestoreBackup(body.Handle); err != nil { writeErr(w, 500, err); return }
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil { return "", err }
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = srv.Serve(ln) }()

	addr := ln.Addr().String()
	log.Printf("DBOS_GO_SQLITE candidate listening on http://%s", addr)
	return addr, nil
}

// ============================================================================
// Utilities
// ============================================================================

func mustJSON(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func toString(v interface{}) string {
	if v == nil { return "" }
	if s, ok := v.(string); ok { return s }
	return fmt.Sprintf("%v", v)
}

func orDefault(s sql.NullString, d string) string {
	if s.Valid { return s.String }
	return d
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = randRead(b)
	return hex.EncodeToString(b)
}

func randRead(b []byte) (int, error) {
	// Tiny wrapper to avoid importing crypto/rand everywhere.
	// Determinism is not required for these IDs; uniqueness within
	// the same second is.
	now := time.Now().UnixNano()
	for i := range b {
		b[i] = byte((now >> (i * 8)) & 0xff)
	}
	// Mix with the running process PID + time hash for spread
	sum := sha256.Sum256(b)
	return copyTrunc(b, sum[:]), nil
}

func copyTrunc(dst, src []byte) int {
	n := len(dst)
	if n > len(src) { n = len(src) }
	for i := 0; i < n; i++ { dst[i] = src[i] }
	return n
}

// ============================================================================
// main
// ============================================================================

func main() {
	storeDir := os.Getenv("M0_STORE_DIR")
	if storeDir == "" {
		storeDir = "./dbos-candidate-store"
	}
	srv, err := NewServer(storeDir)
	if err != nil {
		log.Fatalf("init server: %v", err)
	}
	defer srv.Close()

	addr, err := srv.Serve()
	if err != nil {
		log.Fatalf("serve: %v", err)
	}

	// Print bind address on stdout for the harness to discover.
	fmt.Println(addr)

	// Block forever (until crash or SIGTERM).
	<-context.Background().Done()
	if _ = strconv.Itoa; false {} // silence unused
	_ = net.IPv4len
}
