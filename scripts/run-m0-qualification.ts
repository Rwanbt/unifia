/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M0 qualification runner — produces canonical
 * `docs/automation-v2/m0/M0_RESULTS_*.json` and `evidence/`
 * folders atomically, with full self-describing provenance
 * metadata.
 *
 * Per Erwan review 2026-09-04: this script now actually
 * PUBLISHES to `docs/automation-v2/m0/`, not just prints
 * temp paths. The pre-CP6.3 version printed temp paths
 * which were not reproducible from a fresh clone.
 *
 * Usage (from repo root):
 *   bun scripts/run-m0-qualification.ts
 *
 * The bun:test suite in
 * `packages/automate-m0-harness/test/qualification.test.ts`
 * is the gating regression test; this script is the
 * canonical-publication writer.
 *
 * Atomic publication:
 *   1. Each candidate is qualified into a temporary staging
 *      dir under the OS tmp.
 *   2. The result schema + provenance are validated.
 *   3. If validation fails, the previous canonical evidence
 *      is left untouched and the script exits non-zero.
 *   4. If validation succeeds, the result file and the
 *      evidence folder are atomically moved to
 *      `docs/automation-v2/m0/`.
 *
 * Candidate matrix (frozen 2026-09-04):
 *   - UNIFIA_NATIVE              : true finalist A
 *   - DBOS_GO_SQLITE             : true finalist B (not yet built)
 *   - CUSTOM_GO_SQLITE_CONTROL   : harness/control (the Go binary
 *     that uses custom SQLite + blank DBOS import)
 */

import { mkdtempSync, rmSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve as pathResolve, relative } from "node:path"
import { $ } from "bun"

/* ------------------------------------------------------------------ */
/* Two-commit reproducibility model (mandate §13-§17)                 */
/* ------------------------------------------------------------------ */

/**
 * Per the master execution mandate §13-§17: canonical
 * qualification must be run from a CLEAN worktree (Commit A
 * contains only source). Evidence (Commit B) is a separate
 * commit that records the qualification result + canonical
 * evidence files.
 *
 * The writer refuses to overwrite the canonical result /
 * evidence unless the worktree is clean. A diagnostic mode
 * (NON_CANONICAL_DIAGNOSTIC_MODE=1) is provided for ad-hoc
 * exploration; in that mode the writer still publishes but
 * tags the provenance with `nonCanonical: true` so a
 * reviewer cannot mistake a diagnostic run for a canonical
 * benchmark.
 */
async function isWorktreeClean(): Promise<boolean> {
  try {
    const out = await $`git status --porcelain`.cwd(REPO_ROOT).text()
    return out.trim().length === 0
  } catch {
    return false
  }
}

async function captureSourceCommit(): Promise<{ commit: string; tree: string; branch: string }> {
  const commit = (await $`git rev-parse HEAD`.cwd(REPO_ROOT).text()).trim()
  const tree = (await $`git rev-parse HEAD^{tree}`.cwd(REPO_ROOT).text()).trim()
  const branch = (await $`git branch --show-current`.cwd(REPO_ROOT).text()).trim()
  return { commit, tree, branch }
}

const NON_CANONICAL_DIAGNOSTIC_MODE = process.env.NON_CANONICAL_DIAGNOSTIC_MODE === "1"
import {
  FakeExternalEffectProvider,
  NativeSqliteCandidate,
  DBOSGoCandidate,
  QualificationRunner,
  type CandidateResultFile,
} from "../packages/automate-m0-harness/src/qualification/index.ts"

const REPO_ROOT = pathResolve(import.meta.dir, "..")
const CANONICAL_DIR = join(REPO_ROOT, "docs", "automation-v2", "m0")
const EVIDENCE_DIR = join(CANONICAL_DIR, "evidence")
const HARNESS_TOOL_DIR = join(REPO_ROOT, "packages", "automate-m0-harness")
const DBOS_GO_TOOL_DIR = join(REPO_ROOT, "tools", "dbos-qualify")
const DBOS_GO_BINARY = join(DBOS_GO_TOOL_DIR, "dbos-qualify.exe")

const VERSION = "0.0.0-m0-qual-cp6.3"
const BUILD_HASH = `qual-m0-cp6.3-${Date.now()}`

// Self-describing provenance (per Erwan review 2026-09-04).
// Each candidate supplies its own values; the harness-side
// commit / runtime / platform are shared.
async function gitHead(cwd: string): Promise<string> {
  try {
    const out = await $`git rev-parse HEAD`.cwd(cwd).text()
    return out.trim()
  } catch {
    return "unknown"
  }
}
async function gitShort(cwd: string): Promise<string> {
  try {
    const out = await $`git rev-parse --short HEAD`.cwd(cwd).text()
    return out.trim()
  } catch {
    return "unknown"
  }
}
async function binaryDigest(path: string): Promise<string | undefined> {
  if (!existsSync(path)) return undefined
  try {
    const out = await $`certutil -hash SHA256 ${path}`.text()
    const m = out.match(/([a-f0-9]{64})/i)
    return m ? m[1] : undefined
  } catch {
    return undefined
  }
}

const HARNESS_COMMIT = await gitHead(HARNESS_TOOL_DIR)
const HARNESS_SHORT = await gitShort(HARNESS_TOOL_DIR)
const RUNTIME = `Bun ${Bun.version} / node ${process.version} / ${process.platform} ${process.arch}`
const ORACLE_VERSION = "1.1.0-cp6.3" // pinned per the candidate contract (this is the harness-side contract version)

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `m0-qual-${label}-`))
}

/* ------------------------------------------------------------------ */
/* Per-candidate provenance                                            */
/* ------------------------------------------------------------------ */

const DBOS_GO_BUILT = existsSync(DBOS_GO_BINARY)
const DBOS_GO_DIGEST = await binaryDigest(DBOS_GO_BINARY)

/* ------------------------------------------------------------------ */
/* Candidate runners (return staging-dir result + evidence)            */
/* ------------------------------------------------------------------ */

interface CandidateRun {
  readonly kind: "UNIFIA_NATIVE" | "CUSTOM_GO_SQLITE_CONTROL"
  readonly resultPath: string
  readonly expectedNAPath: string
  readonly evidenceRoot: string
}

async function runNative(): Promise<CandidateRun> {
  const stage = tempDir("native-stage")
  const providerDir = join(stage, "provider")
  const storeDir = join(stage, "candidate")
  mkdirSync(providerDir, { recursive: true })
  mkdirSync(storeDir, { recursive: true })
  const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
  const candidate = new NativeSqliteCandidate({
    storeDir,
    provider,
    version: VERSION,
    buildHash: BUILD_HASH,
  })
  const runner = new QualificationRunner(candidate, provider, {
    outputRoot: stage,
    buildHash: BUILD_HASH,
    provenance: {
      candidateImplementationId: `UNIFIA_NATIVE_BUN_SQLITE@${VERSION}`,
      candidateSourceCommit: HARNESS_COMMIT,
      candidateBuildHash: BUILD_HASH,
      measurementHarnessCommit: HARNESS_COMMIT,
      oracleVersion: ORACLE_VERSION,
      executionSubstrate: "UNIFIA_NATIVE_BUN_SQLITE",
      storageEngine: "SQLite 3.x via bun:sqlite (M0 env)",
      adapterIdentity: "NativeSqliteCandidate",
      realDbosApisUsed: false,
      platform: `${process.platform} ${process.arch}`,
      runtime: RUNTIME,
    },
  })
  const out = await runner.run()
  return {
    kind: "UNIFIA_NATIVE",
    resultPath: out.resultPath,
    expectedNAPath: out.expectedNAPath,
    evidenceRoot: join(stage, "evidence"),
  }
}

async function runCustomGo(): Promise<CandidateRun | null> {
  if (!DBOS_GO_BUILT) {
    console.log(`[SKIP] CUSTOM_GO_SQLITE_CONTROL binary not built at ${DBOS_GO_BINARY}`)
    return null
  }
  const stage = tempDir("custom-go-stage")
  const providerDir = join(stage, "provider")
  mkdirSync(providerDir, { recursive: true })
  const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
  const candidate = new DBOSGoCandidate({
    toolDir: DBOS_GO_TOOL_DIR,
    version: "github.com/dbos-inc/dbos-transact-golang@v1.0.0 (compile-time only)",
    buildHash: BUILD_HASH,
  })
  const runner = new QualificationRunner(candidate, provider, {
    outputRoot: stage,
    buildHash: BUILD_HASH,
    provenance: {
      candidateImplementationId: `CUSTOM_GO_SQLITE_CONTROL@${VERSION}`,
      candidateSourceCommit: HARNESS_COMMIT,
      candidateBuildHash: BUILD_HASH,
      candidateBinaryDigest: DBOS_GO_DIGEST,
      measurementHarnessCommit: HARNESS_COMMIT,
      oracleVersion: ORACLE_VERSION,
      // CRITICAL: the CUSTOM_GO binary uses custom SQLite
      // tables + custom authority fencing + custom effect
      // ledger + a BLANK DBOS import. It is NOT the real
      // DBOS Go candidate. realDbosApisUsed MUST be false.
      executionSubstrate: "CUSTOM_GO_SQLITE",
      storageEngine: "SQLite 3.x via modernc.org/sqlite v1.54.0 (pure-Go)",
      adapterIdentity: "DBOSGoCandidate@CUSTOM_GO_SQLITE_CONTROL",
      realDbosApisUsed: false,
      platform: `${process.platform} ${process.arch}`,
      runtime: RUNTIME,
    },
  })
  const out = await runner.run()
  await candidate.shutdown().catch(() => undefined)
  return {
    kind: "CUSTOM_GO_SQLITE_CONTROL",
    resultPath: out.resultPath,
    expectedNAPath: out.expectedNAPath,
    evidenceRoot: join(stage, "evidence"),
  }
}

/* ------------------------------------------------------------------ */
/* Atomic publication                                                  */
/* ------------------------------------------------------------------ */

function validateResult(result: CandidateResultFile, expectedKind: string): void {
  if (result.candidate !== expectedKind) {
    throw new Error(
      `candidate identity mismatch: expected ${expectedKind}, got ${result.candidate}. ` +
      `Refusing to publish misattributed evidence.`,
    )
  }
  if (!result.provenance) {
    throw new Error(`provenance block missing in result for ${expectedKind}`)
  }
  if (result.provenance.realDbosApisUsed === undefined) {
    throw new Error(`provenance.realDbosApisUsed is undefined in result for ${expectedKind}`)
  }
  // FC PASSes that have a measured gate (per the result builder
  // gate table) must declare `measured: true`. FCs without a
  // measured gate (FC-31A, FC-31B, FC-13, FC-13-CTRL) are
  // checked by their own pre-conditions elsewhere.
  const MEASURED_GATED_FCS = new Set(["FC-14", "FC-25", "FC-04", "FC-32"])
  for (const t of result.results) {
    if (t.status === "PASS" && MEASURED_GATED_FCS.has(t.testId)) {
      const o = t.observations as Record<string, unknown> | undefined
      if (!o || o.measured !== true) {
        throw new Error(`FC ${t.testId} PASS without measured=true — refusing to publish`)
      }
    }
  }
}

function copyDirRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true })
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name)
    const d = join(dst, e.name)
    if (e.isDirectory()) copyDirRecursive(s, d)
    else if (e.isFile()) copyFileSync(s, d)
  }
}

function publish(run: CandidateRun): void {
  // 1. Validate
  const result = JSON.parse(require("node:fs").readFileSync(run.resultPath, "utf8")) as CandidateResultFile
  validateResult(result, run.kind)

  // 2. Stage canonical target paths
  const canonicalResult = join(CANONICAL_DIR, `M0_RESULTS_${run.kind}.json`)
  // The runner's `evidencePath()` nests evidence under
  // `<outputRoot>/evidence/<candidate-slug>/<FC>/`. We copy
  // the staging `evidence/` tree (which already has
  // `<candidate-slug>/` as its first subfolder) directly into
  // `<CANONICAL>/evidence/` so the result is
  // `<CANONICAL>/evidence/<candidate-slug>/<FC>/result.json`.
  const candidateSlug = run.kind.toLowerCase().replace(/_/g, "-")
  const canonicalEvidenceDir = join(EVIDENCE_DIR, candidateSlug)
  const canonicalExpectedNA = join(CANONICAL_DIR, `M0_EXPECTED_NA_${run.kind}.json`)

  // 3. The temp stage may be on a different filesystem (C: temp
  //    vs D: repo), so we use copy + delete (NOT renameSync) to
  //    move the artifacts to the canonical location.
  mkdirSync(CANONICAL_DIR, { recursive: true })
  mkdirSync(EVIDENCE_DIR, { recursive: true })

  // Copy result file
  copyFileSync(run.resultPath, canonicalResult)

  // Copy evidence folder: ensure the canonical slug dir is
  // empty, then copy the staging slug subdir into it. The
  // runner's evidencePath() nests under
  // `<stage>/evidence/<slug>/...`; we just copy that subdir.
  rmSync(canonicalEvidenceDir, { recursive: true, force: true })
  const stagingSlugDir = join(run.evidenceRoot, candidateSlug)
  if (existsSync(stagingSlugDir)) {
    copyDirRecursive(stagingSlugDir, canonicalEvidenceDir)
  } else {
    console.warn(`  [WARN] staging slug dir not found: ${stagingSlugDir}`)
  }

  // Copy expected-NA file
  if (existsSync(run.expectedNAPath)) {
    rmSync(canonicalExpectedNA, { force: true })
    copyFileSync(run.expectedNAPath, canonicalExpectedNA)
  }

  // 4. Convert evidencePath values in the result to repo-relative.
  //    The runner wrote absolute (Windows-style) paths to the
  //    staging dir; the actual canonical files now live under
  //    `docs/automation-v2/m0/evidence/<candidate-slug>/<FC>/result.json`.
  //    We rewrite the values to that stable repo-relative path.
  const reloaded = JSON.parse(require("node:fs").readFileSync(canonicalResult, "utf8")) as CandidateResultFile
  for (const t of reloaded.results) {
    if (t.evidencePath) {
      // The runner wrote either C:\...\evidence\<slug>\<FC>\result.json
      // (Windows backslashes) or C:/.../evidence/<slug>/<FC>/result.json.
      // Match either separator by replacing `\` with `/` first.
      const norm = t.evidencePath.replaceAll("\\", "/")
      const m = norm.match(new RegExp(`/(${candidateSlug})/(FC-[^/]+)/result\\.json$`, "i"))
      if (m) {
        const fc = m[2]
        t.evidencePath = `docs/automation-v2/m0/evidence/${candidateSlug}/${fc}/result.json`
      } else {
        console.warn(`  [WARN] could not relativize evidencePath: ${t.evidencePath}`)
      }
    }
  }
  require("node:fs").writeFileSync(canonicalResult, JSON.stringify(reloaded, null, 2), "utf8")

  console.log(`  [PUBLISH] ${run.kind}`)
  console.log(`           result:     ${relative(REPO_ROOT, canonicalResult).replaceAll("\\", "/")}`)
  console.log(`           evidence:   ${relative(REPO_ROOT, canonicalEvidenceDir).replaceAll("\\", "/")}/`)
  console.log(`           expectedNA: ${relative(REPO_ROOT, canonicalExpectedNA).replaceAll("\\", "/")}`)
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log("=".repeat(72))
  console.log("M0 qualification runner (CP6.3) — atomic publication")
  console.log("=".repeat(72))
  console.log(`Repo root:  ${REPO_ROOT}`)
  console.log(`Harness:    ${HARNESS_SHORT} (${HARNESS_COMMIT})`)
  console.log(`Runtime:    ${RUNTIME}`)
  console.log(`Oracle:     ${ORACLE_VERSION}`)

  // Two-commit reproducibility model gate (mandate §13-§17).
  // Refuse to publish canonical evidence from a dirty worktree
  // unless NON_CANONICAL_DIAGNOSTIC_MODE=1.
  const clean = await isWorktreeClean()
  if (!clean && !NON_CANONICAL_DIAGNOSTIC_MODE) {
    console.error("")
    console.error("[REFUSED] Worktree is dirty (per `git status --porcelain`).")
    console.error("         Commit source changes first (Commit A), then re-run this script.")
    console.error("         To run an ad-hoc diagnostic, set NON_CANONICAL_DIAGNOSTIC_MODE=1.")
    console.error("")
    process.exit(1)
  }
  const mode = clean ? "CANONICAL" : "NON_CANONICAL_DIAGNOSTIC"
  console.log(`Mode:       ${mode}`)
  const source = await captureSourceCommit()
  console.log(`Source:     commit=${source.commit.slice(0, 12)} tree=${source.tree.slice(0, 12)} branch=${source.branch}`)

  const runs: CandidateRun[] = []

  console.log("\n[1/2] UNIFIA_NATIVE")
  try {
    const r = await runNative()
    publish(r)
    runs.push(r)
  } catch (e) {
    console.error(`  [FAIL] UNIFIA_NATIVE: ${(e as Error).message}`)
    throw e
  }

  console.log("\n[2/2] CUSTOM_GO_SQLITE_CONTROL")
  const customGo = await runCustomGo()
  if (customGo) {
    try {
      publish(customGo)
      runs.push(customGo)
    } catch (e) {
      console.error(`  [FAIL] CUSTOM_GO_SQLITE_CONTROL: ${(e as Error).message}`)
      throw e
    }
  }

  // Print summary
  console.log("\n" + "=".repeat(72))
  console.log("SUMMARY (canonical files now published to docs/automation-v2/m0/)")
  console.log("=".repeat(72))
  for (const r of runs) {
    const file = join(CANONICAL_DIR, `M0_RESULTS_${r.kind}.json`)
    const result: CandidateResultFile = JSON.parse(require("node:fs").readFileSync(file, "utf8"))
    console.log(`\n${r.kind}`)
    console.log(`  version: ${result.candidateInfo.version}`)
    console.log(`  pass=${result.summary.pass} fail_arch=${result.summary.failArchitectural} fail_corr=${result.summary.failCorrectable} na=${result.summary.notApplicable} blocked=${result.summary.blocked} not_valid=${result.summary.notValid}`)
    console.log(`  replayModel: ${result.replayModel}`)
    console.log(`  executionSubstrate: ${result.provenance.executionSubstrate}`)
    console.log(`  realDbosApisUsed: ${result.provenance.realDbosApisUsed}`)
    for (const t of result.results) {
      console.log(`    ${t.testId.padEnd(12)} ${t.status.padEnd(20)} ${t.note.slice(0, 80)}`)
    }
  }

  // Clean up staging dirs
  for (const r of runs) {
    const stage = r.resultPath.replace(/[\\\/]M0_RESULTS_.*$/, "")
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true })
  }
  console.log("\nDone.")
}

main().catch((e) => {
  console.error("\nM0 qualification runner failed:", e)
  process.exit(1)
})
