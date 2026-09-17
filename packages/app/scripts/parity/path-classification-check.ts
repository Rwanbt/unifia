// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// parity:path-classification:check — applies the classification rules in
// parity/path-classification.json to git ls-files and reconciles the result
// against parity/path-classification-coverage.json.

import { execSync } from "node:child_process"
import { writeFileSync } from "node:fs"
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

const coverage = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  trackedFiles: tracked.length,
  classifiedFiles: tracked.length - unclassified.length,
  unclassifiedFiles: unclassified.slice(0, 200),
  unclassifiedTruncated: unclassified.length > 200,
  classificationCounts: counts,
  notes: unclassified.length === 0
    ? ["100% coverage achieved — rules hit every tracked file."]
    : [`${unclassified.length} file(s) unmatched by any rule; widen the rules (no wildcards allowed in rules).`],
}

writeArtifact("path-classification-coverage.live.json", coverage)
writeFileSync(join(PARITY_DIR, "path-classification-coverage.json"), JSON.stringify(coverage, null, 2))

const status = unclassified.length === 0 ? "PASS" : "FAIL"
process.stdout.write(
  JSON.stringify(
    {
      status,
      counters: {
        tracked: tracked.length,
        classified: tracked.length - unclassified.length,
        unclassified: unclassified.length,
      },
      coverage,
      classificationHash: hashCanonical(classification),
    },
    null,
    2,
  ) + "\n",
)
process.exit(status === "PASS" ? 0 : 1)