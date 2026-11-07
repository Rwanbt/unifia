// SPDX-License-Identifier: MIT
// Turns `bun test --coverage --coverage-reporter=lcov` output into a Markdown
// summary per package (see #1081). lcov only lists files a test loaded, so a
// source file no test imports is invisible there; this script also counts
// those, because they are the largest gap and the one lcov hides.
import { existsSync, readFileSync, readdirSync, appendFileSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"

const SOURCE_FILE = /\.(?:ts|tsx)$/
const NOT_SOURCE = /\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/
const GENERATED = /(?:^|\/)gen\//
const TOP_FILES = 10

/** Parses lcov text into `{ file -> { hit, found } }`, keyed by `src/...` paths. */
export function parseLcov(text) {
  const files = new Map()
  for (const record of text.split("end_of_record")) {
    const source = /^SF:(.*)$/m.exec(record)
    const found = /^LF:(\d+)$/m.exec(record)
    const hit = /^LH:(\d+)$/m.exec(record)
    if (!source || !found || !hit) continue
    const path = source[1].trim().replaceAll("\\", "/")
    const start = path.lastIndexOf("/src/")
    const key = path.startsWith("src/") ? path : start === -1 ? null : path.slice(start + 1)
    if (key) files.set(key, { hit: Number(hit[1]), found: Number(found[1]) })
  }
  return files
}

/**
 * Combines lcov records with the package's source list. Generated files are
 * left out of both. `lines` maps a never-loaded source file to its non-blank
 * line count, used as its uncovered line estimate.
 */
export function summarize(covered, sources) {
  let hit = 0
  let found = 0
  const uncovered = []
  for (const [file, record] of covered) {
    if (GENERATED.test(file)) continue
    hit += record.hit
    found += record.found
    uncovered.push({ file, missing: record.found - record.hit, percent: percent(record.hit, record.found) })
  }
  const neverLoaded = [...sources].filter(([file]) => !covered.has(file) && !GENERATED.test(file))
  const neverLoadedLines = neverLoaded.reduce((sum, [, lines]) => sum + lines, 0)
  for (const [file, lines] of neverLoaded) uncovered.push({ file, missing: lines, percent: 0 })
  uncovered.sort((left, right) => right.missing - left.missing)
  return {
    loadedPercent: percent(hit, found),
    overallPercent: percent(hit, found + neverLoadedLines),
    sourceFiles: sources.size,
    neverLoadedFiles: neverLoaded.length,
    top: uncovered.slice(0, TOP_FILES),
  }
}

function percent(hit, found) {
  return found === 0 ? 100 : Math.round((1000 * hit) / found) / 10
}

function listSources(packageDir) {
  const sources = new Map()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full)
      } else if (SOURCE_FILE.test(entry.name) && !NOT_SOURCE.test(entry.name)) {
        const lines = readFileSync(full, "utf8").split("\n").filter((line) => line.trim() !== "").length
        sources.set(relative(packageDir, full).split(sep).join("/"), lines)
      }
    }
  }
  walk(join(packageDir, "src"))
  return sources
}

export function renderMarkdown(name, summary) {
  const rows = summary.top.map((entry) => `| \`${entry.file}\` | ${entry.missing} | ${entry.percent} % |`)
  return [
    `### ${name}`,
    "",
    `Line coverage: **${summary.overallPercent} %** of all source (${summary.loadedPercent} % of the files tests load).`,
    `${summary.neverLoadedFiles} of ${summary.sourceFiles} source files are never loaded by a test.`,
    "",
    "| Largest gaps | Uncovered lines | Covered |",
    "|---|---|---|",
    ...rows,
    "",
  ].join("\n")
}

function main(packageDirs) {
  const report = ["## Unit test coverage", ""]
  const machine = {}
  for (const packageDir of packageDirs) {
    const lcov = join(packageDir, "coverage", "lcov.info")
    if (!existsSync(lcov)) throw new Error(`no lcov report at ${lcov}; run bun test --coverage first`)
    const summary = summarize(parseLcov(readFileSync(lcov, "utf8")), listSources(packageDir))
    report.push(renderMarkdown(packageDir, summary))
    machine[packageDir] = { overallPercent: summary.overallPercent, loadedPercent: summary.loadedPercent }
  }
  const markdown = report.join("\n")
  process.stdout.write(markdown)
  writeFileSync("coverage-summary.json", JSON.stringify(machine, null, 2) + "\n")
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
}

if (process.argv[1]?.endsWith("coverage-summary.mjs")) {
  main(process.argv.slice(2))
}
