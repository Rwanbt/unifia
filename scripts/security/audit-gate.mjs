#!/usr/bin/env node
// Dependency audit gate.
//
// Fails when `bun audit` reports a `critical` or `high` advisory that is not
// explicitly accepted in docs/security/dependency-acceptances.json, or when an
// acceptance has passed its `review_by` date. Also warns about acceptances that
// no longer match anything, so the list cannot rot unnoticed.
//
// Why a gate: before this, nothing in CI read the audit at all. A PR could add a
// critical advisory and every check stayed green (see PREUVE-33 §4.1 in the
// remediation record).
//
// Usage:
//   node scripts/security/audit-gate.mjs
//   node scripts/security/audit-gate.mjs --include-moderate   # local triage
//
// Exit codes: 0 = gate passes, 1 = unaccepted/expired advisory or bad input.

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
// Overridable so the gate's own failure paths can be exercised without editing
// the versioned list (see docs/security/dependency-acceptances.json).
const ACCEPTANCES_PATH =
  process.env.AUDIT_GATE_ACCEPTANCES ?? resolve(ROOT, "docs/security/dependency-acceptances.json")
const GATED = process.argv.includes("--include-moderate")
  ? new Set(["critical", "high", "moderate"])
  : new Set(["critical", "high"])

function die(message) {
  console.error(`audit-gate: ${message}`)
  process.exit(1)
}

function audit() {
  // `bun audit --json` exits 1 whenever it reports anything, so the exit status
  // says nothing about our gate. Only unparseable output is a hard failure.
  const run = spawnSync("bun", ["audit", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })

  if (run.error) die(`could not execute \`bun audit\`: ${run.error.message}`)

  const stdout = (run.stdout ?? "").trim()
  if (!stdout) {
    die(`\`bun audit --json\` produced no output (exit ${run.status}). stderr:\n${run.stderr ?? ""}`)
  }

  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    die(`\`bun audit --json\` did not return JSON: ${error.message}`)
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    die("`bun audit --json` did not return the expected { package: advisory[] } shape")
  }

  const findings = []
  for (const [name, advisories] of Object.entries(parsed)) {
    if (!Array.isArray(advisories)) die(`unexpected advisory list for ${name}`)
    for (const advisory of advisories) {
      const id = String(advisory.url ?? "").split("/").pop()
      if (!id) die(`advisory without a GHSA url under ${name}`)
      findings.push({
        package: name,
        id,
        severity: String(advisory.severity ?? "unknown"),
        title: String(advisory.title ?? ""),
        url: String(advisory.url ?? ""),
      })
    }
  }
  return findings
}

function acceptances() {
  let raw
  try {
    raw = readFileSync(ACCEPTANCES_PATH, "utf8")
  } catch (error) {
    die(`cannot read ${ACCEPTANCES_PATH}: ${error.message}`)
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    die(`${ACCEPTANCES_PATH} is not valid JSON: ${error.message}`)
  }

  if (!Array.isArray(parsed.accepted)) die(`${ACCEPTANCES_PATH} has no "accepted" array`)

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  return parsed.accepted.map((entry, index) => {
    if (!entry.id || !entry.package || !entry.reason || !entry.review_by) {
      die(`acceptance #${index} needs id, package, reason and review_by`)
    }
    const reviewBy = new Date(`${entry.review_by}T00:00:00Z`)
    if (Number.isNaN(reviewBy.getTime())) {
      die(`acceptance ${entry.id} has an unparseable review_by: ${entry.review_by}`)
    }
    return { ...entry, expired: reviewBy < today }
  })
}

const findings = audit()
const accepted = acceptances()
const acceptedByKey = new Map(accepted.map((entry) => [`${entry.id}:${entry.package}`, entry]))

const gated = findings.filter((finding) => GATED.has(finding.severity))
const unaccepted = gated.filter((finding) => !acceptedByKey.has(`${finding.id}:${finding.package}`))
const expired = gated.filter((finding) => {
  const entry = acceptedByKey.get(`${finding.id}:${finding.package}`)
  return entry?.expired === true
})

const liveKeys = new Set(gated.map((finding) => `${finding.id}:${finding.package}`))
const stale = accepted.filter((entry) => !liveKeys.has(`${entry.id}:${entry.package}`))

const counts = findings.reduce((acc, finding) => {
  acc[finding.severity] = (acc[finding.severity] ?? 0) + 1
  return acc
}, {})

console.log(`audit-gate: ${findings.length} advisories reported`)
console.log(
  `  critical=${counts.critical ?? 0} high=${counts.high ?? 0} moderate=${counts.moderate ?? 0} low=${counts.low ?? 0}`,
)
console.log(`  gating on: ${[...GATED].join(", ")}`)
console.log(`  accepted (all severities): ${accepted.length}`)

if (stale.length > 0) {
  console.log("")
  console.log("WARN: accepted advisories that no longer match the audit (prune them):")
  for (const entry of stale) console.log(`  - ${entry.id} (${entry.package})`)
}

if (expired.length > 0) {
  console.error("")
  console.error("FAIL: accepted advisories past their review_by date:")
  for (const finding of expired) {
    const entry = acceptedByKey.get(`${finding.id}:${finding.package}`)
    console.error(`  - ${finding.id} (${finding.package}) review_by ${entry.review_by}: ${finding.title}`)
  }
}

if (unaccepted.length > 0) {
  console.error("")
  console.error("FAIL: gated advisories with no acceptance entry:")
  for (const finding of [...unaccepted].sort((a, b) => a.package.localeCompare(b.package))) {
    console.error(`  - [${finding.severity}] ${finding.package} ${finding.id}: ${finding.title}`)
    console.error(`    ${finding.url}`)
  }
  console.error("")
  console.error("Fix the dependency, or add an entry to docs/security/dependency-acceptances.json")
  console.error("with a reason, a fix path/version, and a review_by date.")
}

if (unaccepted.length > 0 || expired.length > 0) process.exit(1)

console.log("")
console.log("PASS: every gated advisory is fixed or explicitly accepted.")
