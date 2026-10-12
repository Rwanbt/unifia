// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// One-shot helper: fills the real sha-256 hashes for the policies, schemas,
// and toolchain commits into parity/pilot-contract-lock.json. Image digest,
// A/A calibration, A/A prime, font set and the run-time artefact hashes
// stay PENDING-F0 because they require the Docker image + Playwright that
// F0 ships. Run from packages/app:
//
//   bun run scripts/parity/lock-refresh.ts
//
// Lock-only discipline per the consolidated plan §22 and §31: the script
// writes a new lock file at the same path; the previous commit's lock
// stays in history. This is NOT a self-sign because the file content
// already names planCommit and toolchainCommit as references; the script
// only fills in the hashes it can compute deterministically from the
// repo state.

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { createHash } from "node:crypto"
import { REPO_ROOT, PARITY_DIR, SCHEMAS_DIR, hashFile, hashCanonical, stableStringify } from "./shared"

const lockPath = join(PARITY_DIR, "pilot-contract-lock.json")
const fullLockPath = join(PARITY_DIR, "full-contract-lock.json")


const policyFiles = [
  "environment-lock.json",
  "baseline.json",
  "probe-policy.json",
  "mutation-spec.json",
  "path-classification.json",
  "census-merge-policy.json",
  "generated-paths-policy.json",
  "g0-derivation-policy.json",
  "design-ownership.json",
  "reference-locale-capabilities.json",
  "path-classification-coverage.json",
  "branch-policy-snapshot.json",
  "execution-budget.json",
  "state-policy.json",
  "motion-policy.json",
  "style-profiles.json",
]

const schemaFiles = [
  "environment-lock.schema.json",
  "baseline.schema.json",
  "probe-policy.schema.json",
  "mutation-spec.schema.json",
  "path-classification.schema.json",
  "census-merge-policy.schema.json",
  "generated-paths-policy.schema.json",
  "g0-derivation-policy.schema.json",
  "design-ownership.schema.json",
  "reference-locale-capabilities.schema.json",
  "path-classification-coverage.schema.json",
  "branch-policy-snapshot.schema.json",
  "execution-budget.schema.json",
  "e2e-skip-baseline.schema.json",
  "parity-run.schema.json",
  "parity-result.schema.json",
  "contract-lock.schema.json",
  "aa-calibration.schema.json",
  "manifest.schema.json",
  "state-policy.schema.json",
  "motion-policy.schema.json",
  "style-profiles.schema.json",
  "mask-policy.schema.json",
]

type LockFile = {
  planCommit: string
  toolchainCommit: string
  environmentLockHash: string
  aaCalibrationHash: string
  aaPrimeHash: string
  policyHashes: Record<string, string>
  schemaHashes: Record<string, string>
  mutationSpecHash: string
  censusMergePolicyHash: string
  pathClassificationHash: string
}

const lockText = ifPresent(() => readFileSync(lockPath, "utf8"))
if (lockText === undefined) {
  process.stderr.write(`missing file: ${lockPath}\n`)
  process.exit(1)
}
const lock = JSON.parse(lockText) as LockFile

// A file that is absent is skipped; the read itself reports it, so there is no
// separate existence check for the file to change underneath.
function ifPresent(read: () => string): string | undefined {
  try {
    return read()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function hashCanonicalJson(path: string): string | undefined {
  return ifPresent(() => hashCanonical(JSON.parse(readFileSync(path, "utf8"))))
}

function hashFileIfPresent(path: string): string | undefined {
  return ifPresent(() => hashFile(path))
}

function fillHashes(target: { policyHashes: Record<string, string>; schemaHashes: Record<string, string> } & Record<string, unknown>) {
  for (const policy of policyFiles) {
    const digest = hashCanonicalJson(join(PARITY_DIR, policy))
    if (digest !== undefined) target.policyHashes[policy] = digest
  }
  for (const schema of schemaFiles) {
    const digest = hashFileIfPresent(join(SCHEMAS_DIR, schema))
    if (digest !== undefined) target.schemaHashes[schema] = digest
  }
  const named: Array<[string, string]> = [
    ["mutationSpecHash", "mutation-spec.json"],
    ["censusMergePolicyHash", "census-merge-policy.json"],
    ["pathClassificationHash", "path-classification.json"],
    ["environmentLockHash", "environment-lock.json"],
  ]
  for (const [key, file] of named) {
    const digest = hashCanonicalJson(join(PARITY_DIR, file))
    if (digest !== undefined) target[key] = digest
  }
}

fillHashes(lock)

writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n")

type FullLockFile = {
  planCommit: string
  policyHashes: Record<string, string>
  schemaHashes: Record<string, string>
  environmentLockHash: string
  mutationSpecHash: string
  censusMergePolicyHash: string
  pathClassificationHash: string
}

let fullSummary: Record<string, unknown> = {}
const fullLockText = ifPresent(() => readFileSync(fullLockPath, "utf8"))
if (fullLockText !== undefined) {
  const full = JSON.parse(fullLockText) as FullLockFile
  fillHashes(full)
  writeFileSync(fullLockPath, JSON.stringify(full, null, 2) + "\n")
  fullSummary = {
    fullPolicyCount: Object.keys(full.policyHashes).length,
    fullSchemaCount: Object.keys(full.schemaHashes).length,
    fullEnvironmentLockHash: full.environmentLockHash,
  }
}

const written = JSON.parse(readFileSync(lockPath, "utf8")) as LockFile
const summary = {
  status: "REFRESH_OK",
  planCommit: written.planCommit,
  toolchainCommit: written.toolchainCommit,
  environmentLockHash: written.environmentLockHash,
  policyCount: Object.keys(written.policyHashes).length,
  schemaCount: Object.keys(written.schemaHashes).length,
  pending: {
    aaCalibrationHash: written.aaCalibrationHash,
    aaPrimeHash: written.aaPrimeHash,
  },
  full: fullSummary,
  refreshCommand: "bun run --cwd packages/app parity:lock:refresh",
}

process.stdout.write(JSON.stringify(summary, null, 2) + "\n")