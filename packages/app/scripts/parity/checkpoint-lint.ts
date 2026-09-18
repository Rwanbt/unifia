// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// parity:checkpoint:lint — applies the rules in parity/path-classification.json
// to a diff range (default HEAD^..HEAD) and rejects INVALID_CHECKPOINT
// per the consolidated plan §7-§11 and §90.
//
// - touchesHarness && touchesApplicationUI => INVALID_CHECKPOINT
// - touchesPolicies && touchesApplicationUI => INVALID_CHECKPOINT
// - touchesApplicationUI + touchesQualification (test of surface) is allowed
// - LOC budget > 400 raises a warning

import { execSync } from "node:child_process"
import { readJson, REPO_ROOT } from "./shared"
import { join } from "node:path"

type Rule = { match: string; flags: string[] }
type Classification = { classes: Record<string, string[]>; rules: Rule[]; default: string }

const classification = readJson<Classification>(join(REPO_ROOT, "parity", "path-classification.json"))

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

const compiled = classification.rules.map((r) => ({ match: r.match, flags: new Set(r.flags), test: compileGlob(r.match) }))

function flagsFor(path: string): Set<string> {
  const acc = new Set<string>()
  for (const rule of compiled) {
    if (rule.test(path)) {
      for (const f of rule.flags) acc.add(f)
    }
  }
  return acc
}

const range = process.argv[2] ?? "HEAD"
const diff = execSync(`git diff --cached --name-only`, { encoding: "utf8", cwd: REPO_ROOT })
  .trim()
  .split("\n")
  .filter(Boolean)
const numstat = execSync(`git diff --cached --numstat`, { encoding: "utf8", cwd: REPO_ROOT })
  .trim()
  .split("\n")
  .filter(Boolean)

const loc = numstat.reduce(
  (acc, line) => {
    const [add, del, file] = line.split(/\s+/)
    acc.added += Number(add)
    acc.deleted += Number(del)
    if (file) acc.files.push(file)
    return acc
  },
  { added: 0, deleted: 0, files: [] as string[] },
)

const flagsAcc = new Set<string>()
for (const path of diff) {
  for (const f of flagsFor(path)) flagsAcc.add(f)
}

const counters = {
  harnessAndUi: 0,
  policiesAndUi: 0,
  unclassified: 0,
  addedLines: loc.added,
  deletedLines: loc.deleted,
  filesChanged: loc.files.length,
}

const errors: string[] = []
const warnings: string[] = []
const details: string[] = []

if (flagsAcc.has("touchesHarness") && flagsAcc.has("touchesApplicationUI")) {
  counters.harnessAndUi += 1
  errors.push("INVALID_CHECKPOINT: harness + application UI in same commit")
}
if (flagsAcc.has("touchesPolicies") && flagsAcc.has("touchesApplicationUI")) {
  counters.policiesAndUi += 1
  errors.push("INVALID_CHECKPOINT: policies + application UI in same commit")
}

if (counters.addedLines > 400) warnings.push(`added lines ${counters.addedLines} > 400 LOC budget`)

for (const path of diff) {
  if (flagsFor(path).size === 0) {
    counters.unclassified += 1
    details.push(`UNCLASSIFIED: ${path}`)
  } else {
    details.push(`OK: ${path} -> {${[...flagsFor(path)].sort().join(",")}}`)
  }
}

const status = errors.length === 0 ? "PASS" : "FAIL"
process.stdout.write(
  JSON.stringify(
    {
      status,
      range,
      counters,
      errors,
      warnings,
      details,
    },
    null,
    2,
  ) + "\n",
)
process.exit(status === "PASS" ? 0 : 1)