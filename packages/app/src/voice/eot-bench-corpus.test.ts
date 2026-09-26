/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import {
  EOT_BENCH_PATH,
  computeCoverage,
  fixturesByLanguage,
  fixturesByScenario,
  loadEotBench,
  validateEotBenchCorpus,
} from "./eot-bench-corpus"
import {
  EOT_BENCH_VERSION,
  EOT_LANGUAGES,
  EOT_SCENARIOS,
} from "@unifia/contracts/voice-eot-bench"

describe("UNIFIA-EOT-BENCH corpus", () => {
  test("loads and validates the on-disk corpus at the canonical path", async () => {
    const result = await loadEotBench(EOT_BENCH_PATH)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.corpus.version).toBe(EOT_BENCH_VERSION)
    expect(result.corpus.languages).toEqual([...EOT_LANGUAGES])
    expect(result.corpus.scenarios).toEqual([...EOT_SCENARIOS])
    // Plan §19 mandates at least 5 languages × 17 scenarios = 85 fixtures minimum.
    // The shipped corpus goes beyond the minimum for hesitation / filler /
    // enumeration / correction scenarios where a single fixture is not
    // expressive enough of the production edge cases.
    expect(result.corpus.fixtures.length).toBeGreaterThanOrEqual(
      EOT_LANGUAGES.length * EOT_SCENARIOS.length,
    )
    expect(result.coverage.missing).toEqual([])
    expect(result.coverage.totalFixtures).toBe(result.corpus.fixtures.length)
  })

  test("covers all five mandatory production languages", async () => {
    const result = await loadEotBench(EOT_BENCH_PATH)
    if (!result.ok) throw new Error(result.error)
    for (const language of EOT_LANGUAGES) {
      expect(result.coverage.perLanguage[language]).toBeGreaterThanOrEqual(EOT_SCENARIOS.length)
    }
  })

  test("covers every documented scenario in every language", async () => {
    const result = await loadEotBench(EOT_BENCH_PATH)
    if (!result.ok) throw new Error(result.error)
    for (const scenario of EOT_SCENARIOS) {
      expect(result.coverage.perScenario[scenario]).toBeGreaterThanOrEqual(EOT_LANGUAGES.length)
    }
  })

  test("incomplete-utterance fixtures explicitly mark expectedTurnComplete=false", async () => {
    const result = await loadEotBench(EOT_BENCH_PATH)
    if (!result.ok) throw new Error(result.error)
    const incompletes = fixturesByScenario(result.corpus, "incomplete-utterance")
    expect(incompletes.length).toBeGreaterThanOrEqual(EOT_LANGUAGES.length)
    for (const fixture of incompletes) {
      expect(fixture.expectedTurnComplete).toBe(false)
    }
  })

  test("clipping fixtures explicitly mark expectedTurnComplete=false", async () => {
    const result = await loadEotBench(EOT_BENCH_PATH)
    if (!result.ok) throw new Error(result.error)
    const clipped = fixturesByScenario(result.corpus, "clipping")
    expect(clipped.length).toBeGreaterThanOrEqual(EOT_LANGUAGES.length)
    for (const fixture of clipped) {
      expect(fixture.expectedTurnComplete).toBe(false)
    }
  })

  test("fixturesByLanguage returns only fixtures for the requested language", async () => {
    const result = await loadEotBench(EOT_BENCH_PATH)
    if (!result.ok) throw new Error(result.error)
    const en = fixturesByLanguage(result.corpus, "en")
    expect(en.every((f) => f.language === "en")).toBe(true)
    expect(en.length).toBeGreaterThanOrEqual(EOT_SCENARIOS.length)
  })

  test("fixture ids are unique across the corpus", async () => {
    const result = await loadEotBench(EOT_BENCH_PATH)
    if (!result.ok) throw new Error(result.error)
    const ids = result.corpus.fixtures.map((f) => f.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  test("validator rejects a corpus with the wrong version", () => {
    const validation = validateEotBenchCorpus({
      version: "0.0.0",
      description: "stale",
      languages: [...EOT_LANGUAGES],
      scenarios: [...EOT_SCENARIOS],
      fixtures: [
        {
          id: "en-short-01",
          language: "en",
          scenario: "short-statement",
          transcript: "Hello.",
          expectedTurnComplete: true,
        },
      ],
    })
    expect(validation.ok).toBe(false)
    if (validation.ok) return
    expect(validation.error).toMatch(/version mismatch/i)
  })

  test("validator rejects a corpus missing a (language, scenario) cell", () => {
    // Build a minimal corpus that satisfies the version + enumerations
    // but is missing the `multilingual-switch` cell across all languages.
    const fixtures = EOT_LANGUAGES.flatMap((language) =>
      EOT_SCENARIOS.filter((s) => s !== "multilingual-switch").map((scenario) => ({
        id: `${language}-${scenario}`,
        language,
        scenario,
        transcript: "x",
        expectedTurnComplete: true,
      })),
    )
    const validation = validateEotBenchCorpus({
      version: EOT_BENCH_VERSION,
      description: "incomplete",
      languages: [...EOT_LANGUAGES],
      scenarios: [...EOT_SCENARIOS],
      fixtures,
    })
    expect(validation.ok).toBe(false)
    if (validation.ok) return
    expect(validation.error).toMatch(/missing.*cells/i)
  })

  test("validator rejects duplicate fixture ids", () => {
    const fixtures = EOT_LANGUAGES.flatMap((language) =>
      EOT_SCENARIOS.slice(0, 2).map((scenario) => ({
        id: "duplicate-id",
        language,
        scenario,
        transcript: "x",
        expectedTurnComplete: true,
      })),
    )
    const validation = validateEotBenchCorpus({
      version: EOT_BENCH_VERSION,
      description: "dup",
      languages: [...EOT_LANGUAGES],
      scenarios: [...EOT_SCENARIOS],
      fixtures,
    })
    expect(validation.ok).toBe(false)
    if (validation.ok) return
    expect(validation.error).toMatch(/duplicate/i)
  })

  test("computeCoverage returns zeros for an empty corpus fixture list", () => {
    const coverage = computeCoverage({
      version: EOT_BENCH_VERSION,
      description: "empty",
      languages: [...EOT_LANGUAGES],
      scenarios: [...EOT_SCENARIOS],
      fixtures: [],
    })
    expect(coverage.totalFixtures).toBe(0)
    for (const language of EOT_LANGUAGES) {
      expect(coverage.perLanguage[language]).toBe(0)
    }
    for (const scenario of EOT_SCENARIOS) {
      expect(coverage.perScenario[scenario]).toBe(0)
    }
  })

  test("multilingual-switch scenario is present in every language", async () => {
    const result = await loadEotBench(EOT_BENCH_PATH)
    if (!result.ok) throw new Error(result.error)
    const fixtures = fixturesByScenario(result.corpus, "multilingual-switch")
    expect(fixtures.length).toBeGreaterThanOrEqual(EOT_LANGUAGES.length)
    const languages = new Set(fixtures.map((f) => f.language))
    for (const language of EOT_LANGUAGES) {
      expect(languages.has(language)).toBe(true)
    }
  })
})
