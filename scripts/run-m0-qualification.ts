/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M0 qualification runner — produces canonical
 * `docs/automation-v2/m0/M0_RESULTS_*.json` and `evidence/`
 * folders for both UNIFIA_NATIVE and DBOS_GO_SQLITE.
 *
 * Usage (from repo root):
 *   bun scripts/run-m0-qualification.ts
 *
 * This is the script called from CI / docs/automation-v2 workflow
 * to refresh the canonical M0 evidence. The bun:test suite in
 * `packages/automate-m0-harness/test/qualification.test.ts` is
 * the gating regression test; this script is the production
 * writer.
 *
 * Per pack gelé review 2026-09-03 v1.1 §3 : EXPECTED_NA_*.json
 * contains ONLY NOT_APPLICABLE entries. BLOCKED outcomes are
 * written into M0_RESULTS_*.json by the runner.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve as pathResolve } from "node:path"
import {
  FakeExternalEffectProvider,
  NativeSqliteCandidate,
  DBOSGoCandidate,
  QualificationRunner,
  type CandidateResultFile,
} from "../packages/automate-m0-harness/src/qualification/index.ts"

const REPO_ROOT = pathResolve(import.meta.dir, "..")
const CANONICAL_DIR = join(REPO_ROOT, "docs", "automation-v2", "m0")
const DBOS_GO_TOOL_DIR = join(REPO_ROOT, "tools", "dbos-qualify")
const DBOS_GO_BINARY = join(DBOS_GO_TOOL_DIR, "dbos-qualify.exe")
const DBOS_GO_BUILT = await Bun.file(DBOS_GO_BINARY).exists()

const BUILD_HASH = "qual-m0-2026-09-03-cp4"
const VERSION = "0.0.0-m0-qual-2026-09-03"

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `m0-qual-${label}-`))
}

async function runNative(): Promise<{ resultPath: string; expectedNAPath: string }> {
  const root = tempDir("native")
  const provider = new FakeExternalEffectProvider({ storeDir: join(root, "provider"), dropAckToCandidate: false })
  const candidate = new NativeSqliteCandidate({
    storeDir: join(root, "candidate"),
    provider,
    version: VERSION,
    buildHash: BUILD_HASH,
  })
  const runner = new QualificationRunner(candidate, provider, { outputRoot: root, buildHash: BUILD_HASH })
  const out = await runner.run()
  return out
}

async function runDbosGo(): Promise<{ resultPath: string; expectedNAPath: string } | null> {
  if (!DBOS_GO_BUILT) {
    console.log(`[SKIP] DBOS Go binary not built at ${DBOS_GO_BINARY}`)
    console.log("        Build with: scripts/bootstrap-go.sh && cd tools/dbos-qualify && ../../.tools/go/go1.25.12/bin/go build -buildvcs=false -o dbos-qualify.exe .")
    return null
  }
  const root = tempDir("dbos-go")
  const provider = new FakeExternalEffectProvider({ storeDir: join(root, "provider"), dropAckToCandidate: false })
  const candidate = new DBOSGoCandidate({
    toolDir: DBOS_GO_TOOL_DIR,
    version: "github.com/dbos-inc/dbos-transact-golang@v1.0.0",
    buildHash: BUILD_HASH,
  })
  const runner = new QualificationRunner(candidate, provider, { outputRoot: root, buildHash: BUILD_HASH })
  const out = await runner.run()
  await candidate.shutdown().catch(() => undefined)
  return out
}

async function main(): Promise<void> {
  console.log("=".repeat(72))
  console.log("M0 qualification runner (UNIFIA_NATIVE + DBOS_GO_SQLITE)")
  console.log("=".repeat(72))

  // 1. Run Native
  console.log("\n[1/2] UNIFIA_NATIVE")
  const nativeOut = await runNative()
  console.log(`  result: ${nativeOut.resultPath}`)
  console.log(`  expected-NA: ${nativeOut.expectedNAPath}`)

  // 2. Run DBOS Go (if built)
  console.log("\n[2/2] DBOS_GO_SQLITE")
  const dbosOut = await runDbosGo()
  if (dbosOut) {
    console.log(`  result: ${dbosOut.resultPath}`)
    console.log(`  expected-NA: ${dbosOut.expectedNAPath}`)
  }

  // 3. Print summary
  console.log("\n" + "=".repeat(72))
  console.log("SUMMARY")
  console.log("=".repeat(72))
  for (const [label, out] of [["UNIFIA_NATIVE", nativeOut], ["DBOS_GO_SQLITE", dbosOut]] as const) {
    if (!out) continue
    const r: CandidateResultFile = await Bun.file(out.resultPath).json()
    console.log(`\n${label}`)
    console.log(`  version: ${r.candidateInfo.version}`)
    console.log(`  pass=${r.summary.pass} fail_arch=${r.summary.failArchitectural} fail_corr=${r.summary.failCorrectable} na=${r.summary.notApplicable} blocked=${r.summary.blocked} not_valid=${r.summary.notValid}`)
    console.log(`  replayModel: ${r.replayModel}`)
    for (const t of r.results) {
      console.log(`    ${t.testId.padEnd(12)} ${t.status.padEnd(20)} ${t.note.slice(0, 80)}`)
    }
  }
}

main().catch((e) => {
  console.error("M0 qualification runner failed:", e)
  process.exit(1)
})
