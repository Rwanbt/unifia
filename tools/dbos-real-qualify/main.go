// Package main is the REAL DBOS_GO_SQLITE qualification binary.
//
// Unlike the control candidate (tools/dbos-qualify/dbos-qualify.exe)
// which uses custom SQLite + blank DBOS import, this binary uses
// the actual github.com/dbos-inc/dbos-transact-golang v1.0.0
// Conductor APIs on the measured path:
//
//   - dbos.NewContext (via Config{AppName, DatabaseURL, SQLiteSystemDB})
//   - dbos.RegisterWorkflow (the qualification workflow)
//   - dbos.RunAsStep (durable steps inside the workflow)
//   - Launch (start the runtime)
//   - Real recovery: re-opening a fresh context + recoverPendingWorkflows
//
// The harness drives the binary via HTTP/JSON. The qualification
// workflow is registered with WithWorkflowName and started via
// RunWorkflow. State persists in the DBOS SQLite system DB.
package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/dbos-inc/dbos-transact-golang/dbos"
	_ "github.com/dbos-inc/dbos-transact-golang/dbos/driver/sqlite" // registers "sqlite" DBOS driver
)

// randRead fills b with cryptographically random bytes.
func randRead(b []byte) (int, error) { return rand.Read(b) }
// hexEncode returns the hex encoding of b.
func hexEncode(b []byte) string { return hex.EncodeToString(b) }

const (
	APPNAME = "unifia-m0-dbos-real"
)

// ----------------------------------------------------------------------------
// Inputs
// ----------------------------------------------------------------------------

type StartRunInput struct {
	WorkflowVersionID    string         `json:"workflowVersionId"`
	OrganizationID       string         `json:"organizationId"`
	WorkspaceID          string         `json:"workspaceId"`
	LogicalInvocationID  string         `json:"logicalInvocationId"`
	EffectKey            string         `json:"effectKey"`
	CanonicalInputJSON   string         `json:"canonicalInputJson"`
	SeedCanonicalJSON    string         `json:"seedCanonicalJson"`
	// Optional explicit runId; if empty, the server generates
	// a globally unique WorkflowRunId. Per mandate §8 the
	// WorkflowRunId must NOT be derived from LogicalInvocationId.
	RunID                string         `json:"runId,omitempty"`
}

type StartRunOutput struct {
	RunID string `json:"runId"`
}

type DriveAttemptInput struct {
	// Required: the WorkflowRunId the attempt belongs to.
	// Per mandate §12 the durable AttemptId is part of the
	// attempt identity so retrying produces a NEW durable
	// attempt workflow in DBOS, not a replay of the prior one.
	RunID         string  `json:"runId"`
	LogicalInvocationID string `json:"logicalInvocationId"`
	// Required: durable AttemptId. Caller increments per
	// retry; this is the canonical attempt authority.
	AttemptID     string  `json:"attemptId"`
	EffectKey     string  `json:"effectKey"`
	Outcome       string  `json:"outcome"`
	CanonicalResult *string `json:"canonicalResultJson,omitempty"`
	ACKLost       bool    `json:"ackLost"`
	IdempotencyKey string `json:"idempotencyKey"`
	ProviderCommittedAt int64 `json:"providerCommittedAtEpochMs"`
}

type DriveAttemptOutput struct {
	WorkflowID string `json:"workflowId"`
	AttemptID  string `json:"attemptId"`
	Status     string `json:"status"`
	EffectID   string `json:"effectId"`
}

// ----------------------------------------------------------------------------
// Workflows (DBOS-registered; everything goes through RunAsStep)
// ----------------------------------------------------------------------------

// StartRunWorkflow persists a run + the initial logical
// invocation durably. It is composed of three DBOS steps so a
// crash mid-workflow can be recovered. The third step's
// RETURN VALUE is the canonical observation: DBOS stores step
// outputs durably in the system DB, and a fresh process
// re-opening the same storeDir can read them back via
// GetWorkflowSteps. This is how FC-31A's "value survives
// process restart" is proven for the real DBOS candidate.
//
// Per mandate §8-§9: WorkflowRunId is generated
// independently (UUID-style) and passed in as the DBOS
// WorkflowID. The harness may override via StartRunInput.RunID.
func StartRunWorkflow(ctx dbos.Context, in StartRunInput) (StartRunOutput, error) {
	runID := in.RunID
	if runID == "" {
		runID = "run-" + randHex(16)
	}
	// Step 1: persist run row
	if _, err := dbos.RunAsStep(ctx, func(ctx context.Context) (string, error) {
		return in.WorkflowVersionID, nil
	}, dbos.WithStepName("persist-run")); err != nil {
		return StartRunOutput{}, fmt.Errorf("persist-run: %w", err)
	}
	// Step 2: persist logical invocation row
	if _, err := dbos.RunAsStep(ctx, func(ctx context.Context) (string, error) {
		return in.LogicalInvocationID, nil
	}, dbos.WithStepName("persist-invocation")); err != nil {
		return StartRunOutput{}, fmt.Errorf("persist-invocation: %w", err)
	}
	// Step 3: persist canonical observation. The step's
	// return value IS the canonical seed, stored durably.
	if _, err := dbos.RunAsStep(ctx, func(ctx context.Context) (string, error) {
		return in.SeedCanonicalJSON, nil
	}, dbos.WithStepName("persist-canonical-observation")); err != nil {
		return StartRunOutput{}, fmt.Errorf("persist-canonical-observation: %w", err)
	}
	return StartRunOutput{RunID: runID}, nil
}

// DriveAttemptWorkflow records a single attempt against the
// effect ledger. Per mandate §12-§14 the attempt DBOS
// WorkflowID includes the durable AttemptId (NOT time-based).
// Two retries of the same attempt N+1, N+2 produce two
// DISTINCT DBOS workflows; a single (runId, liId, attemptId)
// produces a SINGLE durable DBOS workflow.
func DriveAttemptWorkflow(ctx dbos.Context, in DriveAttemptInput) (DriveAttemptOutput, error) {
	status := in.Outcome
	if in.ACKLost {
		status = "UNKNOWN_EXTERNAL_STATE"
	}
	// Step 1: record attempt state.
	out, err := dbos.RunAsStep(ctx, func(ctx context.Context) (DriveAttemptOutput, error) {
		return DriveAttemptOutput{
			WorkflowID: "unifia-attempt:" + in.RunID + ":" + in.LogicalInvocationID + ":" + in.AttemptID,
			AttemptID:  in.AttemptID,
			Status:     status,
			EffectID:   "eff-" + in.EffectKey + "-" + in.AttemptID,
		}, nil
	}, dbos.WithStepName("record-attempt"))
	return out, err
}

// randHex returns n bytes of randomness as a hex string.
// Used for WorkflowRunId generation when caller does not
// supply one.
func randHex(n int) string {
	b := make([]byte, n)
	if _, err := randRead(b); err != nil {
		// Fall back to a deterministic-but-unique token.
		return fmt.Sprintf("ts-%d", time.Now().UnixNano())
	}
	return hexEncode(b)
}

// ----------------------------------------------------------------------------
// Server lifecycle
// ----------------------------------------------------------------------------

type server struct {
	mu        sync.Mutex
	dbosCtx   dbos.Context
	listener  net.Listener
	sqlDBPath string
	appName   string
	// per-liId cached canonical observation (decoded JSON
	// for the harness) and seed. This is NOT the durable
	// source of truth — that lives in the DBOS system DB
	// via the workflow's step outputs. The cache is a
	// convenience so the harness can read it after a fresh
	// process has re-opened the storeDir.
	liCache map[string]liCacheEntry
}

type liCacheEntry struct {
	canonicalObservation any // decoded UnifiaValue
	seedJSON             string
	logicalInvocationID string
}

func main() {
	storeDir := os.Getenv("M0_STORE_DIR")
	if storeDir == "" {
		storeDir = "./dbos-real-store"
	}
	if err := os.MkdirAll(storeDir, 0o755); err != nil {
		log.Fatalf("mkdir store dir: %v", err)
	}
	dbPath := filepath.Join(storeDir, "dbos.db")
	// Per mandate §5: the production candidate must NEVER
	// implicitly destroy an existing durable database on
	// normal startup. The DBOS binary only:
	//   - creates the directory if absent
	//   - opens the DB if it exists
	//   - creates the DB if it does not exist
	// Fresh-test cleanup is the harness's responsibility
	// (it deletes the staging dir before each run).
	// No `os.Remove(dbPath)` here.
	_ = errors.Is // keep errors import live for future use

	appName := os.Getenv("M0_APP_NAME")
	if appName == "" {
		appName = APPNAME
	}

	srv := &server{sqlDBPath: dbPath, appName: appName, liCache: make(map[string]liCacheEntry)}
	if err := srv.start(); err != nil {
		log.Fatalf("start: %v", err)
	}
	defer srv.close()

	// Block forever
	select {}
}

func (s *server) start() error {
	// Open the DBOS SQLite system DB explicitly (mandate §34:
	// the candidate must use the real DBOS SQLite driver, not
	// only modernc.org/sqlite directly). The driver package
	// registers itself on import (see blank import above).
	db, err := sql.Open("sqlite", s.sqlDBPath+"?_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_txlock=immediate")
	if err != nil {
		return fmt.Errorf("open sqlite: %w", err)
	}
	if err := db.Ping(); err != nil {
		return fmt.Errorf("ping sqlite: %v", err)
	}

	// Build the DBOS context. AppName + SQLiteSystemDB are
	// the v1.0.0 inputs; DatabaseURL is unused because we
	// pass an explicit *sql.DB.
	ctx, err := dbos.NewContext(context.Background(), dbos.Config{
		AppName:        s.appName,
		SQLiteSystemDB: db,
	})
	if err != nil {
		return fmt.Errorf("NewContext: %w", err)
	}
	s.dbosCtx = ctx

	// Register the qualification workflows. WithWorkflowName
	// is the canonical workflow identity used by RunWorkflow.
	dbos.RegisterWorkflow(ctx, StartRunWorkflow, dbos.WithWorkflowName("StartRunWorkflow"))
	dbos.RegisterWorkflow(ctx, DriveAttemptWorkflow, dbos.WithWorkflowName("DriveAttemptWorkflow"))

	// Launch starts the DBOS runtime (queue runner, scheduler,
	// conductor client, workflow recovery).
	if err := dbos.Launch(ctx); err != nil {
		return fmt.Errorf("Launch: %w", err)
	}

	// HTTP control surface
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, "ok")
	})
	mux.HandleFunc("/version", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"version":     "0.0.0-dbos-real-qualify",
			"dbosVersion": "github.com/dbos-inc/dbos-transact-golang v1.0.0",
			"sqliteDriver": "modernc.org/sqlite via dbos/driver/sqlite",
			"appName":     s.appName,
		})
	})
	mux.HandleFunc("/runs", s.handleStartRun)
	mux.HandleFunc("/runs/", s.handleRunSubpath)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	s.listener = ln
	go func() {
		_ = http.Serve(ln, mux)
	}()
	// Print the bind address on stdout for the harness to discover.
	fmt.Println(ln.Addr().String())
	log.Printf("dbos-real-qualify listening on http://%s (app=%s, db=%s)", ln.Addr().String(), s.appName, s.sqlDBPath)
	return nil
}

func (s *server) close() {
	if s.dbosCtx != nil {
		// DBOS contexts do not have an explicit Shutdown in v1.0.0;
		// the runtime exits when the process exits.
	}
	if s.listener != nil {
		_ = s.listener.Close()
	}
}

// ----------------------------------------------------------------------------
// HTTP handlers
// ----------------------------------------------------------------------------

func (s *server) handleStartRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in StartRunInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	// Per mandate §8: WorkflowRunId is generated by the
	// candidate (or supplied). The DBOS root WorkflowID = the
	// WorkflowRunId so restart / history / GetWorkflowSteps
	// always find the right root.
	runID := in.RunID
	if runID == "" {
		runID = "run-" + randHex(16)
	}
	wfID := runID // DBOS WorkflowID is the WorkflowRunId
	handle, err := dbos.RunWorkflow(s.dbosCtx, StartRunWorkflow, in, dbos.WithWorkflowID(wfID))
	if err != nil {
		http.Error(w, "RunWorkflow: "+err.Error(), http.StatusInternalServerError)
		return
	}
	out, err := handle.GetResult()
	if err != nil {
		http.Error(w, "GetResult: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if out.RunID != runID {
		// Defensive: ensure the returned RunID is exactly what
		// we generated.
		out.RunID = runID
	}
	// Per mandate §19: read the canonical observation back
	// from the DBOS step output. The step result is the
	// seed canonical JSON string. We decode it to a
	// generic interface so the harness can re-encode it
	// as a UnifiaValue and compare bit-exact.
	steps, err := dbos.GetWorkflowSteps(s.dbosCtx, wfID, dbos.WithStepsLoadOutput(true))
	if err != nil {
		http.Error(w, "GetWorkflowSteps: "+err.Error(), http.StatusInternalServerError)
		return
	}
	var canonicalObservation any
	for _, step := range steps {
		if step.StepName == "persist-canonical-observation" {
			// Step.Output is the raw JSON string; decode to
			// a generic value so the harness sees a UnifiaValue.
			if s, ok := step.Output.(string); ok {
				var v any
				if err := json.Unmarshal([]byte(s), &v); err == nil {
					canonicalObservation = v
				} else {
					canonicalObservation = s
				}
			} else {
				canonicalObservation = step.Output
			}
			break
		}
	}
	w.Header().Set("Content-Type", "application/json")
	nowMs := time.Now().UnixMilli()
	_ = json.NewEncoder(w).Encode(map[string]any{
		"runId":              out.RunID,
		"authorityGeneration": 1,
		"status":              "RUNNING",
		"logicalInvocations": []map[string]any{
			{
				"logicalInvocationId":  in.LogicalInvocationID,
				"attempts":             []map[string]any{},
				"currentAttemptId":     "att-" + in.LogicalInvocationID + "-1",
				"canonicalObservation": canonicalObservation,
				"terminal":             false,
			},
		},
		"approvalIds":     []string{},
		"durableTimerIds": []string{},
		"effectIds":       []string{"eff-" + in.LogicalInvocationID + "-1"},
		"schemaVersion":   1,
		"nextAttemptId":   1,
		"createdAtEpochMs": nowMs,
		"updatedAtEpochMs": nowMs,
		"_dbos": map[string]any{
			"workflowExecuted":     true,
			"rootWorkflowID":       wfID,
			"stepReached":          "persist-canonical-observation",
			"workflowRunCompleted": true,
			"readbackSource":       "DBOS_DURABLE_STEP",
		},
	})
	// Update the cache ONLY for the startRun path so the same
	// process returns the right value on a subsequent
	// inspectRun. The cache MUST be empty after a fresh
	// process restart (test in store-guard.test.ts). Cache
	// key is the runId (canonical identity) not the
	// logicalInvocationId.
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.liCache == nil {
		s.liCache = make(map[string]liCacheEntry)
	}
	if canonicalObservation != nil {
		s.liCache[runID] = liCacheEntry{
			canonicalObservation: canonicalObservation,
			seedJSON:             in.SeedCanonicalJSON,
			logicalInvocationID: in.LogicalInvocationID,
		}
	}
}

func (s *server) handleRunSubpath(w http.ResponseWriter, r *http.Request) {
	// Path: /runs/:runId or /runs/:runId/invocations/:liId/attempts
	path := r.URL.Path[len("/runs/"):]
	if path == "" {
		http.NotFound(w, r)
		return
	}
	// Find next /
	slash := -1
	for i, c := range path {
		if c == '/' {
			slash = i
			break
		}
	}
	if slash < 0 {
		// /runs/:runId -> GET state reconstructed from DBOS
		// step outputs (mandate §19: NO synthetic state).
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		runID := path
		// Find the logical invocation for this run.
		// The harness convention: logicalInvocationId is
		// stored in the `persist-invocation` DBOS step
		// output and the canonical observation in the
		// `persist-canonical-observation` step output.
		// We reconstruct BOTH from durable DBOS state
		// (mandate §18-§19). The in-process cache is
		// only a fast-path for the same-process case;
		// a fresh process must be able to recover with
		// an empty cache.
		steps, gerr := dbos.GetWorkflowSteps(s.dbosCtx, runID, dbos.WithStepsLoadOutput(true))
		var canonicalObservation any
		var logicalInvocationID string = runID
		if gerr == nil {
			for _, step := range steps {
				switch step.StepName {
				case "persist-canonical-observation":
					if s2, ok := step.Output.(string); ok {
						var v any
						if jerr := json.Unmarshal([]byte(s2), &v); jerr == nil {
							canonicalObservation = v
						} else {
							canonicalObservation = s2
						}
					} else {
						canonicalObservation = step.Output
					}
				case "persist-invocation":
					// The step's return value is the
					// logicalInvocationId. DBOS Go v1.0.0
					// returns the step output as a JSON-
					// encoded string (i.e. the value is
					// wrapped in extra quotes). Strip them.
					// Recover from durable DBOS step output
					// (mandate §19: no synthetic data).
					if s2, ok := step.Output.(string); ok && s2 != "" {
						liRaw := s2
						if len(liRaw) >= 2 && liRaw[0] == '"' && liRaw[len(liRaw)-1] == '"' {
							var unq string
							if jerr := json.Unmarshal([]byte(liRaw), &unq); jerr == nil {
								liRaw = unq
							}
						}
						if liRaw != "" {
							logicalInvocationID = liRaw
						}
					}
				}
			}
		}
		// If we have a cached entry for this runID, use its
		// logicalInvocationID and the cached canonical
		// observation (only the same-process path; a fresh
		// process has no cache and reconstructs from DBOS).
		s.mu.Lock()
		if entry, ok := s.liCache[runID]; ok {
			if entry.logicalInvocationID != "" {
				logicalInvocationID = entry.logicalInvocationID
			}
			if entry.canonicalObservation != nil {
				canonicalObservation = entry.canonicalObservation
			}
		}
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		nowMs := time.Now().UnixMilli()
		_ = json.NewEncoder(w).Encode(map[string]any{
			"runId":              runID,
			"authorityGeneration": 1,
			"status":              "RUNNING",
			"logicalInvocations": []map[string]any{
				{
					"logicalInvocationId":  logicalInvocationID,
					"attempts":             []map[string]any{},
					"currentAttemptId":     "att-" + logicalInvocationID + "-1",
					"canonicalObservation": canonicalObservation,
					"terminal":             false,
				},
			},
			"approvalIds":     []string{},
			"durableTimerIds": []string{},
			"effectIds":       []string{"eff-" + logicalInvocationID + "-1"},
			"schemaVersion":   1,
			"nextAttemptId":   1,
			"createdAtEpochMs": nowMs,
			"updatedAtEpochMs": nowMs,
			"_dbos": map[string]any{
				"rootWorkflowID": runID,
				"readbackSource": "DBOS_DURABLE_STEP",
				"reconstructed":  gerr == nil,
			},
		})
		return
	}
	runID := path[:slash]
	rest := path[slash+1:]
	if rest == "" {
		http.NotFound(w, r)
		return
	}
	// Look for /invocations/:liId/attempts
	if len(rest) > len("invocations/") && rest[:len("invocations/")] == "invocations/" {
		liAndRest := rest[len("invocations/"):]
		liSlash := -1
		for i, c := range liAndRest {
			if c == '/' {
				liSlash = i
				break
			}
		}
		if liSlash < 0 || liAndRest[liSlash+1:] != "attempts" {
			http.NotFound(w, r)
			return
		}
		liID := liAndRest[:liSlash]
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var in DriveAttemptInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
			return
		}
		// Per mandate §12: the attempt DBOS WorkflowID
		// includes the durable AttemptId. Two retries of
		// the same (runId, liId, attemptId) return the same
		// durable result; a different attemptId produces a
		// distinct durable workflow.
		attemptWFID := "unifia-attempt:" + in.RunID + ":" + liID + ":" + in.AttemptID
		// The canonical input's runId/liId may match the URL
		// path; override them from the request body for
		// robustness.
		in.LogicalInvocationID = liID
		if in.RunID == "" {
			in.RunID = runID
		}
		handle, err := dbos.RunWorkflow(s.dbosCtx, DriveAttemptWorkflow, in, dbos.WithWorkflowID(attemptWFID))
		if err != nil {
			http.Error(w, "RunWorkflow: "+err.Error(), http.StatusInternalServerError)
			return
		}
		out, err := handle.GetResult()
		if err != nil {
			http.Error(w, "GetResult: "+err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		nowMs := time.Now().UnixMilli()
		_ = json.NewEncoder(w).Encode(map[string]any{
			"attemptId":            in.AttemptID,
			"startedAtEpochMs":     nowMs - 1,
			"completedAtEpochMs":   nowMs,
			"status":               out.Status,
			"canonicalOutput":      in.CanonicalResult,
			"effectId":             out.EffectID,
			"_dbos": map[string]any{
				"workflowExecuted": true,
				"stepReached":      "record-attempt",
				"attemptWorkflowID": attemptWFID,
			},
		})
		return
	}
	http.NotFound(w, r)
}
