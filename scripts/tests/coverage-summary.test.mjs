// SPDX-License-Identifier: MIT
import assert from "node:assert/strict"
import { test } from "node:test"
import { parseLcov, renderMarkdown, summarize } from "../coverage-summary.mjs"

const LCOV = [
  "SF:/repo/packages/app/src/a.ts\nLF:10\nLH:8\nend_of_record",
  "SF:src\\b.tsx\nLF:20\nLH:5\nend_of_record",
  "SF:/repo/packages/app/src/gen/sdk.gen.ts\nLF:500\nLH:0\nend_of_record",
].join("\n")

test("CoverageSummary_LcovPaths_AreKeyedFromSrc", () => {
  assert.deepEqual([...parseLcov(LCOV).keys()], ["src/a.ts", "src/b.tsx", "src/gen/sdk.gen.ts"])
})

test("CoverageSummary_NeverLoadedFiles_CountAsUncovered", () => {
  const sources = new Map([
    ["src/a.ts", 10],
    ["src/b.tsx", 20],
    ["src/never.ts", 30],
  ])
  const summary = summarize(parseLcov(LCOV), sources)
  assert.equal(summary.loadedPercent, 43.3) // 13 of 30 loaded lines
  assert.equal(summary.overallPercent, 21.7) // 13 of 60 once never-loaded lines count
  assert.equal(summary.neverLoadedFiles, 1)
  assert.deepEqual(summary.top[0], { file: "src/never.ts", missing: 30, percent: 0 })
})

test("CoverageSummary_GeneratedCode_IsExcluded", () => {
  const sources = new Map([["src/gen/sdk.gen.ts", 500]])
  const summary = summarize(parseLcov(LCOV), sources)
  assert.equal(summary.top.some((entry) => entry.file.includes("/gen/")), false)
  assert.equal(summary.neverLoadedFiles, 0)
})

test("CoverageSummary_Markdown_NamesThePackageAndGaps", () => {
  const markdown = renderMarkdown("packages/app", summarize(parseLcov(LCOV), new Map([["src/a.ts", 10]])))
  assert.match(markdown, /### packages\/app/)
  assert.match(markdown, /\| `src\/b\.tsx` \| 15 \| 25 % \|/)
})
