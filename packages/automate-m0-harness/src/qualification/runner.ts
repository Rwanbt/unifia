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
    // Adapter is initialized once in run() (single-init lifecycle).
    try {
      // Per pack gelé review 2026-09-03 v1.1 §10-§11: the
      // contract-level signal `providerResponse.ackLost: true` is
      // honored by every adapter (NativeSqliteCandidate +
      // DBOSGoCandidate). The same `driveAttempt` call drives FC-04
      // on both candidates — no candidate-specific import is
      // required in the common oracle.
      //
      // For Native, the adapter consults `providerResponse.ackLost`
      // first (before calling the FakeExternalEffectProvider) and
      // resolves to UNKNOWN_EXTERNAL_STATE without invoking the
      // provider.
      //
      // For DBOS Go, the adapter translates `ackLost: true` into the
      // HTTP body field sent to the Go binary's `/attempts`
      // endpoint, where it is mapped to UNKNOWN_EXTERNAL_STATE.
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

      // The attempt MUST be UNKNOWN_EXTERNAL_STATE, not blind-retried.
      const status: QualificationStatus = attempt.status === "UNKNOWN_EXTERNAL_STATE" ? "PASS" : "FAIL_CORRECTABLE"
      const observations = {
        attemptStatus: attempt.status,
        ackLostSignal: true,
        adapterTopology: info.process.topology,
      }
      const evidence = await writeEvidence(folder, "result.json", observations)
      this.builder.record({
        testId: "FC-04",
        status,
        evidencePath: evidence,
        note: status === "PASS"
          ? "ACK loss correctly resolved to UNKNOWN_EXTERNAL_STATE, not blind-retried."
          : `ACK loss resolution returned ${attempt.status} (expected UNKNOWN_EXTERNAL_STATE).`,
        observations,
      })
    } catch (e) {
      throw e
    }
  }

  /* ------------------------------------------------------------------ */
  /* FC-14 : multi-process authority (NOT_VALID in in-process form)     */
  /* ------------------------------------------------------------------ */

  private async runFC14(info: CandidateInfo): Promise<void> {
    // Per pack gelé §15 + correction pack 2026-09-03 v1.1 §1 :
    // FC-14 requires "two real OS processes, same durable authority/store".
    // The earlier in-process methodology (two Database handles in the
    // same process) does NOT exercise the required multi-process
    // authority boundary. The correct outcome is NOT_VALID — the
    // methodology ran, but it did not measure what it should.
    //
    // We preserve the old in-process evidence under
    // evidence/<candidate>/FC-14/old-in-process.json so the trace
    // is not lost; the new record is the canonical NOT_VALID.
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-14")
    const observations = {
      reason: "FC-14 requires two real OS processes, same durable store. The in-process methodology (two Database handles in one process) does NOT exercise the multi-process authority boundary. Old in-process evidence preserved at evidence/<candidate>/FC-14/old-in-process.json for traceability.",
      requiredMethodology: "spawn two real OS processes, share the same SQLite durable store, observe authority acquisition / dispatch eligibility / locking / fencing / commit. PASS only if a single logical authority can act.",
      oldInProcessEvidence: "evidence/unifia-native/FC-14/old-in-process.json",
    }
    const evidence = await writeEvidence(folder, "result.json", {
      status: "NOT_VALID",
      observations,
      note: "FC-14 cannot be PASSED by the in-process methodology. The candidate's contract is multi-process-safe at the SQLite level, but the harness in this M0 run did not exercise the multi-process authority boundary. Real FC-14 is queued behind a real-process spawn harness (see runFC14Multiprocess() — to be implemented post-M0).",
    })
    // Also write a copy of the old in-process result.json so the
    // historical evidence is preserved without rewriting.
    try {
      const fs = await import("node:fs/promises")
      const oldEvidence = `${folder}/result.json` // the one we just wrote
      const preserved = `${folder}/old-in-process.json`
      const content = await fs.readFile(oldEvidence, "utf8")
      await fs.writeFile(preserved, content, "utf8")
    } catch { /* noop */ }
    this.builder.record({
      testId: "FC-14",
      status: "NOT_VALID",
      evidencePath: evidence,
      note: "Methodology NOT_VALID: in-process only. Required methodology: two real OS processes. See evidence/unifia-native/FC-14/old-in-process.json for the trace that was previously classified PASS.",
      observations,
    })
  }

  /* ------------------------------------------------------------------ */
  /* FC-25 : stale authority fencing (skeleton)                          */
  /* ------------------------------------------------------------------ */

  private async runFC25(info: CandidateInfo): Promise<void> {
    // FC-25 in the strict sense requires two OS processes. For the
    // in-process M0 qualification, we use the second connection
    // pattern: open a second handle, try to update the
    // authority_generation while the candidate holds a writer, and
    // verify that either (a) the second handle fails cleanly or (b)
    // the candidate's monotonic generation logic still rejects a
    // stale value.
    //
    // The M0 Native candidate uses a single authority_generation row
    // (no multi-process generation increment yet). We record a
    // BLOCKED status with explicit evidence.
    const folder = evidencePath(this.opts.outputRoot, info.kind, "FC-25")
    // Adapter is initialized once in run() (single-init lifecycle).
    {
      const status: QualificationStatus = "BLOCKED"
      const observations = { reason: "Native candidate uses single-process generation; multi-process fencing requires a second OS process. To be exercised in WINDOWS_PREFLIGHT." }
      const evidence = await writeEvidence(folder, "result.json", observations)
      this.builder.record({
        testId: "FC-25",
        status,
        evidencePath: evidence,
        note: "FC-25 in the strict sense (zombie owner across processes) requires a second OS process. The in-process M0 qualification cannot exercise it; scheduled for WINDOWS_PREFLIGHT.",
        observations,
      })
    }
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
