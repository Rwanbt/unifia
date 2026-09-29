// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// parity:g0-mode:derive — applies the rules in parity/g0-derivation-policy.json
// to the current lock state and prints the derived G0 mode. Used by
// parity:checkpoint:lint and the S3/S15 orchestrator.

import { execSync } from "node:child_process"
import { readJson, writeArtifact, REPO_ROOT } from "./shared"
import { join } from "node:path"

type Derivation = {
  if: string
  mode: "G0_BOOTSTRAP" | "G0_PILOT" | "G0_TOOL_CHANGE" | "G0_FULL" | "INVALID_G0_STATE"
  qualifying: boolean
}

type DerivationPolicy = {
  variables: Record<string, string | null>
  derivation: Derivation[]
  initialState: string
}

const policy = readJson<DerivationPolicy>(join(REPO_ROOT, "parity", "g0-derivation-policy.json"))

function exec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf8" }).trim()
  } catch {
    return null
  }
}

const branch = exec("git branch --show-current")
const localHead = exec("git rev-parse HEAD")
const remoteHead = exec("git rev-parse origin/new-ui")
const dirty = exec("git status --short")
const diverged = localHead !== null && remoteHead !== null && localHead !== remoteHead

const variables = {
  ...policy.variables,
  branch,
  localHead,
  remoteHead,
  diverged,
  workingTreeDirty: dirty !== null && dirty.length > 0,
}

const mode = policy.initialState
const notes: string[] = []
const qualifying = false
const eligible = (m: string): boolean => {
  if (m === "G0_BOOTSTRAP") return false
  if (m === "G0_PILOT") return policy.variables.pilotContractLockHash !== null
  if (m === "G0_TOOL_CHANGE") return false
  if (m === "G0_FULL") return policy.variables.fullContractLockHash !== null
  return false
}

if (branch !== "new-ui") notes.push(`branch=${branch} — must be new-ui`)
if (diverged) notes.push("local HEAD and origin/new-ui have diverged — REMOTE_DIVERGENCE")

const result = {
  mode,
  qualifying,
  eligible: eligible(mode),
  variables,
  notes,
  derivedAt: new Date().toISOString(),
}

writeArtifact("g0-mode.json", result)
process.stdout.write(JSON.stringify(result, null, 2) + "\n")
process.exit(mode === "INVALID_G0_STATE" ? 1 : 0)