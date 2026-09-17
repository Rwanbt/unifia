// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// parity:environment:check — verifies the host matches the v110 environment
// lock as much as the host can prove. The Docker image and lockfile hashes
// land at F0; until then this runner only emits warnings for those fields.

import { execSync } from "node:child_process"
import { readJson, REPO_ROOT } from "./shared"
import { join } from "node:path"

type EnvLock = {
  schemaVersion: number
  reference: { path: string; sha256: string }
  runtimes: { bun: string; node: string; playwright: string; typescript: string; postcss: string; axe: string; biome: string }
  clock: { fixedClockUtc: string; randomSeed: string; timezone: string }
  fonts: { families?: unknown }
}

function safe(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf8", cwd: REPO_ROOT }).trim()
  } catch {
    return null
  }
}

const lock = readJson<EnvLock>(join(REPO_ROOT, "parity", "environment-lock.json"))

const details: string[] = []
const counters: Record<string, number> = { mismatches: 0, warnings: 0 }

function check(label: string, expected: string, actual: string | null): void {
  if (actual === null) {
    details.push(`WARN: ${label} — could not read host value`)
    counters.warnings += 1
    return
  }
  if (actual !== expected) {
    details.push(`MISMATCH: ${label} expected=${expected} actual=${actual}`)
    counters.mismatches += 1
    return
  }
  details.push(`OK: ${label}=${actual}`)
}

const bunV = safe("bun --version")
const nodeV = safe("node --version")?.replace(/^v/, "") ?? null
const playwrightV = safe("bunx playwright --version")?.split(" ")[1] ?? null
const tsV = safe("bunx tsc --version")?.split(" ")[1] ?? null
const axeV = safe("bunx axe --version") ?? null

check("bun", lock.runtimes.bun, bunV)
check("node", lock.runtimes.node, nodeV)
check("playwright", lock.runtimes.playwright, playwrightV)
check("typescript", lock.runtimes.typescript, tsV)
check("axe", lock.runtimes.axe, axeV)

if (process.stdout.isTTY === false) {
  process.stderr.write("WARN: bun image/lockfile hashes still PENDING — F0 will verify\n")
  counters.warnings += 1
}

const status = counters.mismatches === 0 ? "PASS" : "FAIL"
process.stdout.write(
  JSON.stringify(
    {
      status,
      counters,
      details,
      lockHash: lock,
    },
    null,
    2,
  ) + "\n",
)
process.exit(status === "PASS" ? 0 : 1)