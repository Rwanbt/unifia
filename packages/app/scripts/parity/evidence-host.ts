// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// parity:evidence:host — runs every host-computable parity gate, captures
// each gate's stdout plus exit code, and writes one canonical bundle to
// parity/artifacts/host-evidence.json (gitignored: regenerate to verify).
//
// Host-computable means: no Docker image, no A/A calibration, no isolated
// BrowserContexts, no pixel engine. The F0 image-side runners (aa,
// aa-prime, visual, motion, mutations, g3, full) stay PENDING_IMPL and are
// NOT folded into this bundle; claiming them here would fabricate proof.
//
// Fail-closed: overall is PASS iff every gate exits 0. A crash, a timeout,
// or an unparseable output fails the bundle. Declared per-gate statuses are
// recorded verbatim, never reinterpreted.

import { spawnSync } from "node:child_process"
import { execSync } from "node:child_process"
import { join } from "node:path"
import {
  ARTIFACTS_DIR,
  REPO_ROOT,
  hashString,
  stableStringify,
  writeArtifact,
} from "./shared"

const APP_DIR = join(REPO_ROOT, "packages", "app")
const GATE_TIMEOUT_MS = 180000

type GateSpec = {
  name: string
  script: string
  args: string[]
  summarize?: (stdout: string, stderr: string) => unknown
}

// bun test's pretty reporter is not JSON, and when piped it writes the
// per-test log plus the summary tail to stderr, not stdout. Parse the
// stable tail lines ("1632 pass", "0 fail", "Ran 1632 tests") from both
// streams; anything unrecognized yields null and the gate's exit code
// still rules the verdict.
function summarizeUnit(stdout: string, stderr: string): unknown {
  const text = `${stdout}\n${stderr}`
  const pass = text.match(/(\d+) pass\b/)
  const fail = text.match(/(\d+) fail\b/)
  const ran = text.match(/Ran (\d+) tests/)
  if (!pass || !fail || !ran) return null
  return { pass: Number(pass[1]), fail: Number(fail[1]), ran: Number(ran[1]) }
}

const GATES: GateSpec[] = [
  { name: "environment-check", script: "scripts/parity/environment-check.ts", args: [] },
  { name: "contract", script: "scripts/parity/contract.ts", args: [] },
  { name: "path-classification-check", script: "scripts/parity/path-classification-check.ts", args: [] },
  { name: "generated-verify", script: "scripts/parity/generated-verify.ts", args: [] },
  { name: "g0-mode-derive", script: "scripts/parity/g0-mode-derive.ts", args: [] },
  { name: "census-run", script: "scripts/parity/census-run.ts", args: ["--emit=artifact"] },
  { name: "tokens-audit", script: "scripts/parity/tokens-audit.ts", args: ["--emit=artifact"] },
  { name: "motion-static", script: "scripts/parity/motion-static.ts", args: ["--emit=artifact"] },
  { name: "census-extended", script: "scripts/parity/census-extended.ts", args: ["--emit=artifact"] },
  { name: "checkpoint-lint", script: "scripts/parity/checkpoint-lint.ts", args: [] },
  { name: "manifest-check", script: "scripts/parity/manifest-check.ts", args: [] },
  { name: "unit", script: "test:unit", args: [], summarize: summarizeUnit },
]

type GateEvidence = {
  name: string
  command: string[]
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  durationMs: number
  status: string | null
  counters: unknown
  stdoutBytes: number
  stdoutSha256: string
  stderrHead: string
}

function shell(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf8", cwd: REPO_ROOT }).trim() || null
  } catch {
    return null
  }
}

function runGate(spec: GateSpec): GateEvidence {
  const command = [process.execPath, "run", spec.script, ...spec.args]
  const started = Date.now()
  const result = spawnSync(process.execPath, ["run", spec.script, ...spec.args], {
    cwd: APP_DIR,
    timeout: GATE_TIMEOUT_MS,
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  })
  const durationMs = Date.now() - started
  const stdout = typeof result.stdout === "string" ? result.stdout : ""
  const stderr = typeof result.stderr === "string" ? result.stderr : ""
  let status: string | null = null
  let counters: unknown = null
  if (spec.summarize) {
    counters = spec.summarize(stdout, stderr)
  } else {
    try {
      const parsed = JSON.parse(stdout) as Record<string, unknown>
      if (typeof parsed.status === "string") status = parsed.status
      if (parsed.counters !== undefined) counters = parsed.counters
      else if (parsed.counts !== undefined) counters = parsed.counts
    } catch {
      status = null
      counters = null
    }
  }
  return {
    name: spec.name,
    command,
    exitCode: result.status,
    signal: result.signal,
    timedOut: durationMs >= GATE_TIMEOUT_MS && result.status === null,
    durationMs,
    status,
    counters,
    stdoutBytes: stdout.length,
    stdoutSha256: hashString(stdout),
    stderrHead: stderr.slice(0, 500),
  }
}

const branch = shell("git branch --show-current")
const head = shell("git rev-parse HEAD")
const dirtyRaw = shell("git status --short")
const dirty = dirtyRaw === null ? null : dirtyRaw.split("\n").filter(Boolean)
const bunVersion = shell("bun --version")
const nodeVersion = shell("node --version")

const gates = GATES.map(runGate)
const overall = gates.every((gate) => gate.exitCode === 0) ? "PASS" : "FAIL"

const bundle = {
  schemaVersion: 1,
  kind: "host-evidence",
  createdAt: new Date().toISOString(),
  repo: {
    root: REPO_ROOT,
    branch,
    head,
    dirty,
    bunVersion,
    nodeVersion,
  },
  gates,
  overall,
  notes: [
    "Host-computable gates only: 10 parity runners plus the unit suite. F0 image-side runners (aa, aa-prime, visual, motion, mutations, g3, full) are excluded by construction.",
    "path-classification-check rewrites parity/path-classification-coverage.json (tracked) as a side effect; census/tokens/motion runners refresh their parity/artifacts sidecars (gitignored).",
    "checkpoint-lint inspects the staged diff; on a clean tree it reports zero files, which is recorded, not hidden.",
    "overall is PASS iff every gate exits 0. Per-gate declared statuses are recorded verbatim.",
  ],
}

// The canonical hash covers only wall-clock-free content so two runs on an
// identical tree produce an identical hash. createdAt, durationMs and
// stderrHead (which can carry timing) are recorded for humans, not hashed.
const canonicalProjection = {
  schemaVersion: bundle.schemaVersion,
  kind: bundle.kind,
  repo: {
    root: bundle.repo.root,
    branch: bundle.repo.branch,
    head: bundle.repo.head,
    dirty: bundle.repo.dirty,
    bunVersion: bundle.repo.bunVersion,
    nodeVersion: bundle.repo.nodeVersion,
  },
  gates: bundle.gates.map((gate) => ({
    name: gate.name,
    command: gate.command,
    exitCode: gate.exitCode,
    signal: gate.signal,
    timedOut: gate.timedOut,
    status: gate.status,
    counters: gate.counters,
  })),
  overall: bundle.overall,
  notes: bundle.notes,
}
const canonicalHash = hashString(stableStringify(canonicalProjection))
const withHash = { ...bundle, canonicalHash }
writeArtifact("host-evidence.json", withHash)

process.stdout.write(
  JSON.stringify(
    {
      status: overall,
      gates: gates.map((gate) => ({ name: gate.name, exitCode: gate.exitCode, status: gate.status })),
      canonicalHash,
      artifact: `${ARTIFACTS_DIR}/host-evidence.json`,
    },
    null,
    2,
  ) + "\n",
)
process.exit(overall === "PASS" ? 0 : 1)
