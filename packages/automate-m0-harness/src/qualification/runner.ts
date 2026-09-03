/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M0 common oracle runner (substrate-neutral).
 *
 * Drives the qualification adapter through the P0 tests (per pack
 * gelé §23) and writes:
 *   - evidence/<candidate>/<FC>/...
 *   - M0_RESULTS_<CANDIDATE>.json (via the result builder)
 *
 * No candidate-specific logic may live here. If a test needs
 * candidate-specific behavior, the oracle must express it through
 * the contract, and the contract must remain substrate-neutral.
 */

import { writeFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { writeEvidence as writeEvidenceShared } from "./evidence-writer.ts"
import {
  fromHostFloat64,
  fromHostInteger,
  canonicalEquals,
  CanonicalValueError,
  type UnifiaValue,
  type WorkflowRunId,
  type WorkflowVersionId,
  type LogicalInvocationId,
  type AttemptId,
  type ApprovalId,
  type DurableTimerId,
  type EffectId,
} from "@unifia/automate-m0-contract"
import type {
  DurableWorkflowAuthorityQualificationAdapter,
  CandidateInfo,
  FunctionalCriterionId,
  FunctionalCriterionResult,
  QualificationStatus,
  StartRunInput,
  ProviderResolution,
} from "./contract.ts"
import { CandidateResultBuilder, ExpectedNABuilder, evidencePath, resultsPath, expectedNAPath, blockedNote } from "./result.ts"
import { FC_31A_VALUES, FC_31B_VECTORS, bitsToFloat64 } from "./vectors/fc31-fixtures.ts"
import { FakeExternalEffectProvider } from "./providers/fake-external.ts"

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

export interface RunnerOptions {
  /** Output root for evidence + result files. */
  readonly outputRoot: string
  /** Build hash to stamp on each result. */
  readonly buildHash: string
  /**
   * Tests to execute. If undefined, the default P0 set is used:
   *   FC-31A, FC-31B, FC-04, FC-14, FC-25, FC-32.
   * FC-13-CTRL / FC-13 are explicitly NOT in the default set because
   * they require power-loss methodology the harness cannot guarantee
   * in this environment (see EXPECTED_NA file).
   */
  readonly testsToRun?: readonly FunctionalCriterionId[]
}

/* ------------------------------------------------------------------ */
/* Helper: per-FC evidence folder                                       */
/* ------------------------------------------------------------------ */

async function writeEvidence(
  fcFolder: string,
  filename: string,
  data: unknown,
): Promise<string> {
  await mkdir(fcFolder, { recursive: true })
  const path = join(fcFolder, filename)
  await writeFile(path, typeof data === "string" ? data : JSON.stringify(data, null, 2), "utf8")
  return path
}

/* ------------------------------------------------------------------ */
/* Default P0 set                                                      */
/* ------------------------------------------------------------------ */

const DEFAULT_P0_TESTS: readonly FunctionalCriterionId[] = [
  "FC-31A",
  "FC-31B",
  "FC-04",
  "FC-14",
  "FC-25",
  "FC-32",
  // FC-13 and FC-13-CTRL are added explicitly so the result file
  // records them as BLOCKED with explicit methodology-gap evidence
  // (per pack gelé review 2026-09-03, v1.1 §2: BLOCKED ≠ NOT_VALID;
  // a missing methodology is BLOCKED, not NOT_APPLICABLE).
  "FC-13-CTRL",
  "FC-13",
]

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

export class QualificationRunner {
  private readonly opts: RunnerOptions
  private readonly adapter: DurableWorkflowAuthorityQualificationAdapter
  private readonly provider: FakeExternalEffectProvider
  private readonly info: CandidateInfo | null = null
  private readonly builder: CandidateResultBuilder

  constructor(
    adapter: DurableWorkflowAuthorityQualificationAdapter,
    provider: FakeExternalEffectProvider,
    opts: RunnerOptions,
  ) {
    this.adapter = adapter
    this.provider = provider
    this.opts = opts
    this.builder = new CandidateResultBuilder(
      // placeholder; replaced after candidateInfo()
      {
        kind: "UNIFIA_NATIVE",
        version: "0.0.0",
        buildHash: opts.buildHash,
        storage: {
          engine: "n/a",
          driver: "n/a",
          journalMode: "n/a",
          synchronous: "n/a",
          busyTimeoutMs: 0,
          maxOpenConns: 0,
          backupTarget: "file",
        },
        process: { topology: "n/a", multiProcessSafe: false },
      },
      opts.buildHash,
    )
  }

  /** Run the default P0 set (or the configured set) and write the result file. */
  async run(): Promise<{ resultPath: string; expectedNAPath: string; builder: CandidateResultBuilder }> {
    const info = await this.adapter.candidateInfo()
    // Replace the placeholder candidate info in the builder.
    // We do this by reconstructing the builder.
    const realBuilder = new CandidateResultBuilder(info, this.opts.buildHash)
    Object.assign(this.builder, realBuilder)

    // Per pack gelé review 2026-09-03 v1.1 (CP4+ follow-up): the
    // runner used to call `this.adapter.initialize()` inside every
    // `runFC*` method. For child-process candidates (DBOS Go v1.0.0)
    // this meant re-spawning a ~30-60s Go process for each FC test.
    // The harness now initializes ONCE at the start and shuts down
    // ONCE at the end. The per-FC `runFC*` methods are expected to
    // assume the adapter is already initialized.
    await this.adapter.initialize()
    await this.provider.initialize()

    const tests = this.opts.testsToRun ?? DEFAULT_P0_TESTS
    try {
      for (const fc of tests) {
        try {
          await this.runOne(fc)
        } catch (e) {
          const folder = evidencePath(this.opts.outputRoot, info.kind, fc)
          const errorPath = await writeEvidence(
            folder,
            "error.txt",
            `Runner failed to execute ${fc}: ${(e as Error).message}\n${(e as Error).stack ?? ""}`,
          )
          this.builder.record({
            testId: fc,
            status: "FAIL_CORRECTABLE",
            evidencePath: errorPath,
            note: `Runner exception: ${(e as Error).message}`,
            observations: { exception: (e as Error).name },
          })
        }
      }
    } finally {
      await this.adapter.shutdown().catch(() => undefined)
      await this.provider.shutdown().catch(() => undefined)
    }

    const resultPath = resultsPath(this.opts.outputRoot, info.kind)
    await this.builder.write(resultPath)

    // EXPECTED_NA : per pack gelé review (correction pack 2026-09-03,
    // v1.1 §3), this file contains ONLY NOT_APPLICABLE entries.
    // BLOCKED outcomes are written into M0_RESULTS_*.json by the
    // runner, not into the expected-NA file.
    const naBuilder = new ExpectedNABuilder(info.kind)
    const naPath = expectedNAPath(this.opts.outputRoot, info.kind)
    await naBuilder.write(naPath)

    return { resultPath, expectedNAPath: naPath, builder: this.builder }
  }

  /* ------------------------------------------------------------------ */
  /* Single-FC driver                                                   */
  /* ------------------------------------------------------------------ */

  private async runOne(fc: FunctionalCriterionId): Promise<void> {
    const info = await this.adapter.candidateInfo()
    switch (fc) {
      case "FC-31A":    return this.runFC31A(info)
      case "FC-31B":    return this.runFC31B(info)
      case "FC-04":     return this.runFC04(info)
      case "FC-14":     return this.runFC14(info)
      case "FC-25":     return this.runFC25(info)
      case "FC-32":     return this.runFC32(info)
      case "FC-13-CTRL": return this.runFC13CTRL(info)
      case "FC-13":     return this.runFC13(info)
      default:
        throw new Error(`test ${fc} not implemented in default P0 set`)
    }
  }

  /* ------------------------------------------------------------------ */
  /* FC-31A : canonical value round-trip WITH RESTART                    */
  /* ------------------------------------------------------------------ */

  private async runFC31A(info: CandidateInfo): Promise<void> {
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-31A")
    // Per pack gelé review 2026-09-03 v1.1 §4: FC-31A is a RESTART
    // test, not a same-instance round-trip. The harness must:
    //
    //   1. Initialize candidate A
    //   2. Persist canonical value
    //   3. Close / shutdown candidate A
    //   4. WITHOUT deleting the durable store, construct candidate
    //      B (same store)
    //   5. Reopen the durable store
    //   6. Inspect / recover the canonical value
    //   7. Compare exact semantic value
    //
    // PASS only after this restart. The previous implementation
    // (same-instance persist+inspect) is NOT a proof of durability
    // and was reclassified NOT_VALID.
    try {
      let pass = 0
      let fail = 0
      const observations: Record<string, unknown> = {}
      const adapterInfo = await this.adapter.candidateInfo()
      const isChildProcess =
        adapterInfo.process.topology === "child-process" ||
        adapterInfo.process.topology === "sidecar" ||
        adapterInfo.process.topology === "remote"

      for (const v of FC_31A_VALUES) {
        const liId = `li-${v.name}` as LogicalInvocationId

        // Step 1-2: candidate A persists the canonical value.
        const runIdA = await this.adapter.startRun({
          workflowVersionId: "wf-fc31a" as WorkflowVersionId,
          ownerScope: { organizationId: "o1", workspaceId: "ws-fc31a" },
          initialLogicalInvocation: {
            logicalInvocationId: liId,
            effectKey: `ek-${v.name}`,
            canonicalInput: v.value,
          },
          seedCanonicalValue: v.value,
        } satisfies StartRunInput)
        await this.adapter.driveAttempt(runIdA, liId, {
          effectKey: `ek-${v.name}`,
          outcome: "SUCCEEDED",
          canonicalResult: v.value,
          ackLost: false,
          idempotencyKey: `ik-${v.name}-1`,
          providerCommittedAtEpochMs: Date.now(),
        } satisfies ProviderResolution)

        // Step 3-5: close the candidate, then reopen on the same
        // durable store. For in-process (Native) candidates, this
        // is forceProcessCrash() + reopen() (the adapter closes the
        // SQLite handle and re-opens it). For child-process (DBOS
        // Go) candidates, this kills the Go binary and spawns a
        // fresh one pointed at the same M0_STORE_DIR.
        await this.adapter.forceProcessCrash()
        await this.adapter.reopen()

        // Step 6: inspect the recovered run.
        const stateB = await this.adapter.inspectRun(runIdA)
        const lastB = stateB.logicalInvocations[0]
        if (!lastB) {
          fail++
          observations[v.name] = { ok: false, reason: "no invocation state after restart" }
          continue
        }
        const observed = lastB.canonicalObservation
        if (observed === null) {
          fail++
          observations[v.name] = { ok: false, reason: "observation is null after restart" }
          continue
        }
        const ok = canonicalEquals(observed, v.value)
        if (ok) pass++
        else {
          fail++
          observations[v.name] = { ok: false, expected: v.value, observed, bitPattern: v.bitPattern.toString() }
        }
      }

      const status: QualificationStatus = fail === 0 ? "PASS" : "FAIL_CORRECTABLE"
      const evidence = await writeEvidence(folder, "result.json", {
        pass,
        fail,
        observations,
        restartObserved: true,
        adapterTopology: info.process.topology,
        isChildProcess,
      })
      this.builder.record({
        testId: "FC-31A",
        status,
        evidencePath: evidence,
        note: `${pass}/${FC_31A_VALUES.length} canonical values survived a candidate restart (close+reopen on same durable store). ${fail} mismatches.`,
        observations: { pass, fail, total: FC_31A_VALUES.length, restartObserved: true },
      })
    } catch (e) {
      throw e
    }
  }

  /* ------------------------------------------------------------------ */
  /* FC-31B : host-integer vs host-float64 separation                    */
  /* ------------------------------------------------------------------ */

  private async runFC31B(info: CandidateInfo): Promise<void> {
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-31B")
    // Adapter is initialized once in run() (single-init lifecycle).
    //
    // Per pack gelé review 2026-09-03 v1.1 §6-§8: FC-31B is a
    // HOST ADAPTER test, not a TS-side conversion test. For
    // candidates whose actual host is TS/Bun (UNIFIA_NATIVE in
    // M0), the harness can use the TS contract conversion
    // functions (fromHostFloat64 / fromHostInteger) — these are
    // the actual host adapter. For candidates whose actual host
    // is Go (DBOS_GO_SQLITE), the harness must drive the test
    // through the Go host's own typed fixtures. The current
    // harness uses TS conversion for both, so FC-31B is NOT_VALID
    // for DBOS_GO_SQLITE until a real Go host adapter is wired up.
    const isChildProcess =
      info.process.topology === "child-process" || info.process.topology === "sidecar" || info.process.topology === "remote"
    if (isChildProcess) {
      const observations = {
        measured: false,
        reason: "FC-31B requires the candidate's actual host (Go) to apply the host-adapter contract. The current harness uses the TS host adapter for both candidates; for DBOS_GO_SQLITE this is NOT_VALID until a real Go host adapter is implemented that receives typed fixtures (float64, int64, uint64) and applies the contract in Go itself.",
        expectedFromUpstream: "Per pack gelé §8: float64(9007199254740992) → PASS, int64(9007199254740991) → PASS, int64(9007199254740992) → NUMBER_OUT_OF_CANONICAL_RANGE, math.MaxInt64/MinInt64 → NUMBER_OUT_OF_CANONICAL_RANGE",
        requiredMethodology: "(1) Send typed fixtures (float64, int64, uint64, math.MaxInt64) over HTTP to a Go endpoint. (2) Go host applies the same FC-31B contract. (3) Verify accept/reject decisions. (4) Reclassify to PASS only if Go host emits the canonical decisions.",
        nextAction: "Add /host-adapter/canonize endpoint to dbos-qualify.exe that receives {value: float64, origin: 'GO_FLOAT64'|'GO_INT64'|'GO_UINT64'} and returns PASS/REJECT(NUMBER_OUT_OF_CANONICAL_RANGE) per the contract.",
      }
      const evidence = await writeEvidence(folder, "result.json", observations)
      this.builder.record({
        testId: "FC-31B",
        status: "NOT_VALID",
        evidencePath: evidence,
        note: "FC-31B NOT_VALID for DBOS Go: harness uses TS host adapter, not the Go host. The Go binary must receive typed fixtures (float64/int64/uint64/MaxInt64) and apply the FC-31B contract itself. See observations.requiredMethodology for the unblock path.",
        observations,
      })
      return
    }
    try {
      // The adapter does not "convert" via toCanonicalValue() on
      // the way in; the contract exposes already-canonical values.
      // FC-31B is therefore tested at the harness level: the harness
      // owns the conversion, and we record whether the candidate
      // round-trips what the harness provides.
      //
      // Per pack gelé §17, the test is the host's own behavior, not
      // the candidate's. We delegate to the contract's conversion
      // functions and confirm the candidate round-trips a few key
      // edge values.
      let pass = 0
      let fail = 0
      const observations: Record<string, unknown> = {}
      for (const v of FC_31B_VECTORS) {
        let canonicalValue: UnifiaValue | null = null
        let conversionError: CanonicalValueError | null = null
        try {
          if (v.adapter === "fromHostFloat64") {
            canonicalValue = fromHostFloat64(v.input as number)
          } else {
            canonicalValue = fromHostInteger(v.input as number | bigint)
          }
        } catch (e) {
          conversionError = e as CanonicalValueError
        }
        if (v.expected === "PASS") {
          if (conversionError) {
            fail++
            observations[v.name] = { ok: false, reason: "expected PASS, got REJECT", code: conversionError.code }
            continue
          }
          if (canonicalValue === null) {
            fail++
            observations[v.name] = { ok: false, reason: "canonicalValue null after conversion" }
            continue
          }
          // Run the value through the candidate.
          const liId = `li-${v.name}` as LogicalInvocationId
          const runId = await this.adapter.startRun({
            workflowVersionId: "wf-fc31b" as WorkflowVersionId,
            ownerScope: { organizationId: "o1", workspaceId: "ws-fc31b" },
            initialLogicalInvocation: {
              logicalInvocationId: liId,
              effectKey: `ek-${v.name}`,
              canonicalInput: canonicalValue,
            },
            seedCanonicalValue: canonicalValue,
          } satisfies StartRunInput)
          await this.adapter.driveAttempt(runId, liId, {
            effectKey: `ek-${v.name}`,
            outcome: "SUCCEEDED",
            canonicalResult: canonicalValue,
            ackLost: false,
            idempotencyKey: `ik-${v.name}-1`,
            providerCommittedAtEpochMs: Date.now(),
          } satisfies ProviderResolution)
          const state = await this.adapter.inspectRun(runId)
          const observed = state.logicalInvocations[0]?.canonicalObservation ?? null
          if (observed === null || !canonicalEquals(observed, canonicalValue)) {
            fail++
            observations[v.name] = { ok: false, reason: "round-trip mismatch", expected: canonicalValue, observed }
          } else {
            pass++
            observations[v.name] = { ok: true }
          }
        } else {
          if (!conversionError) {
            fail++
            observations[v.name] = { ok: false, reason: "expected REJECT, got PASS" }
          } else if (conversionError.code !== v.expectedErrorCode) {
            fail++
            observations[v.name] = { ok: false, reason: `expected code ${v.expectedErrorCode}, got ${conversionError.code}` }
          } else {
            pass++
            observations[v.name] = { ok: true, code: conversionError.code }
          }
        }
      }
      const status: QualificationStatus = fail === 0 ? "PASS" : "FAIL_CORRECTABLE"
      const evidence = await writeEvidence(folder, "result.json", { pass, fail, observations })
      this.builder.record({
        testId: "FC-31B",
        status,
        evidencePath: evidence,
        note: `${pass}/${FC_31B_VECTORS.length} host-integer/float64 separation cases handled correctly.`,
        observations: { pass, fail, total: FC_31B_VECTORS.length },
      })
    } catch (e) {
      throw e
    }
  }

  /* ------------------------------------------------------------------ */
  /* FC-04 : provider success + local ACK lost                          */
  /* ------------------------------------------------------------------ */

  private async runFC04(info: CandidateInfo): Promise<void> {
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-04")
    // Per pack gelé review 2026-09-03 v1.1 §10-§12: FC-04
    // requires REAL transport-level ACK loss, not a magic flag.
    // The harness must observe that:
    //
    //   1. The candidate actually called a real external provider
    //      (NOT just received a flag from the harness).
    //   2. The provider durably committed the effect to its own
    //      journal.
    //   3. The transport ACK was dropped after the commit.
    //   4. The candidate's recovery resolved to UNKNOWN_EXTERNAL_STATE.
    //
    // The current implementation uses `providerResponse.ackLost: true`
    // as a flag the harness passes to the candidate. For
    // UNIFIA_NATIVE, the candidate consults this flag and
    // short-circuits to UNKNOWN_EXTERNAL_STATE without calling the
    // provider — so we observe a UNKNOWN_EXTERNAL_STATE but the
    // provider was never called. For DBOS_GO_SQLITE, the candidate
    // is process-isolated and has no provider at all — the
    // `ackLost` flag is a magic value that the Go binary maps to
    // UNKNOWN_EXTERNAL_STATE in its custom SQLite, with no
    // provider involvement.
    //
    // Per §12, the current FC-04 PASS for DBOS Go is NOT_VALID.
    // We reclassify it here. The unblock path is documented in
    // observations.requiredMethodology.
    const isChildProcess =
      info.process.topology === "child-process" || info.process.topology === "sidecar" || info.process.topology === "remote"
    if (isChildProcess) {
      const observations = {
        measured: false,
        reason: "FC-04 requires real transport-level ACK loss, not a magic flag. The current DBOS Go candidate has no wired-in external provider; the harness passes `ackLost: true` to the Go binary's HTTP body, which the Go binary maps to UNKNOWN_EXTERNAL_STATE in its custom SQLite — but no provider was actually called, no provider commitment occurred, and no transport ACK was dropped. Per pack gelé §12 this is NOT_VALID until a real external provider architecture is wired in.",
        providerCalled: 0,
        providerCommitted: false,
        providerJournalContainsEffectKey: false,
        candidateDidNotReceiveSuccessAck: "by configuration, not by transport loss",
        candidateRestartedOrRecoveryPathExercised: false,
        blindRetryCount: 0,
        requiredMethodology: "(1) Stand up a real FakeExternalEffectProvider as an HTTP service with its own SQLite journal (separate from the candidate). (2) Candidate's driveAttempt makes an HTTP call to the provider with the EffectKey. (3) Provider durably commits the effect. (4) Provider is configured to drop the response ACK (close TCP without sending the HTTP response). (5) Candidate's driveAttempt times out / receives no response. (6) Candidate's recovery path resolves to UNKNOWN_EXTERNAL_STATE. (7) Cross-verify the provider's journal contains the effectKey.",
        nextAction: "Add a fake external provider HTTP service with its own SQLite journal; have the candidate's driveAttempt call the provider over HTTP; verify the provider's journal has the effectKey after the candidate's recovery.",
      }
      const evidence = await writeEvidence(folder, "result.json", observations)
      this.builder.record({
        testId: "FC-04",
        status: "NOT_VALID",
        evidencePath: evidence,
        note: "FC-04 NOT_VALID for DBOS Go: `ackLost: true` is a magic flag from the harness, not real transport-level ACK loss. The candidate has no wired-in provider; the Go binary maps the flag to UNKNOWN_EXTERNAL_STATE without any provider involvement. See observations.requiredMethodology for the unblock path.",
        observations,
      })
      return
    }
    // Adapter is initialized once in run() (single-init lifecycle).
    try {
      // Per pack gelé §10-§12 + CP6.1 §18-§20: FC-04 requires
      // real transport-level ACK loss, not a magic flag from
      // the harness. For UNIFIA_NATIVE the evidence records
      // `transportLevelAckLoss: false` because the candidate and
      // the provider are both in-process; the `ackLost: true`
      // flag is a configuration signal, not a real transport
      // loss. Per pack gelé §18, FC-04 for UNIFIA_NATIVE is
      // NOT_VALID — there is no exception for in-process.
      //
      // We still drive the test (to record what the candidate
      // does in response to the flag) and document the
      // evidence, but the status is NOT_VALID.
      const runId = await this.adapter.startRun({
        workflowVersionId: "wf-fc04" as WorkflowVersionId,
        ownerScope: { organizationId: "o1", workspaceId: "ws-fc04" },
        initialLogicalInvocation: {
          logicalInvocationId: "li-fc04" as LogicalInvocationId,
          effectKey: "ek-fc04",
          canonicalInput: fromHostFloat64(42),
        },
        seedCanonicalValue: fromHostFloat64(42),
      } satisfies StartRunInput)
      const attempt = await this.adapter.driveAttempt(runId, "li-fc04" as LogicalInvocationId, {
        effectKey: "ek-fc04",
        outcome: "SUCCEEDED",
        canonicalResult: fromHostFloat64(99),
        ackLost: true,
        idempotencyKey: "ik-fc04-1",
        providerCommittedAtEpochMs: Date.now(),
      } satisfies ProviderResolution)

      // Per pack gelé §18, FC-04 is NOT_VALID for both candidates
      // until a real external provider transport is wired in.
      const observations = {
        attemptStatus: attempt.status,
        ackLostSignal: true,
        adapterTopology: info.process.topology,
        transportLevelAckLoss: false,
        providerReceivedEffect: false,
        providerCommittedEffect: false,
        providerJournalContainsEffectKey: false,
        transportAckActuallyLost: false,
        candidateDidNotObserveSuccess: "by configuration, not by transport loss",
        candidateRestartedOrRecoveryPathExercised: false,
        blindRetryCount: 0,
        note: "FC-04 requires real transport-level ACK loss from an INDEPENDENT external provider. The current architecture is in-process (Native) or magic-flag (DBOS Go); neither satisfies the pack gelé §18-§20 contract. NOT_VALID until a FakeExternalEffectProviderProcess is wired in (separate HTTP service, separate SQLite journal, transport-level ACK drop after commit).",
      }
      const evidence = await writeEvidence(folder, "result.json", observations)
      this.builder.record({
        testId: "FC-04",
        status: "NOT_VALID",
        evidencePath: evidence,
        note: "FC-04 NOT_VALID: the harness uses `ackLost: true` as a magic flag, not a real transport-level ACK loss from an independent external provider. UNIFIA_NATIVE has no in-process exception per pack gelé §18. Reclassified from CP4 PASS.",
        observations,
      })
    } catch (e) {
      throw e
    }
  }

  /* ------------------------------------------------------------------ */
  /* FC-14 : multi-process authority (real 2-OS-process for DBOS Go)    */
  /* ------------------------------------------------------------------ */

  private async runFC14(info: CandidateInfo): Promise<void> {
    // Per pack gelé §15 + CP6.1 (2026-09-03 v1.1 §1-§7): FC-14
    // requires not only a real concurrent race between 2 OS
    // processes, but also a proof that the winning authority
    // can act (authoritative mutation + effect dispatch accepted)
    // and the losing authority's attempts are REJECTED on both
    // paths. The previous CP5 implementation only proved
    // ownership of the run_authority row; the orchestration
    // authority was not exercised.
    //
    // The current runner reclassifies FC-14 as NOT_VALID for
    // both candidates. The CP5/CP6 primitives (concurrent claim,
    // monotonic generation) are preserved as evidence under
    // FC-14/previous-cp5-claim-primitive.json.
    //
    // The unblock path is the new FC-14 oracle (CP6.1 §6-§7):
    //   1. Two real OS processes on the same storeDir.
    //   2. Both processes call /authority/claim concurrently
    //      (Promise.all after a barrier).
    //   3. The winner attempts /authority/mutate with its token
    //      (generation, authorityOwnerId). The loser's token
    //      cannot match (it is rejected on the candidate side).
    //   4. The winner attempts /authority/dispatch with its
    //      token. The loser's dispatch is rejected.
    //   5. PASS only if:
    //        winner.mutate = ACCEPTED
    //        loser.mutate  = REJECTED
    //        winner.dispatch = ACCEPTED
    //        loser.dispatch  = REJECTED
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-14")
    const isChildProcess =
      info.process.topology === "child-process" || info.process.topology === "sidecar" || info.process.topology === "remote"

    const observations: Record<string, unknown> = {
      measured: false,
      reason: isChildProcess
        ? "FC-14 requires not only a concurrent race but also a proof that the winning authority can act (authoritative mutation + effect dispatch accepted) and the losing authority's attempts are REJECTED on both paths. The previous CP5 implementation only proved ownership of the run_authority row. Per pack gelé §7, singleAuthority = true means 'can act', not 'owns a row'. FC-14 is NOT_VALID for CUSTOM_GO_SQLITE_CONTROL until the runner is rewired to drive authoritative mutation + dispatch after the race, with concurrent Promise.all and a result-integrity check."
        : "FC-14 requires two real OS processes. Native M0 currently exercises the in-process methodology only (two Database handles in one process). A real multi-process Native test (separate Bun process + shared SQLite file) is the unblock path.",
      requiredMethodology: "(1) Two real OS processes on the same storeDir. (2) Both call /authority/claim concurrently (Promise.all after barrier). (3) Winner attempts /authority/mutate with its (generation, authorityOwnerId) token. (4) Loser attempts /authority/mutate with its token (must be REJECTED). (5) Winner attempts /authority/dispatch. (6) Loser attempts /authority/dispatch (must be REJECTED). (7) PASS only if all four post-race assertions hold.",
      unblockPath: "Rewire the runner to use Promise.all([claimA, claimB]) with a barrier, then both processes issue /authority/mutate and /authority/dispatch with their respective tokens. The runner enforces the four post-race invariants in the result builder.",
      previousCp5Evidence: "evidence/<candidate>/FC-14/previous-cp5-claim-primitive.json",
    }
    // Preserve the CP5/6 evidence by copying the old (in-process)
    // trace to a renamed file so it is not lost.
    try {
      const fs = await import("node:fs/promises")
      const oldEvidence = `${folder}/result.json`
      const preserved = `${folder}/previous-cp5-claim-primitive.json`
      const content = await fs.readFile(oldEvidence, "utf8")
      await fs.writeFile(preserved, content, "utf8")
    } catch { /* noop */ }
    const evidence = await writeEvidence(folder, "result.json", {
      status: "NOT_VALID",
      observations,
      note: isChildProcess
        ? "FC-14 NOT_VALID for CUSTOM_GO_SQLITE_CONTROL: the previous CP5 implementation proved only that one of two processes could claim authority (ownership of a row), not that the winner could act on that authority (authoritative mutation + dispatch accepted, loser REJECTED on both). Per pack gelé §7, singleAuthority=true means 'can act', not 'owns a row'. Reclassified to NOT_VALID."
        : "FC-14 NOT_VALID for Native: in-process methodology does not satisfy the pack gelé §15 contract. Multi-process Native test is the unblock path.",
    })
    this.builder.record({
      testId: "FC-14",
      status: "NOT_VALID",
      evidencePath: evidence,
      note: isChildProcess
        ? "FC-14 NOT_VALID for CUSTOM_GO_SQLITE_CONTROL per pack gelé §7: only ownership of a row was proven, not orchestration authority (mutate + dispatch). Reclassified from CP5 PASS."
        : "FC-14 NOT_VALID for Native: in-process methodology only. Multi-process Native test is the unblock path.",
      observations,
    })
  }

  /* ------------------------------------------------------------------ */
  /* FC-25 : stale authority fencing (CP5 — real multi-process for DBOS) */
  /* ------------------------------------------------------------------ */

  private async runFC25(info: CandidateInfo): Promise<void> {
    // Per pack gelé §29 + CP6.1 (2026-09-03 v1.1 §9-§12, §28):
    // FC-25 is the zombie owner test. The previous CP6
    // implementation made A release authority before the
    // takeover, which is NOT the contract. The correct scenario:
    //
    //   1. A claims authority at gen=1.
    //   2. A REACHES A FREEZE BARRIER (no release!).
    //   3. The takeover primitive (qualification-only) increments
    //      to gen=2 and assigns a new authority owner.
    //   4. B commits an authoritative mutation under gen=2
    //      (accepted).
    //   5. A resumes and attempts:
    //        - authoritative mutation under gen=1 → REJECTED
    //        - effect dispatch under gen=1 → REJECTED
    //
    // FC-25 PASS requires:
    //   - oldOwnerDidNotReleaseBeforeTakeover = true
    //   - newGeneration > oldGeneration
    //   - newOwnerCommitAccepted = true
    //   - staleOwnerCommitRejected = true
    //   - staleOwnerDispatchRejected = true
    //
    // The current M0 surfaces only stale-claim rejection (gen
    // comparison), not the full atomic-mutation + dispatch
    // fencing. The runner reclassifies FC-25 to NOT_VALID for
    // both candidates until the takeover + freeze-barrier
    // scenario is implemented end-to-end.
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-25")
    const isChildProcess =
      info.process.topology === "child-process" || info.process.topology === "sidecar" || info.process.topology === "remote"

    const observations: Record<string, unknown> = {
      measured: false,
      reason: isChildProcess
        ? "FC-25 requires a takeover scenario (A claims → A FREEZES (no release) → takeover → B commits → A resumes → A's stale authoritative commit + dispatch REJECTED). The previous CP6 implementation only proved that a stale claim is rejected, not that a stale AUTHORITATIVE MUTATION or DISPATCH is rejected. Per pack gelé §12, stale-claim rejection is a conformance test, not FC-25. FC-25 is NOT_VALID until the runner drives the full takeover scenario end-to-end with atomic check-and-mutate in the SAME transaction."
        : "FC-25 requires two real OS processes; the in-process M0 qualification cannot exercise it. A multi-process Native test is the unblock path.",
      requiredMethodology: "(1) A claims gen=1. (2) A reaches FREEZE_BARRIER while holding its local token. (3) Takeover primitive increments gen=2, new owner B. (4) B commits authoritative mutation via /authority/mutate with (gen=2, ownerB) — accepted. (5) A resumes and calls /authority/mutate with (gen=1, ownerA) — REJECTED. (6) A calls /authority/dispatch with (gen=1, ownerA) — REJECTED. (7) PASS only if all five assertions hold.",
      unblockPath: "Implement the takeover scenario in the runner. A must reach a freeze barrier via IPC (not SIGSTOP — the harness must be portable). Takeover is /authority/takeover (already implemented in the Go binary).",
      previousCp5Evidence: "evidence/<candidate>/FC-25/previous-cp5-generation-primitive.json",
      passConditions: {
        oldOwnerDidNotReleaseBeforeTakeover: "MUST=true",
        newGenerationGreaterThanOld: "MUST=true",
        newOwnerCommitAccepted: "MUST=true",
        staleOwnerCommitRejected: "MUST=true",
        staleOwnerDispatchRejected: "MUST=true",
      },
    }
    // Preserve the previous CP5/CP6 evidence.
    try {
      const fs = await import("node:fs/promises")
      const oldEvidence = `${folder}/result.json`
      const preserved = `${folder}/previous-cp5-generation-primitive.json`
      const content = await fs.readFile(oldEvidence, "utf8")
      await fs.writeFile(preserved, content, "utf8")
    } catch { /* noop */ }
    const evidence = await writeEvidence(folder, "result.json", {
      status: "NOT_VALID",
      observations,
      note: isChildProcess
        ? "FC-25 NOT_VALID for CUSTOM_GO_SQLITE_CONTROL: the previous CP6 scenario made A release authority before the takeover, which does not match the contract (pack gelé §9). Stale-claim rejection alone is not FC-25. Reclassified to NOT_VALID."
        : "FC-25 NOT_VALID for Native: in-process methodology only. Multi-process Native test is the unblock path.",
    })
    this.builder.record({
      testId: "FC-25",
      status: "NOT_VALID",
      evidencePath: evidence,
      note: isChildProcess
        ? "FC-25 NOT_VALID per pack gelé §9: the contract requires A to freeze WITHOUT releasing, then a takeover, then B commits under the new gen, then A's stale commit + dispatch are rejected. The previous CP6 scenario released authority before the takeover — that is the wrong scenario. Reclassified."
        : "FC-25 NOT_VALID for Native: in-process methodology only.",
      observations,
    })
  }

  /* ------------------------------------------------------------------ */
  /* FC-32 : replay model declaration                                    */
  /* ------------------------------------------------------------------ */

  private async runFC32(info: CandidateInfo): Promise<void> {
    // Per pack gelé review 2026-09-03 v1.1 §13-§16: declaring a
    // `replayModel` value is NOT a proof of FC-32. PASS requires a
    // real T1/R1/O1 → crash → T2/R2/O2 controlled-recovery
    // scenario where the harness observes what the candidate
    // actually does. The M0 surface (startRun / driveAttempt)
    // does not exercise a workflow function, so the replay model
    // cannot be MEASURED here.
    //
    // The result is therefore NOT_VALID for both candidates until
    // a real replay-scenario FC-32 is implemented (out of M0
    // scope per the pack gelé).
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-32")
    {
      const isChildProcess =
        info.process.topology === "child-process" || info.process.topology === "sidecar" || info.process.topology === "remote"
      const observations = {
        measured: false,
        reason: "FC-32 is NOT_VALID until a real T1/R1/O1 → crash → T2/R2/O2 replay scenario is implemented. The M0 surface (startRun + driveAttempt) does not exercise a workflow function through the candidate, so the harness cannot measure replay behavior. Declaring a replayModel value (NO / PARTIAL) is not admissible as PASS — see pack gelé §13: 'measured = false => status != PASS'.",
        expectedFromUpstream: isChildProcess ? "YES (DBOS Conductor requires deterministic orchestration)" : "N/A",
        requiredMethodology: "(1) Drive a workflow function in the candidate's host language/runtime that records T1, R1, O1 observations. (2) Crash the candidate's authority mid-workflow. (3) Reopen on the same durable store. (4) Observe which orchestration code re-runs, which observations are replayed, which EffectKeys remain identical, and which effects are re-issued. (5) Declare REQUIRES_DETERMINISTIC_ORCHESTRATION = YES | NO | PARTIAL with measured=true.",
      }
      const evidence = await writeEvidence(folder, "result.json", observations)
      this.builder.record({
        testId: "FC-32",
        status: "NOT_VALID",
        evidencePath: evidence,
        note: "FC-32 NOT_VALID: replay model is declared, not measured. The M0 surface does not drive a workflow function; the harness cannot observe what the candidate replays. To unblock: implement a controlled recovery scenario (T1/R1/O1 → crash → T2/R2/O2) that exercises the candidate's actual orchestration code. See observations.requiredMethodology.",
        observations,
      })
    }
  }

  /* ------------------------------------------------------------------ */
  /* FC-13-CTRL : power-loss negative control (BLOCKED, no methodology) */
  /* ------------------------------------------------------------------ */

  private async runFC13CTRL(info: CandidateInfo): Promise<void> {
    // FC-13-CTRL is the negative control for FC-13 (power-loss
    // durability). It must:
    //   1. Configure a deliberately NON-durable write
    //   2. Trigger power-loss / storage fault
    //   3. Verify the write is lost (the negative control must lose)
    // If the negative control does not lose, FC-13 = NOT_VALID.
    //
    // Per correction pack 2026-09-03 v1.1 §2: when the methodology
    // is not available, the outcome is BLOCKED, not NOT_VALID.
    // NOT_VALID means the methodology ran and failed to measure
    // what it should. BLOCKED means no methodology is available.
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-13-CTRL")
    const observations = {
      blockedReason: "NO_METHODOLOGY",
      detail: "No power-loss / fault-injection layer available in this harness host. Validated options that are NOT available: (1) VM with virtual disk + abrupt ACPI off, (2) `scsi_debug` / `fault-inject` / `fltmc`, (3) `dm-thin` suspend/resume, (4) block-device fault layer. `kill -9` and `process.kill()` are NOT acceptable — they prove process crash, not power-loss. To unblock: provision a disposable VM with virtual disk + scripted power-cycle, or a fault-injection layer; produce scripts + docs; rerun FC-13-CTRL.",
      requiredMethodology: "configure non-durable write + abrupt power-off + verify loss + verify FC-13 PASS on durable write under same fault",
      nextActionOwner: "Erwan (env admin) OR a future VM-equipped agent session",
    }
    const evidence = await writeEvidence(folder, "result.json", {
      status: "BLOCKED",
      blockedKind: "NO_METHODOLOGY",
      observations,
      note: blockedNote("NO_METHODOLOGY", observations.detail),
    })
    this.builder.record({
      testId: "FC-13-CTRL",
      status: "BLOCKED",
      evidencePath: evidence,
      note: blockedNote("NO_METHODOLOGY", observations.detail),
      observations,
    })
  }

  /* ------------------------------------------------------------------ */
  /* FC-13 : power-loss / storage fault (BLOCKED, no methodology)        */
  /* ------------------------------------------------------------------ */

  private async runFC13(info: CandidateInfo): Promise<void> {
    // FC-13 measures whether durable writes survive a real power-loss
    // event. Per pack gelé §13, simple `kill -9` is NOT acceptable.
    // Per correction pack v1.1 §2, when the methodology is not
    // available, the outcome is BLOCKED.
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-13")
    const observations = {
      blockedReason: "NO_METHODOLOGY",
      detail: "FC-13 cannot be exercised: no fault-injection layer / VM control / reproducible storage fault. FC-13 depends on FC-13-CTRL first (negative control must lose) — if FC-13-CTRL is not executable, FC-13 cannot yield a valid result either. Both are BLOCKED in the same M0 env.",
      requiredMethodology: "(1) Configure a SQLite write with synchronous=FULL + WAL + checkpoint. (2) Trigger abrupt power-off / storage fault. (3) Reopen store. (4) Verify the write is durably present. Compare against FC-13-CTRL (which must lose).",
      fc13CtrlStatus: "BLOCKED (NO_METHODOLOGY) — see FC-13-CTRL record",
      nextActionOwner: "Erwan (env admin) OR a future VM-equipped agent session",
    }
    const evidence = await writeEvidence(folder, "result.json", {
      status: "BLOCKED",
      blockedKind: "NO_METHODOLOGY",
      observations,
      note: blockedNote("NO_METHODOLOGY", observations.detail),
    })
    this.builder.record({
      testId: "FC-13",
      status: "BLOCKED",
      evidencePath: evidence,
      note: blockedNote("NO_METHODOLOGY", observations.detail),
      observations,
    })
  }
}
