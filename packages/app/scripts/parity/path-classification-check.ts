// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// parity:path-classification:check — applies the classification rules in
// parity/path-classification.json to git ls-files and reconciles the result
// against parity/path-classification-coverage.json.

import { execSync } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PARITY_DIR, REPO_ROOT, readJson, writeArtifact, hashCanonical } from "./shared"

type Rule = { match: string; flags: string[] }
type Classification = {
  schemaVersion: number
  classes: Record<string, string[]>
  rules: Rule[]
  generatedOutputs?: { managedBy?: string }
  default: string
}

const classification = readJson<Classification>(join(PARITY_DIR, "path-classification.json"))

function compileGlob(pattern: string): (path: string) => boolean {
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "::STAR::")
        .replace(/::STAR::::STAR::/g, "::DOUBLESTAR::")
        .replace(/::DOUBLESTAR::\//g, "(?:.*/)?")
        .replace(/::DOUBLESTAR::/g, ".*")
        .replace(/::STAR::/g, "[^/]*") +
      "$",
  )
  return (path: string) => re.test(path)
}

const compiledRules = classification.rules.map((r) => ({
  match: r.match,
  flags: new Set(r.flags),
  test: compileGlob(r.match),
}))

function flagsFor(path: string): Set<string> {
  const acc = new Set<string>()
  for (const rule of compiledRules) {
    if (rule.test(path)) {
      for (const f of rule.flags) acc.add(f)
    }
  }
  return acc
}

const tracked = execSync("git ls-files", { encoding: "utf8", cwd: REPO_ROOT })
  .trim()
  .split("\n")
  .filter(Boolean)
const unclassified: string[] = []
const counts: Record<string, number> = {}

for (const path of tracked) {
  const flags = flagsFor(path)
  if (flags.size === 0) {
    unclassified.push(path)
    continue
  }
  for (const f of flags) counts[f] = (counts[f] ?? 0) + 1
}

const sortedCounts: Record<string, number> = {}
for (const key of Object.keys(counts).sort()) sortedCounts[key] = counts[key]!

const live = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  trackedFiles: tracked.length,
  classifiedFiles: tracked.length - unclassified.length,
  unclassifiedFiles: unclassified.slice(0, 200),
  unclassifiedTruncated: unclassified.length > 200,
  classificationCounts: sortedCounts,
  notes: unclassified.length === 0
    ? ["100% coverage achieved - rules hit every tracked file."]
    : [`${unclassified.length} file(s) unmatched by any rule; widen the rules (no wildcards allowed in rules).`],
}

writeArtifact("path-classification-coverage.live.json", live)

// The committed baseline is compared against, not silently overwritten. A
// check that rewrites its own baseline can never detect drift. `capturedAt`
// is volatile metadata and is excluded from the comparison; the substantive
// fields describe the tracked-file set and must change only deliberately
// (via --refresh) in the same commit that changes that set.
const BASELINE_PATH = join(PARITY_DIR, "path-classification-coverage.json")
const errors: string[] = []
const comparable = (coverage: typeof live) =>
  JSON.stringify({
    schemaVersion: coverage.schemaVersion,
    trackedFiles: coverage.trackedFiles,
    classifiedFiles: coverage.classifiedFiles,
    unclassifiedFiles: coverage.unclassifiedFiles,
    unclassifiedTruncated: coverage.unclassifiedTruncated,
    classificationCounts: coverage.classificationCounts,
  })

if (!existsSync(BASELINE_PATH)) {
  errors.push(`baseline missing at ${BASELINE_PATH}: run with --refresh to establish it`)
} else {
  const baseline = readJson<typeof live>(BASELINE_PATH)
  if (comparable(baseline) !== comparable(live)) {
    errors.push("baseline drift: the tracked-file set or rule counts changed; re-run with --refresh if intended")
  }
}

const refresh = process.argv.includes("--refresh")
if (refresh) {
  writeFileSync(BASELINE_PATH, JSON.stringify(live, null, 2))
}

// --refresh is the deliberate opt-in that updates the baseline. It still
// reports the drift it detected, but accepts it: an operator who asked to
// refresh should not be told the gate failed. CI never passes --refresh, so
// CI still fails on any drift.
const driftAccepted = refresh && errors.length > 0 && errors.every((e) => e.startsWith("baseline drift") || e.startsWith("baseline missing"))
const status =
  unclassified.length === 0 && (errors.length === 0 || driftAccepted) ? "PASS" : "FAIL"
process.stdout.write(
  JSON.stringify(
    {
      status,
      counters: {
        tracked: tracked.length,
        classified: tracked.length - unclassified.length,
        unclassified: unclassified.length,
        baselineErrors: errors.length,
        refreshed: refresh,
      },
      errors,
      coverage: live,
      classificationHash: hashCanonical(classification),
    },
    null,
    2,
  ) + "\n",
)
process.exit(status === "PASS" ? 0 : 1)