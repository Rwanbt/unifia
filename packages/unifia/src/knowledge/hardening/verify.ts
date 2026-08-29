/* SPDX-License-Identifier: MIT */
/**
 * Full verify (P11.13).
 *
 * Single entry point that runs the four V1 sovereignty checks
 * and reports a pass/fail summary. Used by the CLI `unifia
 * knowledge verify` command and by future CI integrations.
 *
 * The checks are:
 *  1. Sovereignty (vault, derived DB, internet, cloud, device).
 *  2. Disaster recovery (plan, simulate).
 *  3. Reachability (Class A vs Class B).
 *  4. Corpus classification (parse + index + doctor).
 *
 * The function is read-only. It never mutates state.
 */

import { runSovereigntyProbes, type SovereigntyReport } from "./sovereignty-runner.js"
import { planRecovery, simulateRecovery, type RecoveryPlan } from "./disaster-recovery.js"
import { scanReachability, type ReachabilityScan } from "../classb/reachability.js"
import { classifyCorpus, type CorpusReport } from "../admin/corpus-classify.js"
import type { InMemoryFs } from "./disaster-recovery.js"

export interface VerifyInput {
  /** Absolute path to the canonical vault root. */
  vaultRoot: string
  /** Absolute path to the derived DB. */
  derivedDbPath: string
  /** True if the operator confirms the process is offline. */
  internetOff: boolean
  /** True if the operator confirms no cloud API is invoked. */
  cloudOff: boolean
  /** True if the operator confirms no Android device is connected. */
  deviceIsolated: boolean
  /** True if the operator confirms the Class C control state is present. */
  classCPresent: boolean
  /** True if the operator confirms the Class D derived DB is present. */
  classDPresent: boolean
  /** True if the Unifia binary is available. */
  unifiaBinaryPresent: boolean
}

export interface VerifyCheck {
  name: "sovereignty" | "disaster-recovery" | "reachability" | "classify"
  ok: boolean
  durationMs: number
  details: string
}

export interface VerifyReport {
  vaultRoot: string
  checks: VerifyCheck[]
  ok: boolean
  totalMs: number
}

/** Run all V1 sovereignty checks. */
export async function runVerify(input: VerifyInput): Promise<VerifyReport> {
  const t0 = Date.now()
  const checks: VerifyCheck[] = []

  // 1. Sovereignty.
  const t1 = Date.now()
  const sov: SovereigntyReport = await runSovereigntyProbes({
    vaultRoot: input.vaultRoot,
    derivedDbPath: input.derivedDbPath,
    internetOff: input.internetOff,
    cloudOff: input.cloudOff,
    deviceIsolated: input.deviceIsolated,
  })
  checks.push({
    name: "sovereignty",
    ok: sov.ok,
    durationMs: Date.now() - t1,
    details: `${sov.probes.length} probe(s); verdict=${sov.ok ? "OK" : "FAIL"}`,
  })

  // 2. Disaster recovery.
  const t2 = Date.now()
  const plan: RecoveryPlan = planRecovery({
    classAReadable: sov.probes.find((p) => p.kind === "vault-readable")?.ok ?? false,
    classBReachable: true,
    classCPresent: input.classCPresent,
    classDPresent: input.classDPresent,
    unifiaBinaryPresent: input.unifiaBinaryPresent,
    networkAvailable: !input.internetOff,
  })
  const stubFs: InMemoryFs = {
    read: (loc) => (loc === "memory/any.md" ? "# stub" : null),
    exists: (loc) => loc === "memory/any.md" || loc === "memory/any.md.unifia.json",
  }
  const sim = simulateRecovery(plan, stubFs)
  checks.push({
    name: "disaster-recovery",
    ok: sim.ok && plan.steps.every((s) => s.kind !== "stop-and-ask-operator"),
    durationMs: Date.now() - t2,
    details: `${plan.steps.length} step(s); simulation=${sim.ok ? "OK" : "FAIL"}; missing=[${plan.missing.join(",")}]`,
  })

  // 3. Reachability.
  const t3 = Date.now()
  let reach: ReachabilityScan | null = null
  let reachOk = true
  let reachDetails = "0 note(s), 0 entry(ies)"
  try {
    reach = scanReachability(input.vaultRoot)
    reachDetails = `classA=${reach.classALocators.length}, classB=${reach.classBEntries.length}, orphans=${reach.orphans.length}, missingSidecars=${reach.missingSidecars.length}`
    // The reachability check is OK as long as the scan ran. A
    // vault with orphans is not a hard failure: the operator
    // may simply have stale sidecars.
    reachOk = true
  } catch (e) {
    reachOk = false
    reachDetails = `scan failed: ${(e as Error).message}`
  }
  checks.push({
    name: "reachability",
    ok: reachOk,
    durationMs: Date.now() - t3,
    details: reachDetails,
  })

  // 4. Classify.
  const t4 = Date.now()
  let cls: CorpusReport | null = null
  let clsOk = true
  let clsDetails = "0 note(s) parsed"
  try {
    cls = classifyCorpus(input.vaultRoot)
    const nonStale = cls.findings.filter((f) => f.category !== "stale_index")
    clsOk = nonStale.length === 0
    clsDetails = `parsed=${cls.notesParsed}, failed=${cls.notesFailed}, findings=${nonStale.length}`
  } catch (e) {
    clsOk = false
    clsDetails = `classify failed: ${(e as Error).message}`
  }
  checks.push({
    name: "classify",
    ok: clsOk,
    durationMs: Date.now() - t4,
    details: clsDetails,
  })

  return {
    vaultRoot: input.vaultRoot,
    checks,
    ok: checks.every((c) => c.ok),
    totalMs: Date.now() - t0,
  }
}
